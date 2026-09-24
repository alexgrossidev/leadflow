import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { logger } from "../logger/logger";

interface FileStorageCreationData {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucketName: string;
  /** Path-style URLs (`endpoint/bucket/key`), required by MinIO and most S3-compatible stores. */
  forcePathStyle?: boolean;
}

export class FileStorage {
  private static instance: FileStorage;
  private client: S3Client;
  private bucket: string;
  private endpoint: string;

  private constructor(data: FileStorageCreationData) {
    this.bucket = data.bucketName;
    this.endpoint = data.endpoint;
    this.client = new S3Client({
      endpoint: data.endpoint,
      region: data.region,
      forcePathStyle: data.forcePathStyle ?? false,
      credentials: {
        accessKeyId: data.accessKey,
        secretAccessKey: data.secretKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  /**
   * Access the singleton instance
   */
  public static getInstance(): FileStorage {
    if (!FileStorage.instance) {
      throw new Error(
        "Filestorage singleton instance has not been created yet.",
      );
    }
    return FileStorage.instance;
  }

  public static async createInstance(
    data: FileStorageCreationData,
  ): Promise<FileStorage> {
    FileStorage.instance ??= new FileStorage(data);
    return FileStorage.instance;
  }

  public async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));

      return {
        ok: true,
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * The single chokepoint that turns any caller-supplied reference into the
   * bucket-relative object key the S3 API expects. Accepts a bare key, a
   * leading-slash key, a `${bucket}/key` path, or a full endpoint URL (e.g. the
   * `fileUrl` returned by getUploadUrl). This is what stops a public URL from
   * ever being used verbatim as a `Key` and resolving to NoSuchKey.
   */
  public normalizeKey(reference: string): string {
    let key = reference.trim();

    if (/^https?:\/\//i.test(key)) {
      key = decodeURIComponent(new URL(key).pathname);
    }

    key = key.replace(/^\/+/, "");

    if (key.startsWith(`${this.bucket}/`)) {
      key = key.slice(this.bucket.length + 1);
    }

    return key;
  }

  /**
   * HEAD probe so producers can fail fast at the API boundary when a key does
   * not resolve to a stored object, instead of enqueuing a job that will only
   * crash later in a background worker.
   */
  public async hasObject(fileKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.normalizeKey(fileKey),
        }),
      );
      return true;
    } catch (error) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        err.name === "NotFound" ||
        err.name === "NoSuchKey" ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      // Auth/network failures must not masquerade as "missing object".
      throw error;
    }
  }

  public async getFileStream(fileKey: string): Promise<Readable> {
    const key = this.normalizeKey(fileKey);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`File not found: ${key}`);
    }

    return response.Body as Readable;
  }

  public async getUploadUrl(
    fileKey: string,
    contentType: string,
    expiresInSeconds: number = 900,
  ): Promise<{ uploadUrl: string; fileUrl: string }> {
    const key = this.normalizeKey(fileKey);
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(this.client, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["host", "content-type"]),
      });

      // Path-style reference; normalizeKey() accepts it back, so callers can
      // round-trip it regardless of how the store actually serves objects.
      const cleanEndpoint = this.endpoint.replace(/\/$/, "");
      const fileUrl = `${cleanEndpoint}/${this.bucket}/${key}`;

      return {
        uploadUrl,
        fileUrl,
      };
    } catch (error) {
      logger.error({ err: error, key }, "Failed to presign upload URL");
      throw new Error(
        "Could not generate secure upload link. Please try again later.",
      );
    }
  }

  public async deleteFile(fileKey: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.normalizeKey(fileKey),
    });
    return this.client.send(command);
  }

  public async getDownloadUrl(
    fileKey: string,
    expiresInSeconds: number = 3600,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.normalizeKey(fileKey),
      });

      const signedUrl = await getSignedUrl(this.client, command, {
        expiresIn: expiresInSeconds,
      });

      return signedUrl;
    } catch (error) {
      logger.error({ err: error }, "Failed to presign download URL");
      throw new Error("Could not generate download URL");
    }
  }
}
