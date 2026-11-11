import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  driverLocationSchema,
  driverRouteDetailDtoSchema,
  driverRouteDtoSchema,
  driverStopDtoSchema,
  driverStopStatusSchema,
  podCreateSchema,
  proofOfDeliveryDtoSchema,
  type DriverStopDto,
} from "@transitum/shared";
import { z } from "zod";
import {
  documents,
  proofsOfDelivery,
  routePositions,
  routes,
  routeStops,
  shipments,
  partners,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { transitionStop } from "../lib/stop-flow.js";
import type { Actor } from "../lib/shipment-flow.js";
import type { FastifyInstance } from "fastify";

const actor = (req: { user: { tid: string; sub: string; name: string }; ip: string }): Actor => ({
  tenantId: req.user.tid,
  userId: req.user.sub,
  name: req.user.name,
  ip: req.ip,
});

/** Rota atribuída ao motorista autenticado. */
async function myRoute(app: FastifyInstance, tid: string, userId: string, routeId: string) {
  const [route] = await app.db
    .select()
    .from(routes)
    .where(
      and(
        eq(routes.id, routeId),
        eq(routes.tenantId, tid),
        eq(routes.driverUserId, userId),
      ),
    );
  if (!route) throw notFound("Rota não encontrada ou não atribuída");
  return route;
}

async function stopDtos(app: FastifyInstance, routeId: string): Promise<DriverStopDto[]> {
  const [stops, proofs] = await Promise.all([
    app.db
      .select({ stop: routeStops, shipment: shipments, customerName: partners.name })
      .from(routeStops)
      .leftJoin(shipments, eq(routeStops.shipmentId, shipments.id))
      .leftJoin(partners, eq(shipments.customerId, partners.id))
      .where(eq(routeStops.routeId, routeId))
      .orderBy(asc(routeStops.seq)),
    app.db
      .select({ stopId: proofsOfDelivery.stopId })
      .from(proofsOfDelivery)
      .innerJoin(routeStops, eq(proofsOfDelivery.stopId, routeStops.id))
      .where(eq(routeStops.routeId, routeId)),
  ]);
  const withProof = new Set(proofs.map((p) => p.stopId));
  return stops.map(({ stop, shipment, customerName }) => ({
    id: stop.id,
    seq: stop.seq,
    type: stop.type,
    status: stop.status,
    address: {
      line1: stop.addressLine1,
      city: stop.city,
      postalCode: stop.postalCode,
      country: stop.country,
    },
    coords: stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : null,
    plannedAt: stop.plannedAt?.toISOString() ?? null,
    note: stop.note ?? null,
    shipment: shipment
      ? {
          id: shipment.id,
          number: shipment.number,
          customerName: customerName ?? "",
          recipientName: shipment.recipientName ?? null,
          recipientPhone: shipment.recipientPhone ?? null,
          packages: shipment.packages ?? null,
          totalWeightKg: shipment.totalWeightKg ?? null,
          status: shipment.status,
        }
      : null,
    hasProof: withProof.has(stop.id),
  }));
}

const routeDto = (r: typeof routes.$inferSelect, counts: { stopCount: number; doneStops: number }) => ({
  id: r.id,
  number: r.number,
  name: r.name,
  status: r.status,
  vehicleRef: r.vehicleRef ?? null,
  plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
  ...counts,
});

/**
 * App do motorista — acesso exclusivo da função "driver" às rotas que lhe
 * estão atribuídas: paragens, transições, prova de entrega e posição GPS.
 */
export const driverRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/routes",
    {
      preHandler: app.requirePermission("driver:app"),
      schema: {
        querystring: z.object({ all: z.coerce.boolean().default(false) }),
        response: { 200: z.object({ routes: z.array(driverRouteDtoSchema) }) },
      },
    },
    async (req) => {
      const conditions = [
        eq(routes.tenantId, req.user.tid),
        eq(routes.driverUserId, req.user.sub),
      ];
      if (!req.query.all) {
        conditions.push(inArray(routes.status, ["draft", "dispatched"]));
      }
      const rows = await app.db
        .select()
        .from(routes)
        .where(and(...conditions))
        .orderBy(desc(routes.plannedStartAt), desc(routes.createdAt));
      const result = [];
      for (const r of rows) {
        const stops = await stopDtos(app, r.id);
        result.push(
          routeDto(r, {
            stopCount: stops.length,
            doneStops: stops.filter((s) => s.status === "done").length,
          }),
        );
      }
      return { routes: result };
    },
  );

  app.get(
    "/routes/:id",
    {
      preHandler: app.requirePermission("driver:app"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ route: driverRouteDetailDtoSchema }) },
      },
    },
    async (req) => {
      const route = await myRoute(app, req.user.tid, req.user.sub, req.params.id);
      const stops = await stopDtos(app, route.id);
      return {
        route: {
          ...routeDto(route, {
            stopCount: stops.length,
            doneStops: stops.filter((s) => s.status === "done").length,
          }),
          stops,
        },
      };
    },
  );

  // Transição de paragem (chegada/concluída/saltada) com localização opcional
  app.post(
    "/routes/:id/stops/:stopId/status",
    {
      preHandler: app.requirePermission("driver:app"),
      schema: {
        params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }),
        body: driverStopStatusSchema,
        response: { 200: z.object({ stop: driverStopDtoSchema }) },
      },
    },
    async (req) => {
      const route = await myRoute(app, req.user.tid, req.user.sub, req.params.id);
      const [row] = await app.db
        .select({ stop: routeStops, route: routes })
        .from(routeStops)
        .innerJoin(routes, eq(routeStops.routeId, routes.id))
        .where(and(eq(routeStops.id, req.params.stopId), eq(routeStops.routeId, route.id)));
      if (!row) throw notFound("Paragem não encontrada");
      if (req.body.lat != null && req.body.lng != null) {
        await app.db.insert(routePositions).values({
          tenantId: req.user.tid,
          routeId: route.id,
          userId: req.user.sub,
          lat: req.body.lat,
          lng: req.body.lng,
        });
      }
      await transitionStop(app, actor(req), row, req.body.status, { note: req.body.note, source: "app do motorista" });
      const [stop] = (await stopDtos(app, route.id)).filter((s) => s.id === row.stop.id);
      return { stop };
    },
  );

  // Prova de entrega/recolha: assinatura (obrigatória) + foto (opcional) + GPS + nota
  app.post(
    "/routes/:id/stops/:stopId/proof",
    {
      preHandler: app.requirePermission("driver:app"),
      schema: {
        params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }),
        body: podCreateSchema,
        response: { 201: z.object({ proof: proofOfDeliveryDtoSchema }) },
      },
    },
    async (req, reply) => {
      const route = await myRoute(app, req.user.tid, req.user.sub, req.params.id);
      const [row] = await app.db
        .select({ stop: routeStops, route: routes })
        .from(routeStops)
        .innerJoin(routes, eq(routeStops.routeId, routes.id))
        .where(and(eq(routeStops.id, req.params.stopId), eq(routeStops.routeId, route.id)));
      if (!row) throw notFound("Paragem não encontrada");
      if (row.stop.status === "done") throw badRequest("Esta paragem já está concluída");
      const [existing] = await app.db
        .select({ id: proofsOfDelivery.id })
        .from(proofsOfDelivery)
        .where(eq(proofsOfDelivery.stopId, row.stop.id));
      if (existing) throw badRequest("Já existe uma prova registada para esta paragem");

      const storeImage = async (b64: string, kind: "assinatura" | "foto", mime: string, ext: string) => {
        const data = Buffer.from(b64, "base64");
        const storageKey = `${req.user.tid}/pod/${row.stop.id}-${kind}.${ext}`;
        await app.storage.put(storageKey, data);
        const [doc] = await app.db
          .insert(documents)
          .values({
            tenantId: req.user.tid,
            entityType: row.stop.shipmentId ? "shipment" : "route",
            entityId: row.stop.shipmentId ?? row.stop.id,
            fileName: `${kind}-${row.stop.id}.${ext}`,
            mimeType: mime,
            sizeBytes: data.length,
            storageKey,
            uploadedBy: req.user.sub,
          })
          .returning();
        return doc.id;
      };

      const signatureDocId = await storeImage(req.body.signaturePngBase64, "assinatura", "image/png", "png");
      const photoDocId = req.body.photoJpegBase64
        ? await storeImage(req.body.photoJpegBase64, "foto", "image/jpeg", "jpg")
        : null;

      const [proof] = await app.db
        .insert(proofsOfDelivery)
        .values({
          tenantId: req.user.tid,
          stopId: row.stop.id,
          shipmentId: row.stop.shipmentId ?? null,
          recipientName: req.body.recipientName,
          signatureDocId,
          photoDocId,
          lat: req.body.lat ?? null,
          lng: req.body.lng ?? null,
          note: req.body.note ?? null,
          capturedBy: req.user.sub,
        })
        .returning();
      if (req.body.lat != null && req.body.lng != null) {
        await app.db.insert(routePositions).values({
          tenantId: req.user.tid,
          routeId: route.id,
          userId: req.user.sub,
          lat: req.body.lat,
          lng: req.body.lng,
        });
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "pod.captured",
        entity: "route_stop",
        entityId: row.stop.id,
        metadata: { routeId: route.id, shipmentId: row.stop.shipmentId },
        ip: req.ip,
      });
      // A prova conclui a paragem (e entrega a expedição, se for o caso)
      await transitionStop(app, actor(req), row, "done", { source: "app do motorista" });
      return reply.code(201).send({
        proof: {
          id: proof.id,
          stopId: proof.stopId,
          stopType: row.stop.type,
          recipientName: proof.recipientName,
          signatureDocId: proof.signatureDocId ?? null,
          photoDocId: proof.photoDocId ?? null,
          coords: proof.lat != null && proof.lng != null ? { lat: proof.lat, lng: proof.lng } : null,
          note: proof.note ?? null,
          capturedByName: req.user.name,
          capturedAt: proof.capturedAt.toISOString(),
        },
      });
    },
  );

  // Posição GPS periódica (tracking ao vivo da rota)
  app.post(
    "/location",
    {
      preHandler: app.requirePermission("driver:app"),
      schema: {
        body: driverLocationSchema,
        response: { 201: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      await myRoute(app, req.user.tid, req.user.sub, req.body.routeId);
      await app.db.insert(routePositions).values({
        tenantId: req.user.tid,
        routeId: req.body.routeId,
        userId: req.user.sub,
        lat: req.body.lat,
        lng: req.body.lng,
        accuracyM: req.body.accuracyM ?? null,
      });
      return reply.code(201).send({ ok: true as const });
    },
  );
};
