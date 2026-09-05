/**
 * S3 object key helpers — never trust client-supplied userId/projectId in paths.
 * Keys: users/{userId}/projects/{projectId}/...
 */

const UNSAFE = /\.\.|\/\/|^\/|\\|\0/;

export function assertSafeSegment(segment: string, label: string): string {
  const trimmed = segment.trim();
  if (!trimmed || UNSAFE.test(trimmed)) {
    throw new Error(`Invalid ${label}: path traversal or empty segment`);
  }
  return trimmed;
}

export function userProjectPrefix(userId: string, projectId: string): string {
  return `users/${assertSafeSegment(userId, "userId")}/projects/${assertSafeSegment(projectId, "projectId")}`;
}

export function userProjectKey(
  userId: string,
  projectId: string,
  relativePath: string,
): string {
  const prefix = userProjectPrefix(userId, projectId);
  const rel = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!rel || UNSAFE.test(rel)) {
    throw new Error("Invalid relative path for S3 key");
  }
  return `${prefix}/${rel}`;
}

export function isKeyOwnedByUser(key: string, userId: string): boolean {
  const safe = assertSafeSegment(userId, "userId");
  return key.startsWith(`users/${safe}/`);
}

export function isKeyOwnedByProject(key: string, userId: string, projectId: string): boolean {
  const prefix = userProjectPrefix(userId, projectId);
  return key.startsWith(`${prefix}/`) || key === prefix;
}
