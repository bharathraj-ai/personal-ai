import { userProjectKey, userProjectPrefix } from "./path-utils.js";
import type {
  PresignedUrlResult,
  StorageHealth,
  StorageObjectMetadata,
  StorageService,
} from "./storage-service.js";

export interface GoogleDriveAdapterConfig {
  accessToken: string;
  folderId: string;
  apiBase?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
}

/**
 * Optional Google Drive backend behind StorageService.
 * Credentials never leave this adapter — Bharath / tools only see StorageService.
 * Access is scoped to a single authorized folder (GOOGLE_DRIVE_FOLDER_ID).
 * Does not scan or ingest the rest of Drive.
 */
export class GoogleDriveAdapter implements StorageService {
  readonly id = "google-drive";
  private readonly apiBase: string;

  constructor(private readonly config: GoogleDriveAdapterConfig) {
    this.apiBase = config.apiBase ?? "https://www.googleapis.com";
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      ...extra,
    };
  }

  private fileName(userId: string, projectId: string, relativePath: string): string {
    return userProjectKey(userId, projectId, relativePath).replace(/\//g, "__");
  }

  async healthCheck(): Promise<StorageHealth> {
    const start = Date.now();
    if (!this.config.accessToken || !this.config.folderId) {
      return {
        state: "NOT_CONFIGURED",
        message: "Google Drive folder + access token required",
        latencyMs: Date.now() - start,
      };
    }
    try {
      const url = `${this.apiBase}/drive/v3/files/${encodeURIComponent(this.config.folderId)}?fields=id,name`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        return {
          state: "FAILED",
          message: `Drive folder check HTTP ${res.status}`,
          latencyMs: Date.now() - start,
        };
      }
      return {
        state: "CONNECTED",
        bucket: this.config.folderId,
        message: "google-drive scoped folder",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        state: "FAILED",
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  private async findByName(name: string): Promise<DriveFile | null> {
    const q = `'${this.config.folderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    const url = `${this.apiBase}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=5`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) return null;
    const body = (await res.json()) as { files?: DriveFile[] };
    return body.files?.[0] ?? null;
  }

  async upload(
    userId: string,
    projectId: string,
    relativePath: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<StorageObjectMetadata> {
    const key = userProjectKey(userId, projectId, relativePath);
    const name = this.fileName(userId, projectId, relativePath);
    const buf = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
    const mime = contentType ?? "application/octet-stream";
    const existing = await this.findByName(name);

    const metadata = existing
      ? { name }
      : { name, parents: [this.config.folderId] };
    const boundary = "pai_drive_" + Date.now();
    const prefix =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
    const suffix = `\r\n--${boundary}--`;
    const payload = Buffer.concat([Buffer.from(prefix), buf, Buffer.from(suffix)]);

    const endpoint = existing
      ? `${this.apiBase}/upload/drive/v3/files/${existing.id}?uploadType=multipart`
      : `${this.apiBase}/upload/drive/v3/files?uploadType=multipart`;
    const method = existing ? "PATCH" : "POST";
    const res = await fetch(endpoint, {
      method,
      headers: this.headers({
        "Content-Type": `multipart/related; boundary=${boundary}`,
      }),
      body: payload,
    });
    if (!res.ok) {
      throw new Error(`Google Drive upload failed (${res.status})`);
    }
    return {
      key,
      sizeBytes: buf.length,
      contentType: mime,
      lastModified: new Date(),
    };
  }

  async download(userId: string, projectId: string, relativePath: string): Promise<Buffer> {
    const name = this.fileName(userId, projectId, relativePath);
    const file = await this.findByName(name);
    if (!file) throw new Error("Drive object not found");
    const res = await fetch(`${this.apiBase}/drive/v3/files/${file.id}?alt=media`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Google Drive download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    const name = this.fileName(userId, projectId, relativePath);
    const file = await this.findByName(name);
    if (!file) return false;
    const res = await fetch(`${this.apiBase}/drive/v3/files/${file.id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    return res.ok || res.status === 204;
  }

  async list(
    userId: string,
    projectId: string,
    prefix = "",
  ): Promise<StorageObjectMetadata[]> {
    const keyPrefix = userProjectPrefix(userId, projectId);
    const want = prefix ? `${keyPrefix}/${prefix.replace(/^\/+|\/+$/g, "")}` : keyPrefix;
    const q = `'${this.config.folderId}' in parents and trashed = false`;
    const url = `${this.apiBase}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=100`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) return [];
    const body = (await res.json()) as { files?: DriveFile[] };
    const items: StorageObjectMetadata[] = [];
    for (const f of body.files ?? []) {
      const rel = f.name.replace(/__/g, "/");
      if (!rel.startsWith(want) && !rel.includes(prefix)) continue;
      items.push({
        key: rel,
        sizeBytes: Number(f.size ?? 0),
        contentType: f.mimeType,
        lastModified: f.modifiedTime ? new Date(f.modifiedTime) : undefined,
      });
    }
    return items;
  }

  async exists(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    return Boolean(await this.findByName(this.fileName(userId, projectId, relativePath)));
  }

  async metadata(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<StorageObjectMetadata | null> {
    const file = await this.findByName(this.fileName(userId, projectId, relativePath));
    if (!file) return null;
    return {
      key: userProjectKey(userId, projectId, relativePath),
      sizeBytes: Number(file.size ?? 0),
      contentType: file.mimeType,
      lastModified: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
    };
  }

  async presignedUpload(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<PresignedUrlResult> {
    const key = userProjectKey(userId, projectId, relativePath);
    return {
      url: "",
      key,
      expiresAt: new Date(Date.now() + 900_000),
    };
  }

  async presignedDownload(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<PresignedUrlResult> {
    const key = userProjectKey(userId, projectId, relativePath);
    return {
      url: "",
      key,
      expiresAt: new Date(Date.now() + 900_000),
    };
  }
}

export function createGoogleDriveFromEnv(): GoogleDriveAdapter | null {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  const accessToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN?.trim();
  if (!folderId || !accessToken) return null;
  return new GoogleDriveAdapter({ folderId, accessToken });
}
