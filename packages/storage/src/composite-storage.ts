import type {
  PresignedUrlResult,
  StorageHealth,
  StorageObjectMetadata,
  StorageService,
} from "./storage-service.js";

/**
 * Writes to primary (S3 or local-file) and optionally mirrors to Google Drive.
 * Reads prefer primary; Drive is a secondary personal/project backend.
 */
export class CompositeStorageService implements StorageService {
  readonly id: string;

  constructor(
    private readonly primary: StorageService,
    private readonly secondary?: StorageService | null,
  ) {
    this.id = secondary ? `${primary.id}+${secondary.id}` : primary.id;
  }

  async healthCheck(): Promise<StorageHealth> {
    const a = await this.primary.healthCheck();
    if (!this.secondary) return a;
    const b = await this.secondary.healthCheck();
    return {
      state: a.state,
      bucket: a.bucket,
      message: `${this.primary.id}:${a.state}; ${this.secondary.id}:${b.state}`,
      latencyMs: (a.latencyMs ?? 0) + (b.latencyMs ?? 0),
    };
  }

  async upload(
    userId: string,
    projectId: string,
    relativePath: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<StorageObjectMetadata> {
    const meta = await this.primary.upload(userId, projectId, relativePath, body, contentType);
    if (this.secondary) {
      try {
        await this.secondary.upload(userId, projectId, relativePath, body, contentType);
      } catch {
        // Primary write succeeded — Drive is optional.
      }
    }
    return meta;
  }

  async download(userId: string, projectId: string, relativePath: string): Promise<Buffer> {
    try {
      return await this.primary.download(userId, projectId, relativePath);
    } catch (err) {
      if (!this.secondary) throw err;
      return this.secondary.download(userId, projectId, relativePath);
    }
  }

  async delete(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    const ok = await this.primary.delete(userId, projectId, relativePath);
    if (this.secondary) {
      try {
        await this.secondary.delete(userId, projectId, relativePath);
      } catch {
        /* optional */
      }
    }
    return ok;
  }

  async list(
    userId: string,
    projectId: string,
    prefix?: string,
  ): Promise<StorageObjectMetadata[]> {
    return this.primary.list(userId, projectId, prefix);
  }

  async exists(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    if (await this.primary.exists(userId, projectId, relativePath)) return true;
    if (this.secondary) return this.secondary.exists(userId, projectId, relativePath);
    return false;
  }

  async metadata(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<StorageObjectMetadata | null> {
    const m = await this.primary.metadata(userId, projectId, relativePath);
    if (m || !this.secondary) return m;
    return this.secondary.metadata(userId, projectId, relativePath);
  }

  async presignedUpload(
    userId: string,
    projectId: string,
    relativePath: string,
    contentType?: string,
    expiresSeconds?: number,
  ): Promise<PresignedUrlResult> {
    return this.primary.presignedUpload(userId, projectId, relativePath, contentType, expiresSeconds);
  }

  async presignedDownload(
    userId: string,
    projectId: string,
    relativePath: string,
    expiresSeconds?: number,
  ): Promise<PresignedUrlResult> {
    return this.primary.presignedDownload(userId, projectId, relativePath, expiresSeconds);
  }
}
