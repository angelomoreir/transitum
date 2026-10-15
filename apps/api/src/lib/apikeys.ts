import { createHash, randomBytes } from "node:crypto";

/** Gera uma chave de API `bjk_<prefixo>_<segredo>`; devolve partes para persistir/mostrar. */
export function generateApiKey() {
  const prefix = `bjk_${randomBytes(4).toString("hex")}`;
  const key = `${prefix}_${randomBytes(24).toString("hex")}`;
  return { key, prefix, keyHash: hashApiKey(key) };
}

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}
