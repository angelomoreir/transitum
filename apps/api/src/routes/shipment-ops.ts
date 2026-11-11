import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  applyRateSchema,
  rateQuoteDtoSchema,
  shipmentCostDtoSchema,
  shipmentDtoSchema,
  transportDocumentCreateSchema,
  transportDocumentDtoSchema,
} from "@transitum/shared";
import { z } from "zod";
import {
  carrierConnections,
  partners,
  shipmentEvents,
  shipments,
  tenants,
  transportDocuments,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { costToDto, shipmentToDto, transportDocToDto } from "../lib/dto.js";
import { createCarrierAdapter } from "../lib/carriers.js";
import { decryptJson } from "../lib/secrets.js";
import { applyRateCost, quoteShipment } from "../lib/rating.js";
import { cmrPdf, labelsPdf, transportDocPdf } from "../lib/pdf.js";
import { changeShipmentStatus, notifyRecipient, type Actor } from "../lib/shipment-flow.js";
import {
  issueTransportDocument,
  loadShippingDocData,
  transportDocInfo,
} from "../lib/transport-docs.js";

type ShipmentRow = typeof shipments.$inferSelect;

const idParam = z.object({ id: z.string().uuid() });

async function loadShipment(app: Parameters<FastifyPluginAsyncZod>[0], tid: string, id: string) {
  const [s] = await app.db
    .select()
    .from(shipments)
    .where(and(eq(shipments.id, id), eq(shipments.tenantId, tid)));
  if (!s) throw notFound("Expedição não encontrada");
  return s;
}

/** Adaptador da ligação configurada para a transportadora da expedição. */
async function carrierAdapter(app: Parameters<FastifyPluginAsyncZod>[0], s: ShipmentRow) {
  if (!s.carrierId) throw badRequest("A expedição não tem transportadora");
  const [conn] = await app.db
    .select()
    .from(carrierConnections)
    .where(
      and(
        eq(carrierConnections.tenantId, s.tenantId),
        eq(carrierConnections.carrierId, s.carrierId),
        eq(carrierConnections.active, true),
      ),
    );
  if (!conn) {
    throw badRequest("A transportadora não tem ligação configurada (Definições → Transportadoras)");
  }
  const adapter = createCarrierAdapter({
    provider: conn.provider,
    mode: conn.mode,
    credentials: decryptJson(conn.credentialsEnc),
    config: (conn.config as Record<string, string>) ?? {},
  });
  return { conn, adapter };
}

const pdfHeaders = (reply: { header: (k: string, v: string) => unknown }, name: string) => {
  reply.header("content-type", "application/pdf");
  reply.header("content-disposition", `inline; filename="${name}"`);
};

/** Endpoints operacionais da expedição: cotações, documentos, transportadora. */
export const shipmentOpsRoutes: FastifyPluginAsyncZod = async (app) => {
  const actor = (req: { user: { tid: string; sub: string; name: string }; ip: string }): Actor => ({
    tenantId: req.user.tid,
    userId: req.user.sub,
    name: req.user.name,
    ip: req.ip,
  });

  // ── Cotação automática de frete ─────────────────────────────────────────

  app.get(
    "/:id/quotes",
    {
      preHandler: app.requirePermission("costs:read"),
      schema: {
        params: idParam,
        response: { 200: z.object({ quotes: z.array(rateQuoteDtoSchema) }) },
      },
    },
    async (req) => {
      const s = await loadShipment(app, req.user.tid, req.params.id);
      return { quotes: await quoteShipment(app.db, s) };
    },
  );

  app.post(
    "/:id/apply-rate",
    {
      preHandler: app.requirePermission("costs:write"),
      schema: {
        params: idParam,
        body: applyRateSchema,
        response: {
          200: z.object({
            cost: shipmentCostDtoSchema.nullable(),
            quote: rateQuoteDtoSchema.nullable(),
          }),
        },
      },
    },
    async (req) => {
      const s = await loadShipment(app, req.user.tid, req.params.id);
      const { cost, quote } = await applyRateCost(app.db, s, {
        rateId: req.body.rateId,
        actorId: req.user.sub,
      });
      if (!cost) {
        throw badRequest(
          quote?.missing === "weight"
            ? "A tarifa exige o peso total da expedição"
            : quote?.missing === "distance"
              ? "A tarifa exige a distância (km) da expedição"
              : quote?.missing === "packages"
                ? "A tarifa exige o número de volumes"
                : "Nenhuma tarifa aplicável — verifique transportadora, validade e dados da expedição",
        );
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "costs.rate_applied",
        entity: "shipment",
        entityId: s.id,
        metadata: { rateId: quote!.rateId, amount: cost.amount },
        ip: req.ip,
      });
      return { cost: costToDto(cost), quote };
    },
  );

  // ── Documentos de transporte (GT/GR + AT) ────────────────────────────────

  app.post(
    "/:id/transport-documents",
    {
      preHandler: app.requirePermission("shipments:write"),
      schema: {
        params: idParam,
        body: transportDocumentCreateSchema,
        response: { 201: z.object({ document: transportDocumentDtoSchema }) },
      },
    },
    async (req, reply) => {
      const s = await loadShipment(app, req.user.tid, req.params.id);
      if (s.status === "cancelled") throw badRequest("Expedição cancelada");
      const doc = await issueTransportDocument(app, actor(req), s, {
        docType: req.body.docType,
        movementStartAt: req.body.movementStartAt ? new Date(req.body.movementStartAt) : undefined,
        vehicleRef: req.body.vehicleRef,
      });
      return reply.code(201).send({ document: transportDocToDto(doc) });
    },
  );

  app.get(
    "/:id/documents/:kind.pdf",
    {
      preHandler: app.requirePermission("shipments:read"),
      schema: { params: z.object({ id: z.string().uuid(), kind: z.enum(["guide", "cmr", "labels"]) }) },
    },
    async (req, reply) => {
      const s = await loadShipment(app, req.user.tid, req.params.id);
      const data = await loadShippingDocData(app, s);
      if (req.params.kind === "cmr") {
        pdfHeaders(reply, `cmr-${s.number}.pdf`);
        return reply.send(await cmrPdf(data));
      }
      if (req.params.kind === "labels") {
        pdfHeaders(reply, `etiquetas-${s.number}.pdf`);
        return reply.send(await labelsPdf(data));
      }
      // Guia de transporte: usa o documento mais recente ou emite um novo
      let [doc] = await app.db
        .select()
        .from(transportDocuments)
        .where(and(eq(transportDocuments.shipmentId, s.id), eq(transportDocuments.tenantId, s.tenantId)))
        .orderBy(desc(transportDocuments.createdAt))
        .limit(1);
      doc ??= await issueTransportDocument(app, actor(req), s, {});
      pdfHeaders(reply, `guia-${doc.number.replace(/[ /]/g, "_")}.pdf`);
      return reply.send(await transportDocPdf(data, transportDocInfo(doc, data)));
    },
  );

  // ── Marcação e tracking na transportadora ───────────────────────────────

  app.post(
    "/:id/book",
    {
      preHandler: app.requirePermission("shipments:write"),
      schema: {
        params: idParam,
        response: { 200: z.object({ shipment: shipmentDtoSchema }) },
      },
    },
    async (req) => {
      const s = await loadShipment(app, req.user.tid, req.params.id);
      if (!["draft", "planned"].includes(s.status)) {
        throw badRequest("Só é possível marcar expedições em rascunho ou planeadas");
      }
      const { conn, adapter } = await carrierAdapter(app, s);
      const [customer, tenant] = await Promise.all([
        app.db.select().from(partners).where(eq(partners.id, s.customerId)).then((r) => r[0]),
        app.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, s.tenantId)).then((r) => r[0]),
      ]);
      const result = await adapter.book({
        shipmentNumber: s.number,
        reference: s.number,
        sender: {
          name: tenant?.name ?? "Transitum",
          line1: s.pickupLine1,
          city: s.pickupCity,
          postalCode: s.pickupPostalCode,
          country: s.pickupCountry,
        },
        recipient: {
          name: s.recipientName ?? customer?.name ?? "",
          line1: s.deliveryLine1,
          city: s.deliveryCity,
          postalCode: s.deliveryPostalCode,
          country: s.deliveryCountry,
          phone: s.recipientPhone,
          email: s.recipientEmail,
        },
        packages: s.packages ?? 1,
        weightKg: s.totalWeightKg ?? 0,
        notes: s.notes,
      });
      const [updated] = await app.db
        .update(shipments)
        .set({
          carrierProvider: conn.provider,
          trackingNumber: result.trackingNumber,
          carrierRef: result.carrierRef,
          carrierBookedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, s.id))
        .returning();
      await app.db.insert(shipmentEvents).values({
        tenantId: s.tenantId,
        shipmentId: s.id,
        type: "carrier",
        description: `Marcação na transportadora — nº de tracking ${result.trackingNumber}${conn.mode === "sandbox" ? " (sandbox)" : ""}`,
        createdBy: req.user.sub,
      });
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "shipments.carrier_booked",
        entity: "shipment",
        entityId: s.id,
        metadata: { provider: conn.provider, trackingNumber: result.trackingNumber },
        ip: req.ip,
      });
      return { shipment: shipmentToDto(updated) };
    },
  );

  app.post(
    "/:id/sync-tracking",
    {
      preHandler: app.requirePermission("shipments:write"),
      schema: {
        params: idParam,
        response: { 200: z.object({ shipment: shipmentDtoSchema, newEvents: z.number() }) },
      },
    },
    async (req) => {
      const s = await loadShipment(app, req.user.tid, req.params.id);
      if (!s.trackingNumber) throw badRequest("A expedição não tem marcação na transportadora");
      const { adapter } = await carrierAdapter(app, s);
      const events = await adapter.track({
        trackingNumber: s.trackingNumber,
        carrierRef: s.carrierRef ?? null,
        bookedAt: s.carrierBookedAt ?? s.createdAt,
      });

      const existing = await app.db
        .select({ description: shipmentEvents.description })
        .from(shipmentEvents)
        .where(and(eq(shipmentEvents.shipmentId, s.id), eq(shipmentEvents.type, "carrier")));
      const seen = new Set(existing.map((e) => e.description));
      let inserted = 0;
      for (const e of events) {
        const description = e.location ? `${e.description} — ${e.location}` : e.description;
        if (seen.has(description)) continue;
        await app.db.insert(shipmentEvents).values({
          tenantId: s.tenantId,
          shipmentId: s.id,
          type: "carrier",
          description,
          location: e.location ?? null,
          occurredAt: e.occurredAt,
          createdBy: req.user.sub,
        });
        inserted++;
      }
      await app.db
        .update(shipments)
        .set({ carrierSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(shipments.id, s.id));

      // O estado mais avançado reportado pode transitar a expedição
      const latest = events.at(-1);
      let current = s;
      const act = actor(req);
      if (latest?.status === "delivered" && s.status === "in_transit") {
        const r = await changeShipmentStatus(app, act, s, "delivered", {
          source: "transportadora",
          location: latest.location,
        });
        current = r.shipment;
      } else if (latest?.status === "out_for_delivery" && s.status === "in_transit") {
        await notifyRecipient(app, s, "out_for_delivery");
      }
      return { shipment: shipmentToDto(current), newEvents: inserted };
    },
  );
};
