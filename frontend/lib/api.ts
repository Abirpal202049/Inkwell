/**
 * Typed fetch helpers for the backend REST API (contracts: plan/13).
 * All calls go through the Next.js /api/* rewrite proxy, so cookies are
 * first-party. Every helper returns null on network failure — callers
 * treat that as "offline" and degrade gracefully.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface DocumentListItem {
  id: string;
  title: string;
  role: "owner" | "editor" | "viewer";
  shareMode: string;
  updatedAt: string;
  ownerId: string;
  ownerName: string | null;
  memberCount: number;
}

export interface DocumentDetails {
  id: string;
  title: string;
  role: "owner" | "editor" | "viewer";
  shareMode: "private" | "link-view" | "link-edit";
  owner: { id: string; name: string | null; image: string | null };
  members?: {
    userId: string;
    role: string;
    grantedVia: string;
    name: string | null;
    image: string | null;
    email: string;
  }[];
  memberCount: number;
}

export interface VersionMeta {
  id: string;
  label: string | null;
  isAuto: boolean;
  createdAt: string;
  createdBy: { name: string | null; image: string | null } | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) return null;
    const body = await res.json();
    // Auth.js session endpoint returns the object directly; our API wraps in {ok,data}.
    return (body && typeof body === "object" && "data" in body ? body.data : body) as T;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const session = await json<{ user?: SessionUser }>("/api/auth/session");
  return session?.user?.id ? session.user : null;
}

/** Auth.js double-submit CSRF token — required by the custom /signin and
 *  /signout pages, whose forms POST directly to the Auth.js endpoints. */
export async function getCsrfToken(): Promise<string | null> {
  const body = await json<{ csrfToken?: string }>("/api/auth/csrf");
  return body?.csrfToken ?? null;
}

export function listDocuments(): Promise<{ documents: DocumentListItem[] } | null> {
  return json("/api/documents");
}

export function createRemoteDocument(id: string, title: string): Promise<{ id: string } | null> {
  return json("/api/documents", { method: "POST", body: JSON.stringify({ id, title }) });
}

export function getDocument(docId: string): Promise<DocumentDetails | null> {
  return json(`/api/documents/${docId}`);
}

export function patchDocument(
  docId: string,
  patch: { title?: string; shareMode?: string },
): Promise<{ id: string } | null> {
  return json(`/api/documents/${docId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/**
 * Permanently delete a document (owner only) — the server hard-deletes
 * the row and cascades to members, updates, versions, and comments.
 * Returns true when the server no longer has the document: a successful
 * delete OR a 404 (never registered / already gone), so callers can
 * safely clean up local state. False means the delete did NOT happen
 * (offline, or not the owner).
 */
export async function deleteDocument(docId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export function mintToken(
  docId: string,
): Promise<{ token: string; wsUrl: string; expiresIn: number } | null> {
  return json(`/api/documents/${docId}/token`, { method: "POST", body: "{}" });
}

export function listVersions(docId: string): Promise<{ versions: VersionMeta[] } | null> {
  return json(`/api/documents/${docId}/versions`);
}

export function createVersion(
  docId: string,
  label?: string,
): Promise<{ id: string; label: string | null } | null> {
  return json(`/api/documents/${docId}/versions`, {
    method: "POST",
    body: JSON.stringify(label ? { label } : {}),
  });
}

export async function fetchVersionState(docId: string, versionId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`/api/documents/${docId}/versions/${versionId}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function restoreVersion(
  docId: string,
  versionId: string,
): Promise<{ newVersionId: string } | null> {
  return json(`/api/documents/${docId}/restore`, {
    method: "POST",
    body: JSON.stringify({ versionId }),
  });
}

export function inviteMember(
  docId: string,
  email: string,
  role: "editor" | "viewer",
): Promise<{ userId?: string; pending?: boolean } | null> {
  return json(`/api/documents/${docId}/members`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export function changeMemberRole(
  docId: string,
  userId: string,
  role: "editor" | "viewer",
): Promise<{ userId: string } | null> {
  return json(`/api/documents/${docId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function removeMember(docId: string, userId: string): Promise<{ removed: boolean } | null> {
  return json(`/api/documents/${docId}/members/${userId}`, { method: "DELETE" });
}
