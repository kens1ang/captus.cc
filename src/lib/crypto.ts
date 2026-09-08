import crypto from "node:crypto";
import { config } from "./config.js";

// AES-256-GCM for at-rest encryption of Google Calendar refresh tokens
// (google_calendar_connections.refresh_token_encrypted) — a long-lived
// credential to a real client's calendar, never stored in plaintext.
// TOKEN_ENCRYPTION_KEY must be a 32-byte key, base64-encoded (e.g.
// `openssl rand -base64 32`). Losing/rotating this key strands every
// connected tenant's refresh token — they'd need to reconnect.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size

function getKey(): Buffer {
  const key = Buffer.from(config.tokenEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}) — generate with: openssl rand -base64 32`);
  }
  return key;
}

/** Returns `${iv}:${authTag}:${ciphertext}`, each base64. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

export function decrypt(encoded: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted value (expected iv:authTag:ciphertext)");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

// HMAC-signed (not encrypted — no secrecy needed, just tamper-proofing) state
// for the Google OAuth flow: routes/googleAuth.ts's /connect signs the
// tenant id, and /callback (an unauthenticated route Google itself redirects
// the browser to) verifies it before trusting which tenant a connection
// belongs to. Reuses TOKEN_ENCRYPTION_KEY rather than introducing a second secret.
export function signState(payload: string): string {
  const mac = crypto.createHmac("sha256", getKey()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/** Returns the original payload if the signature is valid, or null if it's missing/tampered/malformed. */
export function verifySignedState(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const payload = signed.slice(0, idx);
  const mac = Buffer.from(signed.slice(idx + 1));
  const expected = Buffer.from(crypto.createHmac("sha256", getKey()).update(payload).digest("base64url"));
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) return null;
  return payload;
}
