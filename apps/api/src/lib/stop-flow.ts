import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { STOP_TRANSITIONS, type StopStatus } from "@transitum/shared";
import { routeStops, routes, shipmentEvents, shipments } from "../db/schema.js";
import { badRequest } from "./errors.js";
import { changeShipmentStatus, type Actor } from "./shipment-flow.js";

const STOP_TYPE_LABELS: Record<string, string> = { pickup: "Recolha", delivery: "Entrega" };

/**
 * Transição de uma paragem. Concluir:
 *  - regista checkpoint na timeline da expedição ligada;
 *  - recolha concluída com expedição planeada → em trânsito (saída de stock);
 *  - entrega concluída com expedição em trânsito → entregue.
 */
export async function transitionStop(
  app: FastifyInstance,
  actor: Actor,
  row: { stop: typeof routeStops.$inferSelect; route: typeof routes.$inferSelect },
  next: Exclude<StopStatus, "pending">,
  opts: { note?: string; source?: string } = {},
) {
  const allowed = STOP_TRANSITIONS[row.stop.status as StopStatus] ?? [];
  if (!allowed.includes(next)) throw badRequest(`Transição inválida: ${row.stop.status} → ${next}`);

  const now = new Date();
  const [updated] = await app.db
    .update(routeStops)
    .set({
      status: next,
      arrivedAt: next === "arrived" ? now : row.stop.arrivedAt,
      doneAt: next === "done" ? now : undefined,
      note: opts.note ?? row.stop.note,
    })
    .where(eq(routeStops.id, row.stop.id))
    .returning();

  if (next === "done" && row.stop.shipmentId) {
    const location = `${row.stop.city}, ${row.stop.country}`;
    await app.db.insert(shipmentEvents).values({
      tenantId: actor.tenantId,
      shipmentId: row.stop.shipmentId,
      type: "checkpoint",
      description: `${STOP_TYPE_LABELS[row.stop.type]} em ${row.stop.city} concluída (rota ${row.route.number})`,
      location,
      createdBy: actor.userId,
    });
    const [s] = await app.db.select().from(shipments).where(eq(shipments.id, row.stop.shipmentId));
    if (s && row.stop.type === "pickup" && s.status === "planned") {
      await changeShipmentStatus(app, actor, s, "in_transit", { location, source: `rota ${row.route.number}` });
    } else if (s && row.stop.type === "delivery" && s.status === "in_transit") {
      await changeShipmentStatus(app, actor, s, "delivered", { location, source: `rota ${row.route.number}` });
    }
  }
  return updated;
}
