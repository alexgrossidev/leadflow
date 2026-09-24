import { env } from "#config/env";
import { ForbiddenError } from "./errors/http-errors.js";
import { FileStorage, generateB2FilePath, KeyGenPath } from "@leadflow/shared/storage";

export async function bootstrapFileStorage(): Promise<void> {
  await FileStorage.createInstance(
    {
      endpoint: env.S3_ENDPOINT,
      accessKey: env.S3_ACCESS_KEY_ID,
      region: env.S3_REGION,
      secretKey: env.S3_SECRET_ACCESS_KEY,
      bucketName: env.S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  );
}

/**
 * Presigns an upload into the tenant's own key space:
 * `<pathType>/<userId>/<businessId>/<sanitised-name>-<timestamp>-<random>.<ext>`.
 * The returned `storageKey` is what the client echoes back afterwards.
 */
export async function createUploadRequest(
  userId: number,
  businessId: number,
  fileName: string,
  contentType: string,
  pathType: KeyGenPath,
) {
  const storageKey = generateB2FilePath({
    path: pathType,
    originalFileName: fileName,
    businessId: businessId.toString(),
    userId: userId.toString(),
  });
  const upload = await FileStorage.getInstance().getUploadUrl(storageKey, contentType);
  return { ...upload, storageKey };
}

/** True when `key` is a single object directly inside the business's prefix for `pathType`. */
export function isTenantKey(key: string, pathType: KeyGenPath, businessId: number): boolean {
  const segments = key.split("/");
  return (
    segments.length === 4 &&
    segments[0] === pathType &&
    /^\d+$/.test(segments[1] ?? "") &&
    segments[2] === String(businessId) &&
    /^[a-z0-9][\w.-]*$/i.test(segments[3] ?? "")
  );
}

/**
 * Canonicalises a client-supplied storage reference (key or public URL) and
 * rejects anything outside the tenant's prefix, so one business can never make
 * the gateway read or sign another business's objects.
 */
export function resolveTenantKey(
  reference: string,
  pathType: KeyGenPath,
  businessId: number,
): string {
  const key = FileStorage.getInstance().normalizeKey(reference);
  if (!isTenantKey(key, pathType, businessId)) {
    throw new ForbiddenError("Storage key is outside this business", "STORAGE_KEY_FORBIDDEN");
  }
  return key;
}
