import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listVehiclesQuerySchema,
  vehicleCreateSchema,
  vehicleDtoSchema,
  vehicleUpdateSchema,
} from "@transitum/shared";
import { z } from "zod";
import { vehicles } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { conflict, notFound } from "../lib/errors.js";

const listResponse = z.object({
  items: z.array(vehicleDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type Row = typeof vehicles.$inferSelect;

function toDto(v: Row) {
  return {
    id: v.id,
    tenantId: v.tenantId,
    plate: v.plate,
    name: v.name,
    type: v.type,
    capacityKg: v.capacityKg ?? null,
    active: v.active,
    createdAt: v.createdAt.toISOString(),
  };
}

export const vehicleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: app.requirePermission("routes:read"),
      schema: { querystring: listVehiclesQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, q, active } = req.query;
      const conditions = [eq(vehicles.tenantId, req.user.tid)];
      if (active) conditions.push(eq(vehicles.active, active === "true"));
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(ilike(vehicles.plate, pattern), ilike(vehicles.name, pattern))!,
        );
      }
      const where = and(...conditions);
      const [items, [{ count }]] = await Promise.all([
        app.db
          .select()
          .from(vehicles)
          .where(where)
          .orderBy(desc(vehicles.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(vehicles)
          .where(where),
      ]);
      return { items: items.map(toDto), total: count, page, pageSize };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("routes:write"),
      schema: {
        body: vehicleCreateSchema,
        response: { 201: z.object({ vehicle: vehicleDtoSchema }) },
      },
    },
    async (req, reply) => {
      const [dup] = await app.db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(eq(vehicles.tenantId, req.user.tid), eq(vehicles.plate, req.body.plate)),
        );
      if (dup) throw conflict("Já existe uma viatura com esta matrícula");

      const [vehicle] = await app.db
        .insert(vehicles)
        .values({
          tenantId: req.user.tid,
          plate: req.body.plate,
          name: req.body.name,
          type: req.body.type,
          capacityKg: req.body.capacityKg ?? null,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "vehicles.created",
        entity: "vehicle",
        entityId: vehicle.id,
        metadata: { plate: vehicle.plate },
        ip: req.ip,
      });
      return reply.code(201).send({ vehicle: toDto(vehicle) });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("routes:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: vehicleUpdateSchema,
        response: { 200: z.object({ vehicle: vehicleDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, req.params.id), eq(vehicles.tenantId, req.user.tid)));
      if (!target) throw notFound("Viatura não encontrada");

      if (req.body.plate && req.body.plate !== target.plate) {
        const [dup] = await app.db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.tenantId, req.user.tid),
              eq(vehicles.plate, req.body.plate),
            ),
          );
        if (dup) throw conflict("Já existe uma viatura com esta matrícula");
      }

      const [updated] = await app.db
        .update(vehicles)
        .set({
          plate: req.body.plate ?? undefined,
          name: req.body.name ?? undefined,
          type: req.body.type ?? undefined,
          capacityKg:
            req.body.capacityKg === undefined ? undefined : (req.body.capacityKg ?? null),
          active: req.body.active ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, target.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "vehicles.updated",
        entity: "vehicle",
        entityId: target.id,
        metadata: { fields: Object.keys(req.body) },
        ip: req.ip,
      });
      return { vehicle: toDto(updated) };
    },
  );
};
