import * as path from "path";
import * as crypto from "crypto";
import { KeyGenPath } from "./keygen.registry";

export interface FileKeyPayload {
  userId: string;
  businessId: string;
  path: KeyGenPath;
  originalFileName: string;
}

export function generateB2FilePath(payload: FileKeyPayload): string {
  const { userId, businessId, originalFileName } = payload;

  // 1. Validation to ensure no empty path segments are generated
  if (!userId?.trim() || !businessId?.trim() || !originalFileName?.trim()) {
    throw new Error(
      "Invalid payload: userId, businessId, and originalFileName are required.",
    );
  }

  // 2. Extract and sanitize the file extension
  const ext = path.extname(originalFileName).toLowerCase(); // e.g., ".pdf"

  // 3. Sanitize the base name (remove special characters, replace spaces with hyphens)
  const baseName = path
    .basename(originalFileName, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-") // Replace non-alphanumeric characters with hyphens
    .replace(/-+/g, "-") // Collapse consecutive hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens

  // 4. Create a unique identifier to prevent overwriting existing files
  const timestamp = Date.now();
  const uniqueId = crypto.randomBytes(4).toString("hex"); // Short, fast random string

  // 5. Construct the final key according to your pattern: origin/userId/businessId/files
  // We sanitize userId and businessId just in case they contain malicious path traversal characters (like ../)
  const safeUserId = encodeURIComponent(userId.trim());
  const safeBusinessId = encodeURIComponent(businessId.trim());

  return `${payload.path}/${safeUserId}/${safeBusinessId}/${baseName}-${timestamp}-${uniqueId}${ext}`;
}
