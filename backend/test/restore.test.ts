import { describe, it, expect } from "vitest";
import * as Y from "yjs";

/**
 * Restore-as-forward-edit semantics (plan/05 §Restore): restoring to a
 * snapshot must be expressed as normal CRDT operations on the LIVE doc,
 * so a collaborator's concurrent edits merge instead of being destroyed.
 * This mirrors the logic in src/realtime/rooms.ts applyRestore().
 */

function restoreContentAsForwardEdit(liveDoc: Y.Doc, snapshotState: Uint8Array): Uint8Array {
  const snapshotDoc = new Y.Doc();
  Y.applyUpdate(snapshotDoc, snapshotState);
  const before = Y.encodeStateVector(liveDoc);

  liveDoc.transact(() => {
    const liveText = liveDoc.getText("t");
    const snapText = snapshotDoc.getText("t");
    liveText.delete(0, liveText.length);
    liveText.insert(0, snapText.toString());
  }, "restore");

  const restoreUpdate = Y.encodeStateAsUpdate(liveDoc, before);
  snapshotDoc.destroy();
  return restoreUpdate;
}

describe("restore-as-forward-edit", () => {
  it("restores old content without rewriting history", () => {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "version one");
    const snapshot = Y.encodeStateAsUpdate(doc); // capture v1

    doc.getText("t").delete(0, doc.getText("t").length);
    doc.getText("t").insert(0, "version two, heavily rewritten");

    restoreContentAsForwardEdit(doc, snapshot);
    expect(doc.getText("t").toString()).toBe("version one");
    doc.destroy();
  });

  it("a collaborator's concurrent edit survives the restore (converges, no data loss)", () => {
    // Shared history: v1 snapshot taken, then content evolved to v2.
    const server = new Y.Doc();
    server.getText("t").insert(0, "v1 ");
    const snapshot = Y.encodeStateAsUpdate(server);
    server.getText("t").insert(3, "v2 ");
    const sharedState = Y.encodeStateAsUpdate(server);

    // Two replicas of the current state.
    const restorer = new Y.Doc();
    Y.applyUpdate(restorer, sharedState);
    const typist = new Y.Doc();
    Y.applyUpdate(typist, sharedState);

    // Concurrently: A restores to v1; B types new content.
    const restoreUpdate = restoreContentAsForwardEdit(restorer, snapshot);
    const beforeTyping = Y.encodeStateVector(typist);
    typist.getText("t").insert(typist.getText("t").length, "NEW-WORDS");
    const typingUpdate = Y.encodeStateAsUpdate(typist, beforeTyping);

    // Cross-deliver in both orders.
    Y.applyUpdate(restorer, typingUpdate);
    Y.applyUpdate(typist, restoreUpdate);

    const a = restorer.getText("t").toString();
    const b = typist.getText("t").toString();

    // Both replicas converge identically…
    expect(a).toBe(b);
    // …and the typist's concurrent insertion was NOT destroyed by the restore.
    expect(a).toContain("NEW-WORDS");

    restorer.destroy();
    typist.destroy();
    server.destroy();
  });
});
