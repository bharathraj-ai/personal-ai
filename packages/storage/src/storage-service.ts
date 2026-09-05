export type StorageConnectionState = "CONNECTED" | "NOT_CONFIGURED" | "FAILED";

export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
}

export interface PresignedUrlResult {
  url: string;
  expiresAt: Date;
  key: string;
}

export interface StorageHealth {
  state: StorageConnectionState;
  bucket?: string;
  message?: string;
  latencyMs?: number;
}

/**
 * Provider-agnostic persistent object storage.
 * Bharath and tools must never receive AWS credentials — only presigned URLs via gateway.
 */
export interface StorageService {
  readonly id: string;
  healthCheck(): Promise<StorageHealth>;
  upload(
    userId: string,
    projectId: string,
    relativePath: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<StorageObjectMetadata>;
  download(userId: string, projectId: string, relativePath: string): Promise<Buffer>;
  delete(userId: string, projectId: string, relativePath: string): Promise<boolean>;
  list(
    userId: string,
    projectId: string,
    prefix?: string,
  ): Promise<StorageObjectMetadata[]>;
  exists(userId: string, projectId: string, relativePath: string): Promise<boolean>;
  metadata(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<StorageObjectMetadata | null>;
  presignedUpload(
    userId: string,
    projectId: string,
    relativePath: string,
    contentType?: string,
    expiresSeconds?: number,
  ): Promise<PresignedUrlResult>;
  presignedDownload(
    userId: string,
    projectId: string,
    relativePath: string,
    expiresSeconds?: number,
  ): Promise<PresignedUrlResult>;
}
