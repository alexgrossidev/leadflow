import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { Env } from "#config/env";

/** The two operations the import pipeline needs from object storage. */
export interface ObjectStore {
  /** Object size in bytes from a HEAD request, without downloading the body. */
  sizeOf(key: string): Promise<number | undefined>;
  open(key: string): Promise<Readable>;
}

/**
 * Read-only S3 client for import files. Works against any S3-compatible
 * endpoint; `forcePathStyle` is what makes it work against MinIO.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    config: Pick<
      Env,
      | "S3_ENDPOINT"
      | "S3_REGION"
      | "S3_ACCESS_KEY_ID"
      | "S3_SECRET_ACCESS_KEY"
      | "S3_BUCKET"
      | "S3_FORCE_PATH_STYLE"
    >,
    private readonly bucket = config.S3_BUCKET,
  ) {
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
      // B2 rejects the newer default checksum headers.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  /** Throws if the bucket is unreachable or the credentials are wrong. */
  async ping(): Promise<number> {
    const start = Date.now();
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return Date.now() - start;
  }

  async sizeOf(key: string): Promise<number | undefined> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: normalizeKey(key) }),
    );
    return head.ContentLength;
  }

  async open(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: normalizeKey(key) }),
    );
    if (!(response.Body instanceof Readable)) {
      throw new Error(`Object ${normalizeKey(key)} has no readable body`);
    }
    return response.Body;
  }
}

/** The gateway sends bucket-relative keys; tolerate a leading slash. */
function normalizeKey(key: string): string {
  return key.trim().replace(/^\/+/, "");
}
