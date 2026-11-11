import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../env.js";

/**
 * Cifra simétrica (AES-256-GCM) para segredos persistidos na BD — credenciais
 * da AT e das transportadoras. Formato: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
let cachedKey: Buffer | null = null;
const key = () =>
  (cachedKey ??= scryptSync(env.SECRETS_KEY || env.JWT_SECRET, "transitum-secrets-v1", 32));

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(token: string): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("segredo inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export const encryptJson = (v: Record<string, string>) => encryptSecret(JSON.stringify(v));
export const decryptJson = (t: string | null | undefined): Record<string, string> =>
  t ? (JSON.parse(decryptSecret(t)) as Record<string, string>) : {};
