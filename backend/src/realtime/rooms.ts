import * as Y from "yjs";
import { Awareness, removeAwarenessStates } from "y-protocols/awareness";
import { writeUpdate } from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import type { WebSocket } from "ws";
import { prisma } from "../db.js";
import { loadDocState, appendUpdate, runMaintenance } from "../persistence/doc-store.js";
import { TITLE_MIRROR_DEBOUNCE_MS, DEFAULT_DOC_TITLE, TITLE_MAX_LENGTH } from "@shared/constants";
import type { DocumentRole, WsServerControl } from "@shared/schemas/api";

/**
 * In-memory collaboration rooms (plan/01 §Collab/WS Layer). One Room per
 * open document: the authoritative in-memory Y.Doc, its Awareness state,
 * and the set of live connections. The room loads state from Postgres on
 * first join and persists every accepted update back as an append-only
 * log entry.
 */

/** Origin tag for restores applied server-side (never undo-tracked). */
export const restoreOrigin = "server-restore";

export interface ConnState {
  ws: WebSocket;
  userId: string;
  role: DocumentRole;
  /** In-flight client push batch being counted toward an ack. */
  pendingBatch: { batchId: string; remaining: number; skipPersist: boolean; lastSeq: bigint } | null;
}

export class Room {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness = new Awareness(this.doc);
  readonly conns = new Map<WebSocket, ConnState>();
  /** Serializes DB appends so seq order matches apply order. */
  private persistChain: Promise<unknown> = Promise.resolve();
  private titleTimer: ReturnType<typeof setTimeout> | null = null;
  private ownerId: string | null = null;
  loaded: Promise<void>;

  constructor(readonly documentId: string) {
    this.awareness.setLocalState(null); // server holds no presence
    this.loaded = this.load();
    this.watchTitle();
  }

  private async load(): Promise<void> {
    const [state, doc] = await Promise.all([
      loadDocState(this.documentId),
      prisma.document.findUnique({
        where: { id: this.documentId },
        select: { ownerId: true },
      }),
    ]);
    this.ownerId = doc?.ownerId ?? null;
    if (state) Y.applyUpdate(this.doc, state, "load");
  }

  /** Mirror Y.Map('meta').title into documents.title, debounced (plan/14 §3). */
  private watchTitle(): void {
    const meta = this.doc.getMap("meta");
    meta.observe(() => {
      if (this.titleTimer) clearTimeout(this.titleTimer);
      this.titleTimer = setTimeout(() => {
        const raw = meta.get("title");
        const title =
          typeof raw === "string" && raw.trim()
            ? raw.trim().slice(0, TITLE_MAX_LENGTH)
            : DEFAULT_DOC_TITLE;
        prisma.document
          .update({ where: { id: this.documentId }, data: { title } })
          .catch(() => {}); // mirror is best-effort; next edit retries
      }, TITLE_MIRROR_DEBOUNCE_MS);
    });
  }

  /**
   * Apply an incoming update to the shared doc and queue its persistence.
   * Resolves with the assigned seq (or null when persistence is skipped
   * for an idempotent batch replay).
   */
  applyAndPersist(update: Uint8Array, conn: ConnState, skipPersist: boolean): Promise<bigint | null> {
    const before = Y.encodeStateVector(this.doc);
    Y.applyUpdate(this.doc, update, conn);
    if (skipPersist) return Promise.resolve(null);
    // No-op updates (e.g. a reconnecting client's full-state step2 reply
    // that we already have) advance nothing — don't log redundant rows.
    const after = Y.encodeStateVector(this.doc);
    if (Buffer.from(before).equals(Buffer.from(after))) return Promise.resolve(null);
    const task = this.persistChain.then(() => appendUpdate(this.documentId, conn.userId, update));
    // Keep the chain alive even if one append fails (client will retry the batch).
    this.persistChain = task.catch(() => {});
    return task;
  }

  /** Fire-and-forget compaction/auto-snapshot pass (plan/05, plan/11). */
  maintain(): void {
    const state = Y.encodeStateAsUpdate(this.doc);
    void runMaintenance(this.documentId, state).catch(() => {});
  }

  get isEmpty(): boolean {
    return this.conns.size === 0;
  }

