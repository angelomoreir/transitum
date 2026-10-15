import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listRatesQuerySchema,
  rateCreateSchema,
  rateDtoSchema,
  rateUpdateSchema,
} from "@blujay/shared";
import { z } from "zod";
import { carrierRates, partners } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

const listResponse = z.object({
  items: z.array(rateDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type RateRow = typeof carrierRates.$inferSelect;

function toDto(r: RateRow, carrierName = "") {
  return {
    id: r.id,
    tenantId: r.tenantId,
    carrierId: r.carrierId,
    carrierName,
    name: r.name,
    basis: r.basis,
    price: r.price,
    currency: r.currency,
    minCharge: r.minCharge ?? null,
    validFrom: r.validFrom ?? null,
    validTo: r.validTo ?? null,
    active: r.active,
    notes: r.notes ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export const rateRoutes: FastifyPluginAsyncZod = async (app) => {
  const baseQuery = () =>
    app.db
      .select({ rate: carrierRates, carrierName: partners.name })
      .from(carrierRates)
      .innerJoin(partners, eq(carrierRates.carrierId, partners.id));

  app.get(
    "/",
    {
      preHandler: app.requirePermission("rates:read"),
      schema: { querystring: listRatesQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, carrierId, active } = req.query;
      const conditions = [eq(carrierRates.tenantId, req.user.tid)];
      if (carrierId) conditions.push(eq(carrierRates.carrierId, carrierId));
      if (active !== undefined) conditions.push(eq(carrierRates.active, active));
      const where = and(...conditions);

      const [items, [{ count }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(carrierRates.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(carrierRates)
          .innerJoin(partners, eq(carrierRates.carrierId, partners.id))
          .where(where),
      ]);
      return {
        items: items.map((r) => toDto(r.rate, r.carrierName)),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("rates:write"),
      schema: {
        body: rateCreateSchema,
        response: { 201: z.object({ rate: rateDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const [carrier] = await app.db
        .select()
        .from(partners)
        .where(
          and(
            eq(partners.id, body.carrierId),
            eq(partners.tenantId, req.user.tid),
            eq(partners.active, true),
          ),
        );
      if (!carrier) throw badRequest("Transportadora não encontrada");
      if (!carrier.types.includes("carrier")) {
        throw badRequest("O parceiro selecionado não é uma transportadora");
      }
      if (body.validFrom && body.validTo && body.validTo < body.validFrom) {
        throw badRequest("A data de fim de vigência é anterior ao início");
      }

      const [rate] = await app.db
        .insert(carrierRates)
        .values({
          tenantId: req.user.tid,
          carrierId: body.carrierId,
          name: body.name,
          basis: body.basis,
          price: body.price,
          currency: body.currency,
          minCharge: body.minCharge ?? null,
          validFrom: body.validFrom ?? null,
          validTo: body.validTo ?? null,
          notes: body.notes ?? null,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "rates.created",
        entity: "carrier_rate",
        entityId: rate.id,
        metadata: { name: rate.name, carrierId: body.carrierId },
        ip: req.ip,
      });
      return reply.code(201).send({ rate: toDto(rate, carrier.name) });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("rates:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: rateUpdateSchema,
        response: { 200: z.object({ rate: rateDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select({ rate: carrierRates, carrierName: partners.name })
        .from(carrierRates)
        .innerJoin(partners, eq(carrierRates.carrierId, partners.id))
        .where(
          and(eq(carrierRates.id, req.params.id), eq(carrierRates.tenantId, req.user.tid)),
        );
      if (!target) throw notFound("Tarifa não encontrada");
      const validFrom = req.body.validFrom ?? target.rate.validFrom;
      const validTo = req.body.validTo ?? target.rate.validTo;
      if (validFrom && validTo && validTo < validFrom) {
        throw badRequest("A data de fim de vigência é anterior ao início");
      }
      const [updated] = await app.db
        .update(carrierRates)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(carrierRates.id, target.rate.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "rates.updated",
        entity: "carrier_rate",
        entityId: target.rate.id,
        metadata: req.body,
        ip: req.ip,
      });
      return { rate: toDto(updated, target.carrierName) };
    },
  );

  // Ativar/desativar tarifa (soft delete)
  app.delete(
    "/:id",
    {
      preHandler: app.requirePermission("rates:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ rate: rateDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select({ rate: carrierRates, carrierName: partners.name })
        .from(carrierRates)
        .innerJoin(partners, eq(carrierRates.carrierId, partners.id))
        .where(
          and(eq(carrierRates.id, req.params.id), eq(carrierRates.tenantId, req.user.tid)),
        );
      if (!target) throw notFound("Tarifa não encontrada");
      const [updated] = await app.db
        .update(carrierRates)
        .set({ active: !target.rate.active, updatedAt: new Date() })
        .where(eq(carrierRates.id, target.rate.id))
        .returning();
      return { rate: toDto(updated, target.carrierName) };
    },
  );
};
