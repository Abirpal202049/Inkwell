import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { writeSyncStep1, writeSyncStep2, readSyncStep1 } from "y-protocols/sync";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { verifyCollabToken } from "./token.js";
import {
  joinRoom,
  leaveRoom,
  broadcastUpdate,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  type Room,
  type ConnState,
} from "./rooms.js";
import { recordBatch, findBatch } from "../persistence/doc-store.js";
import { env } from "../env.js";
import {
  WS_MAX_FRAME_BYTES,
  WS_HEARTBEAT_MS,
  RATE_LIMIT_MSGS,
  RATE_LIMIT_WINDOW_MS,
  DOC_MAX_BYTES,
} from "@shared/constants";
import { wsClientControlSchema } from "@shared/schemas/api";

/**
 * The realtime WebSocket endpoint (plan/13 §WebSocket Protocol).
 *
 * Frame kinds:
 *  - binary: y-protocols messages (0 = sync, 1 = awareness)
 *  - text:   JSON control ({t:'push', batchId, count} from clients)
 *
 * Security stack per connection (plan/06 §OOM):
 *  1. token validated BEFORE the HTTP upgrade completes
 *  2. ws maxPayload caps frame size at the transport
 *  3. token-bucket rate limit per connection
 *  4. viewers' write frames are dropped before any Yjs decode
 *  5. semantic doc-size cap checked after apply
 */

const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

interface RateBucket {
  count: number;
  windowStart: number;
}

function rateLimited(bucket: RateBucket): boolean {
  const now = Date.now();
  if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  return ++bucket.count > RATE_LIMIT_MSGS;
}

export function attachRealtime(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_FRAME_BYTES });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/doc") {
      socket.destroy();
      return;
    }
    // Browser origin check (non-browser clients omit Origin; that's fine —
    // the token is the actual credential).
    const origin = req.headers.origin;
    if (origin && env.isProd && origin !== env.frontendOrigin) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    void verifyCollabToken(token).then((claims) => {
      if (!claims) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handleConnection(ws, claims.doc, {
          ws,
          userId: claims.sub,
          role: claims.role,
          pendingBatch: null,
        });
      });
    });
  });
}

async function handleConnection(ws: WebSocket, documentId: string, conn: ConnState): Promise<void> {
  let room: Room;
  try {
    room = await joinRoom(documentId);
  } catch {
    ws.close(1011, "failed to load document");
    return;
  }
  room.conns.set(ws, conn);

  const bucket: RateBucket = { count: 0, windowStart: Date.now() };
  /** Awareness client ids this socket announced (for cleanup on close). */
  const awarenessIds = new Set<number>();

  // Heartbeat: server pings; two missed pongs → dead connection (plan/13).
  let alive = true;
  ws.on("pong", () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, WS_HEARTBEAT_MS);

  // Initial handshake: send our state vector (step1) + current awareness,
  // mirroring y-websocket so standard clients interoperate.
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (rateLimited(bucket)) {
      ws.close(4429, "rate limited");
      return;
    }

    if (!isBinary) {
      handleControlFrame(ws, room, conn, data);
      return;
    }

    try {
      handleBinaryFrame(ws, room, conn, new Uint8Array(data), awarenessIds);
    } catch {
      // Malformed frame: never crash the room for everyone (plan/06).
      ws.close(1003, "malformed frame");
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    leaveRoom(room, ws, [...awarenessIds]);
  });
}

function handleControlFrame(ws: WebSocket, room: Room, conn: ConnState, data: Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString("utf8"));
  } catch {
    ws.close(1003, "malformed control frame");
    return;
  }
  const result = wsClientControlSchema.safeParse(parsed);
  if (!result.success) {
    ws.close(1003, "invalid control frame");
    return;
  }
  const msg = result.data;

  if (msg.t === "push") {
    if (conn.role === "viewer") return; // viewers cannot push (plan/06)
    void findBatch(room.documentId, msg.batchId).then((ackedSeq) => {
      if (ackedSeq !== null) {
        // Idempotent replay: re-ack with the original seq; the coming
        // update frames will be applied (harmless) but not re-persisted.
        conn.pendingBatch = {
          batchId: msg.batchId,
          remaining: msg.count,
          skipPersist: true,
          lastSeq: ackedSeq,
        };
        ws.send(JSON.stringify({ t: "ack", batchId: msg.batchId, seq: Number(ackedSeq) }));
      } else {
        conn.pendingBatch = {
          batchId: msg.batchId,
          remaining: msg.count,
          skipPersist: false,
          lastSeq: 0n,
        };
      }
    });
  }
}

function handleBinaryFrame(
  ws: WebSocket,
  room: Room,
  conn: ConnState,
  data: Uint8Array,
  awarenessIds: Set<number>,
): void {
  const decoder = decoding.createDecoder(data);
  const messageType = decoding.readVarUint(decoder);

  if (messageType === MESSAGE_AWARENESS) {
    const update = decoding.readVarUint8Array(decoder);
    // Track this socket's announced client ids for disconnect cleanup.
    try {
      const idDecoder = decoding.createDecoder(update);
      const count = decoding.readVarUint(idDecoder);
      for (let i = 0; i < count; i++) {
        awarenessIds.add(decoding.readVarUint(idDecoder));
        decoding.readVarUint(idDecoder); // clock
        decoding.readVarString(idDecoder); // state json
      }
    } catch {
      /* best-effort id tracking only */
    }
    applyAwarenessUpdate(room.awareness, update, conn);
    // Fan awareness out to everyone else.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const [other] of room.conns) {
      if (other !== ws && other.readyState === other.OPEN) other.send(frame);
    }
    return;
  }

  if (messageType !== MESSAGE_SYNC) return;

  const syncType = decoding.readVarUint(decoder);

  if (syncType === SYNC_STEP1) {
    // Client asks for what it's missing — always allowed (read).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    readSyncStep1(decoder, encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder));
    return;
  }

  if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
    // Writes: dropped for viewers BEFORE any decode/apply (plan/06 §2).
    if (conn.role === "viewer") return;

    const update = decoding.readVarUint8Array(decoder);
    const batch = conn.pendingBatch;

    void room
      .applyAndPersist(update, conn, batch?.skipPersist ?? false)
      .then(async (seq) => {
        broadcastUpdate(room, update, ws);

        // Semantic size cap: reject documents grown past the limit
        // (plan/06 §5). Checked post-apply; the offending client is
        // disconnected and the oversized state is not snapshotted.
        if (Y.encodeStateAsUpdate(room.doc).byteLength > DOC_MAX_BYTES) {
          ws.close(4413, "document too large");
          return;
        }

        if (batch) {
          if (seq !== null) batch.lastSeq = seq;
          batch.remaining--;
          if (batch.remaining <= 0) {
            conn.pendingBatch = null;
            if (!batch.skipPersist) {
              await recordBatch(room.documentId, batch.batchId, batch.lastSeq);
              ws.send(
                JSON.stringify({ t: "ack", batchId: batch.batchId, seq: Number(batch.lastSeq) }),
              );
            }
            room.maintain();
          }
        }
      })
      .catch(() => {
        if (batch) {
          conn.pendingBatch = null;
          ws.send(
            JSON.stringify({ t: "nack", batchId: batch.batchId, code: "PERSIST_FAILED", retryable: true }),
          );
        }
      });
  }
}
