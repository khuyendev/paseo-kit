// The kit's digests: sha256 hex, and the line-ending-insensitive text digest used for ownership (INST-04, INV-02).
import crypto from "node:crypto";
import fs from "node:fs";

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

export const textDigest = (text) => sha256(String(text).replace(/\r\n/g, "\n"));

export const fileDigest = (file) => textDigest(fs.readFileSync(file, "utf8"));
