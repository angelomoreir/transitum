import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { publicTrackingDtoSchema } from "@transitum/shared";
import { z } from "zod";
import {
  partners,
  proofsOfDelivery,
  routePositions,
  routeStops,
  shipmentEvents,
  shipments,
  tenants,
} from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { routeLeg } from "../lib/routing.js";

/** Velocidade média assumida para o ETA (km/h). */
const AVG_SPEED_KMH = 50;

/** Tipos de evento visíveis no tracking público (eventos internos ficam de fora). */
const PUBLIC_EVENT_TYPES = ["created", "status", "checkpoint", "carrier"];

/**
 * Tracking público — acesso apenas pelo token opaco da expedição
 * (`/track/<token>` no frontend). Não expõe moradas completas nem dados do tenant.
 */
export const trackingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/:token",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ token: z.string().min(20).max(64) }),
        response: { 200: z.object({ tracking: publicTrackingDtoSchema }) },
      },
    },
    async (req) => {
      const [s] = await app.db
        .select()
        .from(shipments)
        .where(eq(shipments.trackingToken, req.params.token));
      if (!s) throw notFound("Envio não encontrado");

      const [tenant, carrier, events, [pos], proofs] = await Promise.all([
        app.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, s.tenantId)),
        s.carrierId
          ? app.db.select({ name: partners.name }).from(partners).where(eq(partners.id, s.carrierId))
          : Promise.resolve([]),
        app.db
          .select({
            type: shipmentEvents.type,
            status: shipmentEvents.status,
            description: shipmentEvents.description,
            location: shipmentEvents.location,
            occurredAt: shipmentEvents.occurredAt,
          })
          .from(shipmentEvents)
          .where(and(eq(shipmentEvents.shipmentId, s.id), inArray(shipmentEvents.type, PUBLIC_EVENT_TYPES)))
          .orderBy(asc(shipmentEvents.occurredAt)),
        app.db
          .select({
            lat: routePositions.lat,
            lng: routePositions.lng,
            accuracyM: routePositions.accuracyM,
            recordedAt: routePositions.recordedAt,
          })
          .from(routePositions)
          .innerJoin(
            routeStops,
            and(eq(routeStops.routeId, routePositions.routeId), eq(routeStops.shipmentId, s.id)),
          )
          .orderBy(desc(routePositions.recordedAt))
          .limit(1),
        app.db
          .select()
          .from(proofsOfDelivery)
          .where(eq(proofsOfDelivery.shipmentId, s.id))
          .orderBy(desc(proofsOfDelivery.capturedAt))
          .limit(1),
      ]);

      // ETA: distância restante (posição atual → destino) a velocidade média.
      // Só faz sentido em trânsito; sem GPS ou sem coords do destino fica nulo.
      const destCoords =
        s.deliveryLat != null && s.deliveryLng != null
          ? { lat: s.deliveryLat, lng: s.deliveryLng }
          : null;
      let eta: string | null = null;
      if (s.status === "in_transit" && pos && destCoords) {
        const leg = await routeLeg(app.db, { lat: pos.lat, lng: pos.lng }, destCoords, app.log);
        // OSRM devolve duração real; a estimativa recua para km ÷ velocidade média
        const ms = leg.durationMin != null ? leg.durationMin * 60_000 : (leg.km / AVG_SPEED_KMH) * 3_600_000;
        eta = new Date(Date.now() + ms).toISOString();
      }

      return {
        tracking: {
          companyName: tenant[0]?.name ?? "",
          number: s.number,
          status: s.status,
          carrierName: carrier[0]?.name ?? null,
          trackingNumber: s.trackingNumber ?? null,
          origin: { city: s.pickupCity, country: s.pickupCountry },
          destination: { city: s.deliveryCity, country: s.deliveryCountry },
          destinationCoords:
            s.deliveryLat != null && s.deliveryLng != null
              ? { lat: s.deliveryLat, lng: s.deliveryLng }
              : null,
          plannedDeliveryAt: s.plannedDeliveryAt?.toISOString() ?? null,
          deliveredAt: s.deliveredAt?.toISOString() ?? null,
          estimatedArrivalAt: eta,
          lastPosition: pos
            ? {
                lat: pos.lat,
                lng: pos.lng,
                accuracyM: pos.accuracyM ?? null,
                recordedAt: pos.recordedAt.toISOString(),
              }
            : null,
          events: events.map((e) => ({
            type: e.type,
            status: e.status ?? null,
            description: e.description,
            location: e.location ?? null,
            occurredAt: e.occurredAt.toISOString(),
          })),
          proof: proofs[0]
            ? {
                recipientName: proofs[0].recipientName,
                capturedAt: proofs[0].capturedAt.toISOString(),
                signed: !!proofs[0].signatureDocId,
              }
            : null,
        },
      };
    },
  );
};
