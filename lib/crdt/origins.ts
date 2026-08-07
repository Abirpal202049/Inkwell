/**
 * Transaction origin sentinels (plan/14-google-docs-parity.md §1).
 *
 * Every Y.Doc write in this app MUST go through
 * `doc.transact(fn, origin)` with one of these origins — per-user undo
 * correctness depends on it:
 *  - localOrigin:   user's own edits — tracked by the UndoManager
 *  - aiOrigin:      AI insertions — also undoable by the user
 *  - restoreOrigin: version restores — NOT undoable via Ctrl+Z (undo of a
 *                   restore is done by restoring again from history)
 *
 * Remote updates arrive through the sync provider with its own origin and
 * are therefore never captured by undo.
 */
export const localOrigin = Symbol("inkwell-local");
export const aiOrigin = Symbol("inkwell-ai");
export const restoreOrigin = Symbol("inkwell-restore");
