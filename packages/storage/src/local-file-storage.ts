import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { userProjectKey } from "./path-utils.js";
import type {
  PresignedUrlResult,
  StorageHealth,
  StorageObjectMetadata,
  StorageService,
} from "./storage-service.js";

/**
 * Local filesystem storage — fallback when S3 is not configured.
 * Same key layout: users/{userId}/projects/{projectId}/...
 */
export class LocalFileStorageService implements StorageService {
  readonly id = "local-file";

  constructor(private readonly rootDir: string) {}

  private absPath(userId: string, projectId: string, relativePath: string): string {
    const key = userProjectKey(userId, projectId, relativePath);
    return join(this.rootDir, key);
  }

  async healthCheck(): Promise<StorageHealth> {
    const start = Date.now();
    try {
      await mkdir(this.rootDir, { recursive: true });
      return {
        state: "CONNECTED",
        bucket: this.rootDir,
        message: "local-file storage",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        state: "FAILED",
        bucket: this.rootDir,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  async upload(
    userId: string,
    projectId: string,
    relativePath: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<StorageObjectMetadata> {
    const abs = this.absPath(userId, projectId, relativePath);
    await mkdir(dirname(abs), { recursive: true });
    const buf = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
    await writeFile(abs, buf);
    return {
      key: userProjectKey(userId, projectId, relativePath),
      sizeBytes: buf.length,
      contentType,
      lastModified: new Date(),
    };
  }

  async download(userId: string, projectId: string, relativePath: string): Promise<Buffer> {
    return readFile(this.absPath(userId, projectId, relativePath));
  }

  async delete(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    await unlink(this.absPath(userId, projectId, relativePath));
    return true;
  }

  async list(
    userId: string,
    projectId: string,
    prefix = "",
  ): Promise<StorageObjectMetadata[]> {
    const relBase = prefix.replace(/\/$/, "");
    const base = relBase
      ? this.absPath(userId, projectId, relBase)
      : dirname(this.absPath(userId, projectId, ".keep"));
    const items: StorageObjectMetadata[] = [];

    async function walk(dir: string, relPrefix: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(full, rel);
        } else {
          const st = await stat(full);
          items.push({
            key: userProjectKey(userId, projectId, rel),
            sizeBytes: st.size,
            lastModified: st.mtime,
          });
        }
      }
    }
    await walk(base, relBase);
    return items;
  }

  async exists(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    try {
      await stat(this.absPath(userId, projectId, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async metadata(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<StorageObjectMetadata | null> {
    try {
      const st = await stat(this.absPath(userId, projectId, relativePath));
      return {
        key: userProjectKey(userId, projectId, relativePath),
        sizeBytes: st.size,
        lastModified: st.mtime,
      };
    } catch {
      return null;
    }
  }

  async presignedUpload(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<PresignedUrlResult> {
    const key = userProjectKey(userId, projectId, relativePath);
    return {
      url: `file://${this.absPath(userId, projectId, relativePath)}`,
      key,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  async presignedDownload(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<PresignedUrlResult> {
    const key = userProjectKey(userId, projectId, relativePath);
    return {
      url: `file://${this.absPath(userId, projectId, relativePath)}`,
      key,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }
}
