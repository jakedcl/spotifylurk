import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { requiredEnv } from "./env";

function encryptionKey() {
  const raw = requiredEnv("TOKEN_ENCRYPTION_KEY");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32 && raw !== decoded.toString("utf8")) return decoded;
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  const [ivPart, tagPart, bodyPart] = payload.split(".");
  if (!ivPart || !tagPart || !bodyPart) throw new Error("Stored token is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64url")), decipher.final()]);
  return plain.toString("utf8");
}
