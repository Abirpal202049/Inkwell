import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { ALL_HF_FRAGMENT_NAMES, PAGE_LAYOUT_META_KEYS } from "@shared/constants";

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

/**
 * Full-document restore, mirroring applyRestore in src/realtime/rooms.ts:
 * every content segment (body + header/footer fragments, plan/16) plus the
 * page-layout meta keys — keys absent from the snapshot are deleted so
 * their defaults apply again.
 */
function restoreDocAsForwardEdit(liveDoc: Y.Doc, snapshotState: Uint8Array): Uint8Array {
  const snapshotDoc = new Y.Doc();
  Y.applyUpdate(snapshotDoc, snapshotState);
  const before = Y.encodeStateVector(liveDoc);

  liveDoc.transact(() => {
    for (const name of ["content", ...ALL_HF_FRAGMENT_NAMES]) {
      const liveFrag = liveDoc.getXmlFragment(name);
      const snapFrag = snapshotDoc.getXmlFragment(name);
      liveFrag.delete(0, liveFrag.length);
      const clones = snapFrag.toArray().map((node) => node.clone()) as (Y.XmlElement | Y.XmlText)[];
      if (clones.length > 0) liveFrag.insert(0, clones);
    }
    const liveMeta = liveDoc.getMap("meta");
    const snapMeta = snapshotDoc.getMap("meta");
    for (const key of PAGE_LAYOUT_META_KEYS) {
      const value = snapMeta.get(key);
      if (value === undefined) {
        if (liveMeta.has(key)) liveMeta.delete(key);
      } else {
        liveMeta.set(key, value);
      }
    }
  }, "restore");

  const restoreUpdate = Y.encodeStateAsUpdate(liveDoc, before);
  snapshotDoc.destroy();
  return restoreUpdate;
}

function paragraph(text: string): Y.XmlElement {
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [new Y.XmlText(text)]);
  return p;
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

  it("restores header/footer segments and page-layout meta with the body", () => {
    const doc = new Y.Doc();
    // v1: a header segment plus layout settings.
    doc.getXmlFragment("content").insert(0, [paragraph("body v1")]);
    doc.getXmlFragment("header-default").insert(0, [paragraph("Confidential")]);
    doc.getMap("meta").set("headerEnabled", true);
    doc.getMap("meta").set("pageSize", "letter");
    const snapshot = Y.encodeStateAsUpdate(doc);

    // v2: header rewritten and removed, layout changed, and a footer that
    // never existed in v1.
    const header = doc.getXmlFragment("header-default");
    header.delete(0, header.length);
    header.insert(0, [paragraph("Draft")]);
    doc.getMap("meta").set("headerEnabled", false);
    doc.getMap("meta").set("pageSize", "a4");
    doc.getXmlFragment("footer-default").insert(0, [paragraph("page footer")]);
    doc.getMap("meta").set("footerEnabled", true);

    restoreDocAsForwardEdit(doc, snapshot);

    expect(doc.getXmlFragment("content").toString()).toContain("body v1");
    expect(doc.getXmlFragment("header-default").toString()).toContain("Confidential");
    expect(doc.getMap("meta").get("headerEnabled")).toBe(true);
    expect(doc.getMap("meta").get("pageSize")).toBe("letter");
    // The footer post-dates the snapshot: its segment empties and its meta
    // key (absent in v1) is deleted so the default applies again.
    expect(doc.getXmlFragment("footer-default").length).toBe(0);
    expect(doc.getMap("meta").get("footerEnabled")).toBeUndefined();
    doc.destroy();
  });

  it("a concurrent header edit merges with a restore instead of being lost", () => {
    const server = new Y.Doc();
    server.getXmlFragment("header-default").insert(0, [paragraph("v1 header")]);
    const snapshot = Y.encodeStateAsUpdate(server);
    server.getXmlFragment("header-default").insert(1, [paragraph("v2 extra")]);
    const sharedState = Y.encodeStateAsUpdate(server);

    const restorer = new Y.Doc();
    Y.applyUpdate(restorer, sharedState);
    const typist = new Y.Doc();
    Y.applyUpdate(typist, sharedState);

    const restoreUpdate = restoreDocAsForwardEdit(restorer, snapshot);
    const beforeTyping = Y.encodeStateVector(typist);
    typist.getXmlFragment("footer-default").insert(0, [paragraph("typed meanwhile")]);
    const typingUpdate = Y.encodeStateAsUpdate(typist, beforeTyping);

    Y.applyUpdate(restorer, typingUpdate);
    Y.applyUpdate(typist, restoreUpdate);

    expect(restorer.getXmlFragment("footer-default").toString()).toBe(
      typist.getXmlFragment("footer-default").toString(),
    );
    expect(restorer.getXmlFragment("header-default").toString()).toBe(
      typist.getXmlFragment("header-default").toString(),
    );
    // The concurrent footer edit survived the restore.
    expect(restorer.getXmlFragment("footer-default").toString()).toContain("typed meanwhile");

    restorer.destroy();
    typist.destroy();
    server.destroy();
  });
});
