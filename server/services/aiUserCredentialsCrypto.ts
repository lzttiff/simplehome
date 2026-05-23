import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getAiUserCredentialsEncryptionKey } from "./runtimeConfig";

const DEV_FALLBACK_KEY = "simplehome-dev-ai-user-credentials-key";

function getEncryptionSecret(): string | null {
  const configured = getAiUserCredentialsEncryptionKey();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return DEV_FALLBACK_KEY;
}

function toKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function isAiUserCredentialsCryptoConfigured(): boolean {
  return !!getEncryptionSecret();
}

export function encryptAiUserCredential(plainText: string): string {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error("AI user credentials encryption is not configured. Set AI_USER_CREDENTIALS_ENCRYPTION_KEY.");
  }

  const iv = randomBytes(12);
  const key = toKey(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptAiUserCredential(value: string): string {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error("AI user credentials encryption is not configured. Set AI_USER_CREDENTIALS_ENCRYPTION_KEY.");
  }

  const [ivRaw, tagRaw, payloadRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !payloadRaw) {
    throw new Error("Invalid encrypted AI credential payload.");
  }

  const key = toKey(secret);
  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const payload = Buffer.from(payloadRaw, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString("utf8");
}
