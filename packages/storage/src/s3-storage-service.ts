import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { userProjectKey } from "./path-utils.js";
import type {
  PresignedUrlResult,
  StorageHealth,
  StorageObjectMetadata,
  StorageService,
} from "./storage-service.js";

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  defaultPresignSeconds?: number;
}

export class S3StorageService implements StorageService {
  readonly id = "s3";
  private readonly client: S3Client;
  private readonly presignSeconds: number;

  constructor(private readonly config: S3StorageConfig) {
    this.presignSeconds = config.defaultPresignSeconds ?? 900;
    this.client = new S3Client({
      region: config.region ?? "us-east-1",
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  async healthCheck(): Promise<StorageHealth> {
    const start = Date.now();
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          MaxKeys: 1,
          Prefix: "users/",
        }),
      );
      return {
        state: "CONNECTED",
        bucket: this.config.bucket,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        state: "FAILED",
        bucket: this.config.bucket,
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
    const key = userProjectKey(userId, projectId, relativePath);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
        ContentType: contentType,
      }),
    );
    const buf = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
    return {
      key,
      sizeBytes: buf.length,
      contentType,
      etag: result.ETag,
      lastModified: new Date(),
    };
  }

  async download(userId: string, projectId: string, relativePath: string): Promise<Buffer> {
    const key = userProjectKey(userId, projectId, relativePath);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`S3 object empty or missing: ${relativePath}`);
    return Buffer.from(bytes);
  }

  async delete(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    const key = userProjectKey(userId, projectId, relativePath);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    return true;
  }

  async list(
    userId: string,
    projectId: string,
    prefix = "",
  ): Promise<StorageObjectMetadata[]> {
    const base = userProjectKey(userId, projectId, prefix || ".keep").replace(/\/\.keep$/, "/");
    const items: StorageObjectMetadata[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: base,
          ContinuationToken: token,
        }),
      );
      for (const obj of page.Contents ?? []) {
        if (!obj.Key) continue;
        items.push({
          key: obj.Key,
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified,
          etag: obj.ETag,
        });
      }
      token = page.NextContinuationToken;
    } while (token);
    return items;
  }

  async exists(userId: string, projectId: string, relativePath: string): Promise<boolean> {
    const meta = await this.metadata(userId, projectId, relativePath);
    return meta !== null;
  }

  async metadata(
    userId: string,
    projectId: string,
    relativePath: string,
  ): Promise<StorageObjectMetadata | null> {
    const key = userProjectKey(userId, projectId, relativePath);
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        key,
        sizeBytes: head.ContentLength ?? 0,
        contentType: head.ContentType,
        lastModified: head.LastModified,
        etag: head.ETag,
      };
    } catch {
      return null;
    }
  }

  async presignedUpload(
    userId: string,
    projectId: string,
    relativePath: string,
    contentType?: string,
    expiresSeconds?: number,
  ): Promise<PresignedUrlResult> {
    const key = userProjectKey(userId, projectId, relativePath);
    const expires = expiresSeconds ?? this.presignSeconds;
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: expires },
    );
    return { url, key, expiresAt: new Date(Date.now() + expires * 1000) };
  }

  async presignedDownload(
    userId: string,
    projectId: string,
    relativePath: string,
    expiresSeconds?: number,
  ): Promise<PresignedUrlResult> {
    const key = userProjectKey(userId, projectId, relativePath);
    const expires = expiresSeconds ?? this.presignSeconds;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expires },
    );
    return { url, key, expiresAt: new Date(Date.now() + expires * 1000) };
  }
}

export function createS3StorageFromEnv(): S3StorageService | null {
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) return null;
  return new S3StorageService({
    bucket,
    region: process.env.S3_REGION?.trim(),
    endpoint: process.env.S3_ENDPOINT?.trim(),
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    defaultPresignSeconds: Number(process.env.S3_PRESIGN_SECONDS ?? 900),
  });
}
