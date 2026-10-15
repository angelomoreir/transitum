import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createMemoryMailer } from "../src/lib/mailer.js";

export interface TestApp {
  app: FastifyInstance;
  mailer: ReturnType<typeof createMemoryMailer>;
}

export async function createTestApp(): Promise<TestApp> {
  const mailer = createMemoryMailer();
  const app = await buildApp({ logger: false, mailer });
  await app.ready();
  return { app, mailer };
}

export async function registerTenant(
  app: FastifyInstance,
  opts: { companyName?: string; name?: string; email?: string; password?: string } = {},
) {
  const body = {
    companyName: opts.companyName ?? `Empresa ${crypto.randomUUID().slice(0, 8)}`,
    name: opts.name ?? "Admin Teste",
    email: opts.email ?? `admin-${crypto.randomUUID().slice(0, 8)}@teste.pt`,
    password: opts.password ?? "Password123",
  };
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: body });
  return { res, body };
}

export function extractToken(text: string): string {
  const m = text.match(/token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("Token não encontrado no email");
  return m[1];
}