  destroy(): void {
    if (this.titleTimer) clearTimeout(this.titleTimer);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

const rooms = new Map<string, Room>();

export async function joinRoom(documentId: string): Promise<Room> {
  let room = rooms.get(documentId);
  if (!room) {
    room = new Room(documentId);
    rooms.set(documentId, room);
  }
  await room.loaded;
  return room;
}

/**
 * Drop a connection. `awarenessClientIds` are the Yjs client ids this
 * socket announced presence for — their states are removed so other
 * collaborators don't see ghost cursors (plan/11 §client memory).
 */
export function leaveRoom(room: Room, ws: WebSocket, awarenessClientIds: number[]): void {
  room.conns.delete(ws);
  if (awarenessClientIds.length > 0) {
    removeAwarenessStates(room.awareness, awarenessClientIds, "disconnect");
  }
  if (room.isEmpty) {
    rooms.delete(room.documentId);
    room.maintain(); // final snapshot/compaction opportunity
    room.destroy();
  }
}

/** Live doc state for REST handlers (versions/restore), if a room is open. */
export function getLiveDocState(documentId: string): Uint8Array | null {
  const room = rooms.get(documentId);
  return room ? Y.encodeStateAsUpdate(room.doc) : null;
}

function sendControl(ws: WebSocket, msg: WsServerControl): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Push a live role change to any open sockets for this user (plan/13
 * §role message). role=null means access revoked → close with 4403.
 */
export function notifyRoleChange(
  documentId: string,
  userId: string,
  role: DocumentRole | null,
): void {
  const room = rooms.get(documentId);
  if (!room) return;
  for (const conn of room.conns.values()) {
    if (conn.userId !== userId) continue;
    if (role === null) {
      conn.ws.close(4403, "membership revoked");
    } else {
      conn.role = role;
      sendControl(conn.ws, { t: "role", role });
    }
  }
}

/**
 * Restore-as-forward-edit (plan/05): replace the live doc's content with
 * the snapshot's content INSIDE a normal transaction on the live doc, so
 * it merges with concurrent edits instead of rewriting history. If no
 * room is open, operates on a doc materialized from the DB and persists
 * the resulting update.
 */
export async function applyRestore(
  documentId: string,
  userId: string,
  snapshotState: Uint8Array,
): Promise<void> {
  const room = rooms.get(documentId);
  const liveDoc = room ? room.doc : new Y.Doc({ gc: true });
  if (!room) {
    const state = await loadDocState(documentId);
    if (state) Y.applyUpdate(liveDoc, state, "load");
  }

  const snapshotDoc = new Y.Doc();
  Y.applyUpdate(snapshotDoc, snapshotState);

  const before = Y.encodeStateVector(liveDoc);

  liveDoc.transact(() => {
    // Content: clear and re-insert from the snapshot as ordinary ops.
    const liveFrag = liveDoc.getXmlFragment("content");
    const snapFrag = snapshotDoc.getXmlFragment("content");
    liveFrag.delete(0, liveFrag.length);
    const clones = snapFrag
      .toArray()
      .map((node) => node.clone()) as (Y.XmlElement | Y.XmlText)[];
    if (clones.length > 0) liveFrag.insert(0, clones);
    // Title restores too — it's document state like any other.
    const snapTitle = snapshotDoc.getMap("meta").get("title");
    if (typeof snapTitle === "string") liveDoc.getMap("meta").set("title", snapTitle);
  }, restoreOrigin);

  // The restore expressed as one incremental update relative to `before`.
  const restoreUpdate = Y.encodeStateAsUpdate(liveDoc, before);
  snapshotDoc.destroy();

  await appendUpdate(documentId, userId, restoreUpdate);

  if (room) {
    // Broadcast through the normal update path so every live client
    // receives the restore exactly like any other edit.
    broadcastUpdate(room, restoreUpdate, null);
  } else {
    liveDoc.destroy();
  }
}

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** Encode a Yjs update as a sync-protocol frame and fan out. */
export function broadcastUpdate(room: Room, update: Uint8Array, except: WebSocket | null): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  writeUpdate(encoder, update);
  const frame = encoding.toUint8Array(encoder);
  for (const [ws] of room.conns) {
    if (ws !== except && ws.readyState === ws.OPEN) ws.send(frame);
  }
}
