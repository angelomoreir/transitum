import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listRoutesQuerySchema,
  routeCreateSchema,
  routeDetailDtoSchema,
  routeDtoSchema,
  routeStatusUpdateSchema,
  routeStopDtoSchema,
  routeStopInputSchema,
  routeUpdateSchema,
  ROUTE_TRANSITIONS,
  stopStatusUpdateSchema,
  STOP_TRANSITIONS,
  type RouteStatus,
  type StopStatus,
} from "@blujay/shared";
import { z } from "zod";
import {
  partners,
  routes,
  routeStops,
  shipmentEvents,
  shipments,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notifyTenant } from "../lib/notify.js";
import { nextNumber } from "../lib/sequences.js";

const listResponse = z.object({
  items: z.array(routeDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type RouteRow = typeof routes.$inferSelect;
type StopRow = typeof routeStops.$inferSelect;

const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  draft: "Rascunho",
  dispatched: "Despachada",
  completed: "Concluída",
  cancelled: "Cancelada",
};

const STOP_TYPE_LABELS: Record<string, string> = {
  pickup: "Recolha",
  delivery: "Entrega",
};

function toDto(
  r: RouteRow,
  carrierName: string | null,
  counts: { stopCount: number; doneStops: number } = { stopCount: 0, doneStops: 0 },
) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    number: r.number,
    name: r.name,
    status: r.status,
    carrierId: r.carrierId ?? null,
    carrierName,
    driverName: r.driverName ?? null,
    vehicleRef: r.vehicleRef ?? null,
    plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
    plannedEndAt: r.plannedEndAt?.toISOString() ?? null,
    notes: r.notes ?? null,
    stopCount: counts.stopCount,
    doneStops: counts.doneStops,
    createdAt: r.createdAt.toISOString(),
  };
}

function stopToDto(s: StopRow, shipmentNumber: string | null) {
  return {
    id: s.id,
    seq: s.seq,
    type: s.type,
    status: s.status,
    shipmentId: s.shipmentId ?? null,
    shipmentNumber,
    address: {
      line1: s.addressLine1,
      city: s.city,
      postalCode: s.postalCode,
      country: s.country,
    },
    plannedAt: s.plannedAt?.toISOString() ?? null,
    arrivedAt: s.arrivedAt?.toISOString() ?? null,
    doneAt: s.doneAt?.toISOString() ?? null,
    note: s.note ?? null,
  };
}

