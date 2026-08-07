import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  writeSyncStep1,
  readSyncMessage,
} from "y-protocols/sync";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { mintToken, createRemoteDocument } from "@/lib/api";
import * as outbox from "./outbox";
import { upsertLocalDoc } from "@/lib/local/meta-store";
import {
  EDIT_STREAM_DEBOUNCE_MS,
  RECONNECT_BACKOFF_MS,
  RECONNECT_JITTER_RATIO,
  DEFAULT_DOC_TITLE,
} from "@/lib/constants";

/**
 * The client sync engine (plan/03): connects one open document to the
 * backend's realtime endpoint.
 *
 * Durability model: every local Yjs update is written to the IndexedDB
 * outbox BEFORE any send attempt, and removed only when the server ACKs
 * the batch it was part of. A crash/reload at any point replays safely
 * (CRDT updates are idempotent). The Yjs sync handshake independently
 * repairs any divergence on connect, so the outbox is a durability and
 * status ledger, not the only correctness mechanism — belt and suspenders.
 *
 * State machine: offline → connecting → syncing → synced (plan/03 §1),
 * with exponential backoff + jitter on reconnects. "error" is reserved
 * for persistent failures that need user attention (access revoked).
 *
 * Deviation from plan/03 noted in plan/15: this runs on the main thread
 * (like y-websocket) rather than a Web Worker — all heavy work is async
 * I/O, and every tab connects instead of electing a leader (duplicate
 * sends are idempotent by design).
 */

export type SyncState = "offline" | "connecting" | "syncing" | "synced" | "error";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const ACK_TIMEOUT_MS = 10_000;

export interface SyncProviderEvents {
  onState?: (state: SyncState) => void;
  onRole?: (role: "owner" | "editor" | "viewer") => void;
  onRevoked?: () => void;
}

