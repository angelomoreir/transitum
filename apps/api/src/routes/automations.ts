import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  automationCreateSchema,
  automationDtoSchema,
  automationUpdateSchema,
  type AutomationTrigger,
} from "@blujay/shared";
import { z } from "zod";
import { automationRules } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";

type RuleRow = typeof automationRules.$inferSelect;

const toDto = (r: RuleRow) => ({
  id: r.id,
  name: r.name,
  trigger: r.trigger as AutomationTrigger,
  action: r.action as "notify",
  active: r.active,
  createdAt: r.createdAt.toISOString(),
});

export const automationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: app.requirePermission("automations:read"),
      schema: { response: { 200: z.object({ items: z.array(automationDtoSchema) }) } },
    },
    async (req) => {
      const rows = await app.db
        .select()
        .from(automationRules)
        .where(eq(automationRules.tenantId, req.user.tid))
        .orderBy(desc(automationRules.createdAt));
      return { items: rows.map(toDto) };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("automations:write"),
      schema: {
        body: automationCreateSchema,
        response: { 201: z.object({ rule: automationDtoSchema }) },
      },
    },
    async (req, reply) => {
      const [rule] = await app.db
        .insert(automationRules)
        .values({ tenantId: req.user.tid, ...req.body })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "automations.created",
        entity: "automation_rule",
        entityId: rule.id,
        metadata: { trigger: rule.trigger },
        ip: req.ip,
      });
      return reply.code(201).send({ rule: toDto(rule) });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("automations:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: automationUpdateSchema,
        response: { 200: z.object({ rule: automationDtoSchema }) },
      },
    },
    async (req) => {
      const [rule] = await app.db
        .select()
        .from(automationRules)
        .where(
          and(eq(automationRules.id, req.params.id), eq(automationRules.tenantId, req.user.tid)),
        );
      if (!rule) throw notFound("Regra não encontrada");
      const [updated] = await app.db
        .update(automationRules)
        .set(req.body)
        .where(eq(automationRules.id, rule.id))
        .returning();
      return { rule: toDto(updated) };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: app.requirePermission("automations:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const [rule] = await app.db
        .select()
        .from(automationRules)
        .where(
          and(eq(automationRules.id, req.params.id), eq(automationRules.tenantId, req.user.tid)),
        );
      if (!rule) throw notFound("Regra não encontrada");
      await app.db.delete(automationRules).where(eq(automationRules.id, rule.id));
      return { ok: true as const };
    },
  );
};
