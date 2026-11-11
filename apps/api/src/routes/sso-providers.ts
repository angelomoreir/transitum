import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  ssoProviderCreateSchema,
  ssoProviderDtoSchema,
  ssoProviderUpdateSchema,
} from "@transitum/shared";
import { z } from "zod";
import { ssoProviders } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { encryptSecret } from "../lib/secrets.js";
import { env } from "../env.js";

type ProviderRow = typeof ssoProviders.$inferSelect;

/** URL pública da API (redirect_uri do OIDC) — API_BASE_URL ou pedido. */
export const apiBaseUrl = (req: { headers: Record<string, unknown>; protocol: string }) => {
  if (env.API_BASE_URL) return env.API_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "http";
  const host = (req.headers["x-forwarded-host"] as string) ?? (req.headers.host as string) ?? "localhost";
  return `${proto}://${host}`;
};

export const redirectUri = (req: Parameters<typeof apiBaseUrl>[0]) =>
  `${apiBaseUrl(req)}/api/auth/sso/callback`;

const toDto = (p: ProviderRow, req: Parameters<typeof apiBaseUrl>[0]) => ({
  id: p.id,
  name: p.name,
  domain: p.domain,
  clientId: p.clientId,
  authorizeUrl: p.authorizeUrl,
  tokenUrl: p.tokenUrl,
  userinfoUrl: p.userinfoUrl ?? null,
  enabled: p.enabled,
  autoProvision: p.autoProvision,
  defaultRole: p.defaultRole,
  redirectUri: redirectUri(req),
  createdAt: p.createdAt.toISOString(),
});

/**
 * Fornecedores SSO/OIDC do tenant — configuração por administrador.
 * O segredo do cliente é guardado cifrado e nunca devolvido.
 */
export const ssoProviderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: app.requirePermission("tenant:update"),
      schema: { response: { 200: z.object({ items: z.array(ssoProviderDtoSchema) }) } },
    },
    async (req) => {
      const rows = await app.db
        .select()
        .from(ssoProviders)
        .where(eq(ssoProviders.tenantId, req.user.tid))
        .orderBy(ssoProviders.name);
      return { items: rows.map((p) => toDto(p, req)) };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("tenant:update"),
      schema: { body: ssoProviderCreateSchema, response: { 201: z.object({ provider: ssoProviderDtoSchema }) } },
    },
    async (req, reply) => {
      const body = req.body;
      const [dup] = await app.db
        .select({ id: ssoProviders.id })
        .from(ssoProviders)
        .where(and(eq(ssoProviders.tenantId, req.user.tid), eq(ssoProviders.domain, body.domain)));
      if (dup) throw badRequest("Já existe um fornecedor para este domínio");
      const [p] = await app.db
        .insert(ssoProviders)
        .values({
          tenantId: req.user.tid,
          name: body.name,
          domain: body.domain,
          clientId: body.clientId,
          clientSecretEnc: encryptSecret(body.clientSecret),
          authorizeUrl: body.authorizeUrl,
          tokenUrl: body.tokenUrl,
          userinfoUrl: body.userinfoUrl ?? null,
          autoProvision: body.autoProvision,
          defaultRole: body.defaultRole,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "sso_providers.created",
        entity: "sso_provider",
        entityId: p.id,
        metadata: { name: p.name, domain: p.domain },
        ip: req.ip,
      });
      return reply.code(201).send({ provider: toDto(p, req) });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("tenant:update"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ssoProviderUpdateSchema,
        response: { 200: z.object({ provider: ssoProviderDtoSchema }) },
      },
    },
    async (req) => {
      const [p] = await app.db
        .select()
        .from(ssoProviders)
        .where(and(eq(ssoProviders.id, req.params.id), eq(ssoProviders.tenantId, req.user.tid)));
      if (!p) throw notFound("Fornecedor não encontrado");
      const body = req.body;
      const [updated] = await app.db
        .update(ssoProviders)
        .set({
          name: body.name ?? undefined,
          domain: body.domain ?? undefined,
          clientId: body.clientId ?? undefined,
          clientSecretEnc: body.clientSecret ? encryptSecret(body.clientSecret) : undefined,
          authorizeUrl: body.authorizeUrl ?? undefined,
          tokenUrl: body.tokenUrl ?? undefined,
          userinfoUrl: body.userinfoUrl,
          enabled: body.enabled ?? undefined,
          autoProvision: body.autoProvision ?? undefined,
          defaultRole: body.defaultRole ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(ssoProviders.id, p.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "sso_providers.updated",
        entity: "sso_provider",
        entityId: p.id,
        metadata: { name: updated.name, enabled: updated.enabled },
        ip: req.ip,
      });
      return { provider: toDto(updated, req) };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: app.requirePermission("tenant:update"),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const [p] = await app.db
        .delete(ssoProviders)
        .where(and(eq(ssoProviders.id, req.params.id), eq(ssoProviders.tenantId, req.user.tid)))
        .returning();
      if (!p) throw notFound("Fornecedor não encontrado");
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "sso_providers.deleted",
        entity: "sso_provider",
        entityId: p.id,
        metadata: { name: p.name },
        ip: req.ip,
      });
      return { ok: true };
    },
  );
};
