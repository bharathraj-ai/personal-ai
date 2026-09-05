import { join } from "node:path";
import { CompositeStorageService } from "./composite-storage.js";
import { LocalFileStorageService } from "./local-file-storage.js";
import { createGoogleDriveFromEnv } from "./google-drive-adapter.js";
import { createS3StorageFromEnv } from "./s3-storage-service.js";
import type { StorageService } from "./storage-service.js";

/** S3 when configured; otherwise local-file storage. Optional Drive mirror via STORAGE_POLICY. */
export function createStorageFromEnv(): StorageService {
  const s3 = createS3StorageFromEnv();
  const root =
    process.env.LOCAL_STORAGE_ROOT?.trim() ??
    join(process.cwd(), "../../data/storage");
  const primary: StorageService = s3 ?? new LocalFileStorageService(root);
  const policy = (process.env.STORAGE_POLICY ?? "s3").toLowerCase();
  const drive = createGoogleDriveFromEnv();
  if (drive && (policy === "drive" || policy === "s3_and_drive" || policy === "s3+drive")) {
    if (policy === "drive") return new CompositeStorageService(drive, primary);
    return new CompositeStorageService(primary, drive);
  }
  return primary;
}

export type { StorageService, StorageHealth, StorageObjectMetadata } from "./storage-service.js";
export { S3StorageService, createS3StorageFromEnv } from "./s3-storage-service.js";
export { LocalFileStorageService } from "./local-file-storage.js";
export { GoogleDriveAdapter, createGoogleDriveFromEnv } from "./google-drive-adapter.js";
export { CompositeStorageService } from "./composite-storage.js";
export {
  assertSafeSegment,
  userProjectKey,
  userProjectPrefix,
  isKeyOwnedByUser,
  isKeyOwnedByProject,
} from "./path-utils.js";
export {
  ProjectPersistenceService,
  type ProjectSyncResult,
  type ProjectRestoreResult,
} from "./project-persistence.js";