export class SyncProvider {
  readonly awareness: Awareness;
  private ws: WebSocket | null = null;
  private state: SyncState = "offline";
  private destroyed = false;
  private backoffIndex = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private pendingAck: {
    batchId: string;
    ids: number[];
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private remoteEnsured = false;

  constructor(
    readonly docId: string,
    readonly doc: Y.Doc,
    private events: SyncProviderEvents = {},
  ) {
    this.awareness = new Awareness(doc);
    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    window.addEventListener("online", this.onBrowserOnline);
    window.addEventListener("offline", this.onBrowserOffline);
    this.connect();
  }

  getState(): SyncState {
    return this.state;
  }

  private setState(next: SyncState): void {
    if (this.state === next || this.destroyed) return;
    this.state = next;
    this.events.onState?.(next);
  }

  /** Local edits → outbox first (durability), then debounced flush. */
  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Skip updates we applied ourselves (remote) and the initial
    // IndexedDB load (its origin is the persistence provider object).
    if (origin === this || (origin && (origin as { constructor?: { name?: string } }).constructor?.name === "IndexeddbPersistence")) {
      return;
    }
    void outbox.enqueue(this.docId, update).then(() => this.scheduleFlush());
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
  ): void => {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const changed = [...added, ...updated, ...removed];
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, changed));
    this.ws.send(encoding.toUint8Array(encoder));
  };

  private onBrowserOnline = (): void => {
    this.backoffIndex = 0;
    this.connect();
  };

  private onBrowserOffline = (): void => {
    this.setState("offline");
  };

  private async connect(): Promise<void> {
    if (this.destroyed || (this.ws && this.ws.readyState <= WebSocket.OPEN)) return;
    if (!navigator.onLine) {
      this.setState("offline");
      return;
    }
    this.setState("connecting");

    // Offline-created documents get registered server-side on first sync,
    // keeping their client-generated id (plan/13 §POST /api/documents).
    if (!this.remoteEnsured) {
      const title = (this.doc.getMap("meta").get("title") as string) ?? DEFAULT_DOC_TITLE;
      await createRemoteDocument(this.docId, title); // 409 (exists) is fine
      this.remoteEnsured = true;
    }

    const minted = await mintToken(this.docId);
    if (!minted) {
      this.scheduleReconnect();
      return;
    }

    const base = process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "ws://localhost:4000/doc";
    const ws = new WebSocket(`${base}?token=${encodeURIComponent(minted.token)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.backoffIndex = 0;
      this.setState("syncing");
      // Bidirectional handshake: ask the server what we're missing.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      writeSyncStep1(encoder, this.doc);
      ws.send(encoding.toUint8Array(encoder));
      // Re-announce our presence after reconnects.
      const local = this.awareness.getLocalState();
      if (local) this.awareness.setLocalState({ ...local });
      void this.flush();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        this.handleControl(event.data);
        return;
      }
      const data = new Uint8Array(event.data as ArrayBuffer);
      const decoder = decoding.createDecoder(data);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);
      if (messageType === MESSAGE_SYNC) {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // Applies remote state with `this` as origin (so onDocUpdate
        // skips it) and writes our step2 reply when the server asked.
        readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
      } else if (messageType === MESSAGE_AWARENESS) {
        applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      this.ws = null;
      this.failPendingAck();
      if (this.destroyed) return;
      if (event.code === 4403) {
        // Membership revoked: stop reconnecting, keep local data readable.
        this.setState("error");
        this.events.onRevoked?.();
        return;
      }
      if (event.code === 4401) {
        // Expected: tokens are 60s single-use — reconnect immediately.
        void this.connect();
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.setState(navigator.onLine ? "connecting" : "offline");
    const base =
      RECONNECT_BACKOFF_MS[Math.min(this.backoffIndex, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
    this.backoffIndex++;
    const jitter = base * RECONNECT_JITTER_RATIO * (Math.random() * 2 - 1);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), base + jitter);
  }

  private handleControl(raw: string): void {
    let msg: { t?: string; batchId?: string; seq?: number; role?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === "ack" && this.pendingAck && msg.batchId === this.pendingAck.batchId) {
      const { ids, resolve, timer } = this.pendingAck;
      clearTimeout(timer);
      this.pendingAck = null;
      void outbox.remove(ids).then(() => {
        void upsertLocalDoc(this.docId, {
          dirty: false,
          lastSyncedSeq: msg.seq ?? 0,
          updatedAt: Date.now(),
        });
        resolve();
      });
    } else if (msg.t === "nack" && this.pendingAck && msg.batchId === this.pendingAck.batchId) {
      this.failPendingAck(); // rows stay queued; retried on next flush
      this.scheduleFlush(2_000);
    } else if (msg.t === "role" && msg.role) {
      this.events.onRole?.(msg.role as "owner" | "editor" | "viewer");
    }
  }

  private failPendingAck(): void {
    if (!this.pendingAck) return;
    clearTimeout(this.pendingAck.timer);
    const { resolve } = this.pendingAck;
    this.pendingAck = null;
    this.flushing = false;
    resolve();
  }

  private scheduleFlush(delay = EDIT_STREAM_DEBOUNCE_MS): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), delay);
  }

  /** Drain the outbox in acked batches until empty (plan/03 §2d-e). */
  private async flush(): Promise<void> {
    if (this.destroyed || this.flushing) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.flushing = true;
    try {
      for (;;) {
        const rows = await outbox.peekBatch(this.docId);
        if (rows.length === 0) break;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.setState("syncing");

        const batchId = crypto.randomUUID();
        const acked = new Promise<void>((resolve) => {
          this.pendingAck = {
            batchId,
            ids: rows.map((r) => r.id),
            resolve,
            timer: setTimeout(() => {
              // Lost ack: leave rows queued; reconnect logic will retry.
              this.pendingAck = null;
              this.flushing = false;
              this.ws?.close();
              resolve();
            }, ACK_TIMEOUT_MS),
          };
        });

        this.ws.send(JSON.stringify({ t: "push", batchId, count: rows.length }));
        for (const row of rows) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          encoding.writeVarUint(encoder, 2); // syncUpdate
          encoding.writeVarUint8Array(encoder, row.bytes);
          this.ws.send(encoding.toUint8Array(encoder));
        }
        await acked;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      }
      this.setState("synced");
    } finally {
      this.flushing = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    window.removeEventListener("online", this.onBrowserOnline);
    window.removeEventListener("offline", this.onBrowserOffline);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.failPendingAck();
    removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    this.awareness.destroy();
    this.ws?.close(1000, "client closed");
    this.ws = null;
  }
}
