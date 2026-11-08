import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "@platform/core";

export interface ObjectStorage {
  readonly kind: "s3" | "memory";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedDownloadUrl(key: string, opts: { fileName: string; contentType: string; ttlSeconds?: number; inline?: boolean }): Promise<string>;
  ensureBucket(): Promise<void>;
  ping(): Promise<boolean>;
}

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

const MAX_TTL = 300;

function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export class S3Storage implements ObjectStorage {
  readonly kind = "s3" as const;
  private client: S3Client;
  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new AppError("NOT_FOUND", "Object body missing");
    return Buffer.from(await res.Body.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
  async signedDownloadUrl(key: string, opts: { fileName: string; contentType: string; ttlSeconds?: number; inline?: boolean }) {
    const ttl = Math.min(opts.ttlSeconds ?? MAX_TTL, MAX_TTL);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(opts.fileName, opts.inline ?? false),
        ResponseContentType: opts.contentType,
      }),
      { expiresIn: ttl },
    );
  }
  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
    }
  }
  async ping() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

/** In-memory storage for automated tests only. */
export class MemoryStorage implements ObjectStorage {
  readonly kind = "memory" as const;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new AppError("NOT_FOUND", "Object not found");
    return o.body;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async signedDownloadUrl(key: string, opts: { ttlSeconds?: number }) {
    return `memory://${key}?ttl=${Math.min(opts.ttlSeconds ?? MAX_TTL, MAX_TTL)}`;
  }
  async ensureBucket() {}
  async ping() {
    return true;
  }
}

let instance: ObjectStorage | undefined;

export function getStorage(): ObjectStorage {
  if (instance) return instance;
  const e = process.env;
  if (!e.S3_ENDPOINT && !e.S3_ACCESS_KEY) {
    if (e.APP_ENV === "test") return (instance = new MemoryStorage());
    throw new AppError("INTEGRATION_UNAVAILABLE", "Object storage is not configured", { key: "storage_not_configured" });
  }
  instance = new S3Storage({
    endpoint: e.S3_ENDPOINT || undefined,
    region: e.S3_REGION ?? "us-east-1",
    bucket: e.S3_BUCKET ?? "platform-private",
    accessKeyId: e.S3_ACCESS_KEY,
    secretAccessKey: e.S3_SECRET_KEY,
    forcePathStyle: e.S3_FORCE_PATH_STYLE === "true" || e.S3_FORCE_PATH_STYLE === "1",
  });
  return instance;
}

export function setStorage(s: ObjectStorage | undefined): void {
  instance = s;
}
