import { createHash } from "node:crypto";

export const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "upload.bin";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return safe || "upload.bin";
}

export function assertOwnedObjectKey(objectKey: string, userId: string): void {
  const expectedPrefix = `uploads/${userId}/`;
  if (!objectKey.startsWith(expectedPrefix) || objectKey.includes("..")) {
    throw new Error("INVALID_OBJECT_KEY");
  }
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deterministicJobId(userId: string, idempotencyKey: string): string {
  return hashText(`${userId}:${idempotencyKey}`).slice(0, 32);
}