export const routeRoutes: FastifyPluginAsyncZod = async (app) => {
  const stopCounts = app.db
    .select({
      routeId: routeStops.routeId,
      stopCount: sql<number>`count(*)::int`.as("stop_count"),
      doneStops: sql<number>`count(*) filter (where ${routeStops.status} = 'done')::int`.as("done_stops"),
    })
    .from(routeStops)
    .groupBy(routeStops.routeId)
    .as("stop_counts");

  const baseQuery = () =>
    app.db
      .select({
        route: routes,
        carrierName: partners.name,
        stopCount: sql<number>`coalesce(${stopCounts.stopCount}, 0)`,
        doneStops: sql<number>`coalesce(${stopCounts.doneStops}, 0)`,
      })
      .from(routes)
      .leftJoin(partners, eq(routes.carrierId, partners.id))
      .leftJoin(stopCounts, eq(routes.id, stopCounts.routeId));

  app.get(
    "/",
    {
      preHandler: app.requirePermission("routes:read"),
      schema: { querystring: listRoutesQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, q, status, carrierId } = req.query;
      const conditions = [eq(routes.tenantId, req.user.tid)];
      if (status) conditions.push(eq(routes.status, status));
      if (carrierId) conditions.push(eq(routes.carrierId, carrierId));
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            ilike(routes.number, pattern),
            ilike(routes.name, pattern),
            ilike(routes.driverName, pattern),
          )!,
        );
      }
      const where = and(...conditions);

      const [items, [{ count }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(routes.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(routes)
          .where(where),
      ]);
      return {
        items: items.map((r) =>
          toDto(r.route, r.carrierName, {
            stopCount: r.stopCount,
            doneStops: r.doneStops,
          }),
        ),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("routes:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ route: routeDetailDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await baseQuery().where(
        and(eq(routes.id, req.params.id), eq(routes.tenantId, req.user.tid)),
      );
      if (!row) throw notFound("Rota não encontrada");

      const stops = await app.db
        .select({ stop: routeStops, shipmentNumber: shipments.number })
        .from(routeStops)
        .leftJoin(shipments, eq(routeStops.shipmentId, shipments.id))
        .where(eq(routeStops.routeId, row.route.id))
        .orderBy(asc(routeStops.seq));

      return {
        route: {
          ...toDto(row.route, row.carrierName, {
            stopCount: row.stopCount,
            doneStops: row.doneStops,
          }),
          stops: stops.map((s) => stopToDto(s.stop, s.shipmentNumber)),
        },
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("routes:write"),
      schema: {
        body: routeCreateSchema,
        response: { 201: z.object({ route: routeDetailDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      let carrierName: string | null = null;
      if (body.carrierId) {
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
        carrierName = carrier.name;
      }

      // Expedições referenciadas nas paragens têm de pertencer ao tenant
      const shipmentIds = [
        ...new Set(body.stops.map((s) => s.shipmentId).filter((v): v is string => !!v)),
      ];
      let shipmentNumbers = new Map<string, string>();
      if (shipmentIds.length > 0) {
        const found = await app.db
          .select({ id: shipments.id, number: shipments.number })
          .from(shipments)
          .where(
            and(eq(shipments.tenantId, req.user.tid), inArray(shipments.id, shipmentIds)),
          );
        if (found.length !== shipmentIds.length) {
          throw badRequest("Uma ou mais expedições não foram encontradas");
        }
        shipmentNumbers = new Map(found.map((s) => [s.id, s.number]));
      }

      const number = await nextNumber(app.db, req.user.tid, "route");
      const [route] = await app.db
        .insert(routes)
        .values({
          tenantId: req.user.tid,
          number,
          name: body.name,
          carrierId: body.carrierId ?? null,
          driverName: body.driverName ?? null,
          vehicleRef: body.vehicleRef ?? null,
          plannedStartAt: body.plannedStartAt ? new Date(body.plannedStartAt) : null,
          plannedEndAt: body.plannedEndAt ? new Date(body.plannedEndAt) : null,
          notes: body.notes ?? null,
          createdBy: req.user.sub,
        })
        .returning();

      const insertedStops =
        body.stops.length > 0
          ? await app.db
              .insert(routeStops)
              .values(
                body.stops.map((s, i) => ({
                  tenantId: req.user.tid,
                  routeId: route.id,
                  shipmentId: s.shipmentId ?? null,
                  seq: i + 1,
                  type: s.type,
                  addressLine1: s.address.line1,
                  city: s.address.city,
                  postalCode: s.address.postalCode,
                  country: s.address.country,
                  plannedAt: s.plannedAt ? new Date(s.plannedAt) : null,
                  note: s.note ?? null,
                })),
              )
              .returning()
          : [];

      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "routes.created",
        entity: "route",
        entityId: route.id,
        metadata: { number, stops: insertedStops.length },
        ip: req.ip,
      });

      return reply.code(201).send({
        route: {
          ...toDto(route, carrierName, {
            stopCount: insertedStops.length,
            doneStops: 0,
          }),
          stops: insertedStops.map((s) =>
            stopToDto(s, s.shipmentId ? (shipmentNumbers.get(s.shipmentId) ?? null) : null),
          ),
        },
      });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("routes:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: routeUpdateSchema,
        response: { 200: z.object({ route: routeDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(routes)
        .where(and(eq(routes.id, req.params.id), eq(routes.tenantId, req.user.tid)));
      if (!target) throw notFound("Rota não encontrada");
      if (["completed", "cancelled"].includes(target.status)) {
        throw badRequest("Não é possível editar uma rota concluída ou cancelada");
      }
      if (req.body.carrierId) {
        const [carrier] = await app.db
          .select()
          .from(partners)
          .where(
            and(
              eq(partners.id, req.body.carrierId),
              eq(partners.tenantId, req.user.tid),
              eq(partners.active, true),
            ),
          );
        if (!carrier || !carrier.types.includes("carrier")) {
          throw badRequest("Transportadora inválida");
        }
      }
      const [updated] = await app.db
        .update(routes)
        .set({
          name: req.body.name,
          carrierId:
            req.body.carrierId === null ? null : (req.body.carrierId ?? undefined),
          driverName:
            req.body.driverName === null ? null : (req.body.driverName ?? undefined),
          vehicleRef:
            req.body.vehicleRef === null ? null : (req.body.vehicleRef ?? undefined),
          plannedStartAt:
            req.body.plannedStartAt === null
              ? null
              : req.body.plannedStartAt
                ? new Date(req.body.plannedStartAt)
                : undefined,
          plannedEndAt:
            req.body.plannedEndAt === null
              ? null
              : req.body.plannedEndAt
                ? new Date(req.body.plannedEndAt)
                : undefined,
          notes: req.body.notes === null ? null : (req.body.notes ?? undefined),
          updatedAt: new Date(),
        })
        .where(eq(routes.id, target.id))
        .returning();
      const [carrier] = updated.carrierId
        ? await app.db
            .select({ name: partners.name })
            .from(partners)
            .where(eq(partners.id, updated.carrierId))
        : [null];
      return {
        route: toDto(updated, carrier?.name ?? null),
      };
    },
  );

  app.post(
    "/:id/status",
    {
      preHandler: app.requirePermission("routes:status"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: routeStatusUpdateSchema,
        response: { 200: z.object({ route: routeDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(routes)
        .where(and(eq(routes.id, req.params.id), eq(routes.tenantId, req.user.tid)));
      if (!target) throw notFound("Rota não encontrada");

      const next = req.body.status;
      const allowed = ROUTE_TRANSITIONS[target.status as RouteStatus] ?? [];
      if (!allowed.includes(next)) {
        throw badRequest(
          `Transição inválida: ${ROUTE_STATUS_LABELS[target.status as RouteStatus]} → ${ROUTE_STATUS_LABELS[next]}`,
        );
      }
      const [updated] = await app.db
        .update(routes)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(routes.id, target.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "routes.status_changed",
        entity: "route",
        entityId: target.id,
        metadata: { from: target.status, to: next },
        ip: req.ip,
      });
      if (next === "completed") {
        await notifyTenant(app.db, {
          tenantId: req.user.tid,
          trigger: "route.completed",
          title: `Rota ${target.number} concluída`,
          link: `/routes/${target.id}`,
        });
      }
      return { route: toDto(updated, null) };
    },
  );

  // Adicionar paragem a rota existente (não concluída/cancelada)
  app.post(
    "/:id/stops",
    {
      preHandler: app.requirePermission("routes:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: routeStopInputSchema,
        response: { 201: z.object({ stop: routeStopDtoSchema }) },
      },
    },
    async (req, reply) => {
      const [route] = await app.db
        .select()
        .from(routes)
        .where(and(eq(routes.id, req.params.id), eq(routes.tenantId, req.user.tid)));
      if (!route) throw notFound("Rota não encontrada");
      if (["completed", "cancelled"].includes(route.status)) {
        throw badRequest("Não é possível alterar paragens de uma rota fechada");
      }

      let shipmentNumber: string | null = null;
      if (req.body.shipmentId) {
        const [shipment] = await app.db
          .select({ id: shipments.id, number: shipments.number })
          .from(shipments)
          .where(
            and(
              eq(shipments.id, req.body.shipmentId),
              eq(shipments.tenantId, req.user.tid),
            ),
          );
        if (!shipment) throw badRequest("Expedição não encontrada");
        shipmentNumber = shipment.number;
      }

      const [{ max }] = await app.db
        .select({ max: sql<number>`coalesce(max(${routeStops.seq}), 0)` })
        .from(routeStops)
        .where(eq(routeStops.routeId, route.id));

      const [stop] = await app.db
        .insert(routeStops)
        .values({
          tenantId: req.user.tid,
          routeId: route.id,
          shipmentId: req.body.shipmentId ?? null,
          seq: max + 1,
          type: req.body.type,
          addressLine1: req.body.address.line1,
          city: req.body.address.city,
          postalCode: req.body.address.postalCode,
          country: req.body.address.country,
          plannedAt: req.body.plannedAt ? new Date(req.body.plannedAt) : null,
          note: req.body.note ?? null,
        })
        .returning();
      return reply.code(201).send({ stop: stopToDto(stop, shipmentNumber) });
    },
  );

  // Transição de estado de uma paragem — concluir gera checkpoint na expedição
  app.post(
    "/:id/stops/:stopId/status",
    {
      preHandler: app.requirePermission("routes:status"),
      schema: {
        params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }),
        body: stopStatusUpdateSchema,
        response: { 200: z.object({ stop: routeStopDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select({ stop: routeStops, route: routes })
        .from(routeStops)
        .innerJoin(routes, eq(routeStops.routeId, routes.id))
        .where(
          and(
            eq(routeStops.id, req.params.stopId),
            eq(routeStops.routeId, req.params.id),
            eq(routeStops.tenantId, req.user.tid),
          ),
        );
      if (!row) throw notFound("Paragem não encontrada");

      const next = req.body.status;
      const allowed = STOP_TRANSITIONS[row.stop.status as StopStatus] ?? [];
      if (!allowed.includes(next)) {
        throw badRequest(`Transição inválida: ${row.stop.status} → ${next}`);
      }
      const now = new Date();
      const [updated] = await app.db
        .update(routeStops)
        .set({
          status: next,
          arrivedAt: next === "arrived" ? now : row.stop.arrivedAt,
          doneAt: next === "done" ? now : undefined,
          note: req.body.note ?? row.stop.note,
        })
        .where(eq(routeStops.id, row.stop.id))
        .returning();

      // Acompanhamento: concluir paragem regista checkpoint na expedição ligada
      if (next === "done" && row.stop.shipmentId) {
        await app.db.insert(shipmentEvents).values({
          tenantId: req.user.tid,
          shipmentId: row.stop.shipmentId,
          type: "checkpoint",
          description: `${STOP_TYPE_LABELS[row.stop.type]} em ${row.stop.city} concluída (rota ${row.route.number})`,
          location: `${row.stop.city}, ${row.stop.country}`,
          createdBy: req.user.sub,
        });
      }

      let shipmentNumber: string | null = null;
      if (updated.shipmentId) {
        const [s] = await app.db
          .select({ number: shipments.number })
          .from(shipments)
          .where(eq(shipments.id, updated.shipmentId));
        shipmentNumber = s?.number ?? null;
      }
      return { stop: stopToDto(updated, shipmentNumber) };
    },
  );

  // Remover paragem (apenas rota em rascunho)
  app.delete(
    "/:id/stops/:stopId",
    {
      preHandler: app.requirePermission("routes:write"),
      schema: {
        params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const [route] = await app.db
        .select()
        .from(routes)
        .where(and(eq(routes.id, req.params.id), eq(routes.tenantId, req.user.tid)));
      if (!route) throw notFound("Rota não encontrada");
      if (route.status !== "draft") {
        throw badRequest("Só é possível remover paragens de rotas em rascunho");
      }
      const [stop] = await app.db
        .select()
        .from(routeStops)
        .where(
          and(
            eq(routeStops.id, req.params.stopId),
            eq(routeStops.routeId, route.id),
          ),
        );
      if (!stop) throw notFound("Paragem não encontrada");
      await app.db.delete(routeStops).where(eq(routeStops.id, stop.id));
      // Renumerar para manter sequência contígua
      await app.db.execute(sql`
        update route_stops s set seq = n.new_seq
        from (
          select id, row_number() over (order by seq) as new_seq
          from route_stops where route_id = ${route.id}
        ) n
        where s.id = n.id
      `);
      return { ok: true as const };
    },
  );
};
