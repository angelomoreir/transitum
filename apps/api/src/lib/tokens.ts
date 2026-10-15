import { createHash, randomBytes } from "node:crypto";

/** Token opaco para refresh/convite/recuperação — nunca é guardado em claro. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")

      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "empresa"
  );
}
