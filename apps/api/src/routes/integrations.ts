import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  apiKeyCreateSchema,
  apiKeyDtoSchema,
  webhookDeliveryDtoSchema,
} from "@blujay/shared";
import { z } from "zod";
import { apiKeys, users, webhookDeliveries } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { generateApiKey } from "../lib/apikeys.js";
import { notFound } from "../lib/errors.js";

export const integrationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/keys",
    {
      preHandler: app.requirePermission("integrations:read"),
      schema: { response: { 200: z.object({ items: z.array(apiKeyDtoSchema) }) } },
    },
    async (req) => {
      const rows = await app.db
        .select({ k: apiKeys, creatorName: users.name })
        .from(apiKeys)
        .leftJoin(users, eq(apiKeys.createdBy, users.id))
        .where(eq(apiKeys.tenantId, req.user.tid))
        .orderBy(desc(apiKeys.createdAt));
      return {
        items: rows.map((r) => ({
          id: r.k.id,
          name: r.k.name,
          prefix: r.k.prefix,
          active: r.k.active,
          lastUsedAt: r.k.lastUsedAt?.toISOString() ?? null,
          createdByName: r.creatorName ?? null,
          createdAt: r.k.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/keys",
    {
      preHandler: app.requirePermission("integrations:write"),
      schema: {
        body: apiKeyCreateSchema,
        response: {
          201: z.object({ key: apiKeyDtoSchema, secret: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { key, prefix, keyHash } = generateApiKey();
      const [row] = await app.db
        .insert(apiKeys)
        .values({
          tenantId: req.user.tid,
          name: req.body.name,
          prefix,
          keyHash,
          createdBy: req.user.sub,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "integrations.key_created",
        entity: "api_key",
        entityId: row.id,
        metadata: { name: row.name, prefix },
        ip: req.ip,
      });
      return reply.code(201).send({
        key: {
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          active: row.active,
          lastUsedAt: null,
          createdByName: req.user.name,
          createdAt: row.createdAt.toISOString(),
        },
        // devolvido apenas uma vez
        secret: key,
      });
    },
  );

  app.delete(
    "/keys/:id",
    {
      preHandler: app.requirePermission("integrations:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const [key] = await app.db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.tenantId, req.user.tid)));
      if (!key) throw notFound("Chave não encontrada");
      await app.db
        .update(apiKeys)
        .set({ active: false })
        .where(eq(apiKeys.id, key.id));
      return { ok: true as const };
    },
  );

  app.get(
    "/webhook-deliveries",
    {
      preHandler: app.requirePermission("integrations:read"),
      schema: {
        response: { 200: z.object({ items: z.array(webhookDeliveryDtoSchema) }) },
      },
    },
    async (req) => {
      const rows = await app.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.tenantId, req.user.tid))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(50);
      return {
        items: rows.map((d) => ({
          id: d.id,
          url: d.url,
          trigger: d.trigger,
          statusCode: d.statusCode ?? null,
          success: d.success,
          durationMs: d.durationMs ?? null,
          error: d.error ?? null,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    },
  );
};
