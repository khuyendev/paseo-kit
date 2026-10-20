// The kit's digests: sha256 hex, and the line-ending-insensitive text digest used for ownership (INST-04, INV-02).
import crypto from "node:crypto";
import fs from "node:fs";

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

export function textDigest(text) {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(String(text), "utf8");
  const normalized = Buffer.allocUnsafe(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    normalized[length++] = bytes[i];
  }
  return sha256(normalized.subarray(0, length));
}

export const fileDigest = (file) => textDigest(fs.readFileSync(file));
