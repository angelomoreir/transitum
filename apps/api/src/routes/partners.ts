import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listPartnersQuerySchema,
  partnerCreateSchema,
  partnerDtoSchema,
  partnerUpdateSchema,
} from "@blujay/shared";
import { z } from "zod";
import { partners } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";

const listResponse = z.object({
  items: z.array(partnerDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type PartnerRow = typeof partners.$inferSelect;

function toDto(p: PartnerRow) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    code: p.code,
    types: p.types,
    name: p.name,
    taxId: p.taxId ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    addressLine1: p.addressLine1 ?? null,
    city: p.city ?? null,
    postalCode: p.postalCode ?? null,
    country: p.country,
    active: p.active,
    notes: p.notes ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export const partnerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: app.requirePermission("partners:read"),
      schema: { querystring: listPartnersQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, q, type, active } = req.query;
      const conditions = [eq(partners.tenantId, req.user.tid)];
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            ilike(partners.name, pattern),
            ilike(partners.code, pattern),
            ilike(partners.email, pattern),
            ilike(partners.taxId, pattern),
          )!,
        );
      }
      if (type) conditions.push(sql`${partners.types} @> ARRAY[${type}]::partner_type[]`);
      if (active !== undefined) conditions.push(eq(partners.active, active));

      const where = and(...conditions);
      const [items, [{ count }]] = await Promise.all([
        app.db
          .select()
          .from(partners)
          .where(where)
          .orderBy(desc(partners.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(partners).where(where),
      ]);
      return { items: items.map(toDto), total: count, page, pageSize };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("partners:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ partner: partnerDtoSchema }) },
      },
    },
    async (req) => {
      const [partner] = await app.db
        .select()
        .from(partners)
        .where(and(eq(partners.id, req.params.id), eq(partners.tenantId, req.user.tid)));
      if (!partner) throw notFound("Parceiro não encontrado");
      return { partner: toDto(partner) };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("partners:write"),
      schema: {
        body: partnerCreateSchema,
        response: { 201: z.object({ partner: partnerDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      // Código com prefixo do primeiro tipo declarado
      const code = await nextNumber(app.db, req.user.tid, `partner:${body.types[0]}`);
      const [partner] = await app.db
        .insert(partners)
        .values({ ...body, tenantId: req.user.tid, code })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "partners.created",
        entity: "partner",
        entityId: partner.id,
        metadata: { name: partner.name, types: partner.types },
        ip: req.ip,
      });
      return reply.code(201).send({ partner: toDto(partner) });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("partners:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: partnerUpdateSchema,
        response: { 200: z.object({ partner: partnerDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(partners)
        .where(and(eq(partners.id, req.params.id), eq(partners.tenantId, req.user.tid)));
      if (!target) throw notFound("Parceiro não encontrado");
      if (req.body.types && req.body.types.length === 0) {
        throw badRequest("O parceiro tem de ter pelo menos um tipo");
      }
      const [updated] = await app.db
        .update(partners)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(partners.id, target.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "partners.updated",
        entity: "partner",
        entityId: target.id,
        metadata: req.body,
        ip: req.ip,
      });
      return { partner: toDto(updated) };
    },
  );

  // Arquivar/reativar (soft delete — preserva integridade referencial)
  app.delete(
    "/:id",
    {
      preHandler: app.requirePermission("partners:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ partner: partnerDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(partners)
        .where(and(eq(partners.id, req.params.id), eq(partners.tenantId, req.user.tid)));
      if (!target) throw notFound("Parceiro não encontrado");
      const [updated] = await app.db
        .update(partners)
        .set({ active: !target.active, updatedAt: new Date() })
        .where(eq(partners.id, target.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: updated.active ? "partners.reactivated" : "partners.deactivated",
        entity: "partner",
        entityId: target.id,
        ip: req.ip,
      });
      return { partner: toDto(updated) };
    },
  );
};
