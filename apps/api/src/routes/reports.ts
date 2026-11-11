import { and, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { exceptionsReportSchema, reportOverviewDtoSchema, reportsQuerySchema, type ExceptionDto } from "@transitum/shared";
import { z } from "zod";
import {
  carrierInvoices,
  partners,
  proofsOfDelivery,
  routes,
  routeStops,
  shipmentCosts,
  shipments,
} from "../db/schema.js";
import { estimatedCo2Kg } from "../lib/dto.js";

const carriers = alias(partners, "carriers");

const csv = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Relatórios operacionais: KPIs de expedições, custos e transportadoras + CSV. */
export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const range = (from?: string, to?: string) => {
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const fromDate = from ? new Date(`${from}T00:00:00Z`) : new Date(toDate.getTime() - 30 * 86400_000);
    return { fromDate, toDate };
  };
  const inRange = (col: Parameters<typeof gte>[0], fromDate: Date, toDate: Date): SQL =>
    and(gte(col as never, fromDate), lt(col as never, toDate))!;

  app.get(
    "/overview",
    {
      preHandler: app.requirePermission("reports:read"),
      schema: {
        querystring: reportsQuerySchema,
        response: { 200: z.object({ report: reportOverviewDtoSchema }) },
      },
    },
    async (req) => {
      const { fromDate, toDate } = range(req.query.from, req.query.to);
      const tid = req.user.tid;

      const rows = await app.db
        .select({ s: shipments, customerName: partners.name, carrierName: carriers.name })
        .from(shipments)
        .innerJoin(partners, eq(shipments.customerId, partners.id))
        .leftJoin(carriers, eq(shipments.carrierId, carriers.id))
        .where(and(eq(shipments.tenantId, tid), inRange(shipments.createdAt, fromDate, toDate)));

      const costs = await app.db
        .select({ c: shipmentCosts, carrierId: shipments.carrierId, shipmentWeight: shipments.totalWeightKg })
        .from(shipmentCosts)
        .innerJoin(shipments, eq(shipmentCosts.shipmentId, shipments.id))
        .where(and(eq(shipmentCosts.tenantId, tid), inRange(shipmentCosts.createdAt, fromDate, toDate)));

      const [routeAgg] = await app.db
        .select({
          completed: sql<number>`count(*) filter (where ${routes.status} = 'completed')::int`,
        })
        .from(routes)
        .where(and(eq(routes.tenantId, tid), inRange(routes.createdAt, fromDate, toDate)));
      const [stopAgg] = await app.db
        .select({
          done: sql<number>`count(*) filter (where ${routeStops.status} = 'done')::int`,
          skipped: sql<number>`count(*) filter (where ${routeStops.status} = 'skipped')::int`,
        })
        .from(routeStops)
        .where(and(eq(routeStops.tenantId, tid), inRange(routeStops.createdAt, fromDate, toDate)));
      const [proofAgg] = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(proofsOfDelivery)
        .where(and(eq(proofsOfDelivery.tenantId, tid), inRange(proofsOfDelivery.capturedAt, fromDate, toDate)));

      // Scorecard: PODs e faturas auditadas por transportadora
      const podsByCarrier = await app.db
        .select({ carrierId: shipments.carrierId, n: sql<number>`count(*)::int` })
        .from(proofsOfDelivery)
        .innerJoin(shipments, eq(proofsOfDelivery.shipmentId, shipments.id))
        .where(and(eq(proofsOfDelivery.tenantId, tid), inRange(proofsOfDelivery.capturedAt, fromDate, toDate)))
        .groupBy(shipments.carrierId);
      const podCount = new Map(podsByCarrier.map((r) => [r.carrierId, r.n]));
      const invoicesByCarrier = await app.db
        .select({
          carrierId: carrierInvoices.carrierId,
          n: sql<number>`count(*)::int`,
          discrepancies: sql<number>`count(*) filter (where ${carrierInvoices.status} = 'discrepancy')::int`,
        })
        .from(carrierInvoices)
        .where(and(eq(carrierInvoices.tenantId, tid), inRange(carrierInvoices.createdAt, fromDate, toDate)))
        .groupBy(carrierInvoices.carrierId);
      const invoiceCount = new Map(invoicesByCarrier.map((r) => [r.carrierId, r]));

      // KPIs de expedições
      const byStatus: Record<string, number> = {};
      let delivered = 0;
      let deliveredWithPlan = 0;
      let onTime = 0;
      let transitHours = 0;
      let transitCount = 0;
      const weekly = new Map<string, { created: number; delivered: number; cost: number }>();
      const weekOf = (d: Date) => {
        const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // segunda-feira
        return dt.toISOString().slice(0, 10);
      };
      const carriersMap = new Map<string, { name: string; shipments: number; delivered: number; withPlan: number; onTime: number; cost: number }>();
      const customersMap = new Map<string, { name: string; shipments: number }>();

      for (const { s, customerName, carrierName } of rows) {
        byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
        const wk = weekly.get(weekOf(s.createdAt)) ?? { created: 0, delivered: 0, cost: 0 };
        wk.created++;
        weekly.set(weekOf(s.createdAt), wk);

        const c = customersMap.get(s.customerId) ?? { name: customerName, shipments: 0 };
        c.shipments++;
        customersMap.set(s.customerId, c);

        if (s.carrierId) {
          const k = carriersMap.get(s.carrierId) ?? { name: carrierName ?? "", shipments: 0, delivered: 0, withPlan: 0, onTime: 0, cost: 0 };
          k.shipments++;
          if (s.status === "delivered") {
            k.delivered++;
            if (s.plannedDeliveryAt) {
              k.withPlan++;
              if (s.deliveredAt && s.deliveredAt <= s.plannedDeliveryAt) k.onTime++;
            }
          }
          carriersMap.set(s.carrierId, k);
        }

        if (s.status === "delivered" && s.deliveredAt) {
          delivered++;
          const dwk = weekly.get(weekOf(s.deliveredAt)) ?? { created: 0, delivered: 0, cost: 0 };
          dwk.delivered++;
          weekly.set(weekOf(s.deliveredAt), dwk);
          if (s.plannedDeliveryAt) {
            deliveredWithPlan++;
            if (s.deliveredAt <= s.plannedDeliveryAt) onTime++;
          }
          if (s.stockIssuedAt) {
            transitHours += (s.deliveredAt.getTime() - s.stockIssuedAt.getTime()) / 3_600_000;
            transitCount++;
          }
        }
      }

      // Custos
      const byType: Record<string, number> = {};
      let totalCost = 0;
      const costShipmentIds = new Set<string>();
      for (const { c, carrierId } of costs) {
        byType[c.type] = (byType[c.type] ?? 0) + c.amount;
        totalCost += c.amount;
        costShipmentIds.add(c.shipmentId);
        if (carrierId && carriersMap.has(carrierId)) {
          carriersMap.get(carrierId)!.cost += c.amount;
        }
        const wk = weekly.get(weekOf(c.createdAt));
        if (wk) wk.cost += c.amount;
      }
      const totalWeightKg = rows.reduce((a, r) => a + (r.s.totalWeightKg ?? 0), 0);
      const totalCo2Kg = rows.reduce((a, r) => a + (estimatedCo2Kg(r.s) ?? 0), 0);

      return {
        report: {
          from: fromDate.toISOString().slice(0, 10),
          to: toDate.toISOString().slice(0, 10),
          shipments: {
            total: rows.length,
            byStatus,
            delivered,
            deliveredWithPlan,
            onTime,
            onTimeRate: deliveredWithPlan ? Math.round((onTime / deliveredWithPlan) * 1000) / 1000 : null,
            avgTransitHours: transitCount ? Math.round((transitHours / transitCount) * 10) / 10 : null,
            estimatedCo2Kg: Math.round(totalCo2Kg * 100) / 100,
          },
          costs: {
            total: Math.round(totalCost * 100) / 100,
            perShipment: costShipmentIds.size ? Math.round((totalCost / costShipmentIds.size) * 100) / 100 : null,
            perKg: totalWeightKg > 0 ? Math.round((totalCost / totalWeightKg) * 100) / 100 : null,
            totalWeightKg: Math.round(totalWeightKg * 100) / 100,
            byType,
          },
          carriers: [...carriersMap.entries()]
            .map(([carrierId, k]) => ({
              carrierId,
              carrierName: k.name,
              shipments: k.shipments,
              delivered: k.delivered,
              onTimeRate: k.withPlan ? Math.round((k.onTime / k.withPlan) * 1000) / 1000 : null,
              podRate: k.delivered
                ? Math.round(Math.min((podCount.get(carrierId) ?? 0) / k.delivered, 1) * 1000) / 1000
                : null,
              totalCost: Math.round(k.cost * 100) / 100,
              avgCost: k.shipments ? Math.round((k.cost / k.shipments) * 100) / 100 : null,
              invoices: invoiceCount.get(carrierId)?.n ?? 0,
              invoiceDiscrepancies: invoiceCount.get(carrierId)?.discrepancies ?? 0,
            }))
            .sort((a, b) => b.shipments - a.shipments),
          customers: [...customersMap.entries()]
            .map(([customerId, c]) => ({ customerId, customerName: c.name, shipments: c.shipments }))
            .sort((a, b) => b.shipments - a.shipments)
            .slice(0, 10),
          weekly: [...weekly.entries()]
            .map(([week, w]) => ({ week, created: w.created, delivered: w.delivered, cost: Math.round(w.cost * 100) / 100 }))
            .sort((a, b) => a.week.localeCompare(b.week)),
          routes: {
            completed: routeAgg?.completed ?? 0,
            stopsDone: stopAgg?.done ?? 0,
            stopsSkipped: stopAgg?.skipped ?? 0,
            proofs: proofAgg?.n ?? 0,
          },
        },
      };
    },
  );

  /**
   * Torre de controlo: exceções operacionais ativas — expedições em atraso
   * (data prevista passada e por entregar), entregues sem POD e em curso
   * sem transportadora atribuída.
   */
  app.get(
    "/exceptions",
    {
      preHandler: app.requirePermission("reports:read"),
      schema: { response: { 200: z.object({ report: exceptionsReportSchema }) } },
    },
    async (req) => {
      const tid = req.user.tid;
      const now = new Date();
      const items: ExceptionDto[] = [];

      // Em atraso: previstas antes de agora e ainda não entregues/canceladas
      const late = await app.db
        .select({ s: shipments, customerName: partners.name })
        .from(shipments)
        .innerJoin(partners, eq(shipments.customerId, partners.id))
        .where(
          and(
            eq(shipments.tenantId, tid),
            inArray(shipments.status, ["planned", "in_transit"]),
            lt(shipments.plannedDeliveryAt, now),
          ),
        );
      for (const { s, customerName } of late) {
        items.push({
          type: "late",
          severity: "high",
          shipmentId: s.id,
          shipmentNumber: s.number,
          customerName,
          message: `Entrega prevista para ${s.plannedDeliveryAt!.toISOString().slice(0, 10)} — ${s.status === "in_transit" ? "em trânsito" : "por iniciar"}`,
          since: s.plannedDeliveryAt!.toISOString(),
        });
      }

      // Entregues sem prova de entrega
      const deliveredNoPod = await app.db
        .select({ s: shipments, customerName: partners.name, podId: proofsOfDelivery.id })
        .from(shipments)
        .innerJoin(partners, eq(shipments.customerId, partners.id))
        .leftJoin(proofsOfDelivery, eq(proofsOfDelivery.shipmentId, shipments.id))
        .where(
          and(
            eq(shipments.tenantId, tid),
            eq(shipments.status, "delivered"),
            isNull(proofsOfDelivery.id),
          ),
        );
      for (const { s, customerName } of deliveredNoPod) {
        items.push({
          type: "missing_pod",
          severity: "medium",
          shipmentId: s.id,
          shipmentNumber: s.number,
          customerName,
          message: "Entregue sem prova de entrega registada",
          since: s.deliveredAt?.toISOString() ?? null,
        });
      }

      // Em curso sem transportadora
      const noCarrier = await app.db
        .select({ s: shipments, customerName: partners.name })
        .from(shipments)
        .innerJoin(partners, eq(shipments.customerId, partners.id))
        .where(
          and(
            eq(shipments.tenantId, tid),
            inArray(shipments.status, ["planned", "in_transit"]),
            isNull(shipments.carrierId),
          ),
        );
      for (const { s, customerName } of noCarrier) {
        items.push({
          type: "no_carrier",
          severity: "medium",
          shipmentId: s.id,
          shipmentNumber: s.number,
          customerName,
          message: "Expedição em curso sem transportadora atribuída",
          since: null,
        });
      }

      items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
      return {
        report: {
          late: late.length,
          missingPod: deliveredNoPod.length,
          noCarrier: noCarrier.length,
          items,
        },
      };
    },
  );

  // Exportação CSV de expedições do período (Excel-friendly, ; e BOM)
  app.get(
    "/shipments.csv",
    {
      preHandler: app.requirePermission("reports:read"),
      schema: { querystring: reportsQuerySchema },
    },
    async (req, reply) => {
      const { fromDate, toDate } = range(req.query.from, req.query.to);
      const rows = await app.db
        .select({ s: shipments, customerName: partners.name, carrierName: carriers.name })
        .from(shipments)
        .innerJoin(partners, eq(shipments.customerId, partners.id))
        .leftJoin(carriers, eq(shipments.carrierId, carriers.id))
        .where(and(eq(shipments.tenantId, req.user.tid), inRange(shipments.createdAt, fromDate, toDate)))
        .orderBy(shipments.number);
      const header = "Número;Estado;Cliente;Transportadora;Origem;Destino;Peso kg;Volumes;Criado;Entregue;Custo total";
      const costAgg = await app.db
        .select({ shipmentId: shipmentCosts.shipmentId, total: sql<number>`sum(${shipmentCosts.amount})` })
        .from(shipmentCosts)
        .where(eq(shipmentCosts.tenantId, req.user.tid))
        .groupBy(shipmentCosts.shipmentId);
      const costMap = new Map(costAgg.map((c) => [c.shipmentId, c.total]));
      const lines = rows.map(({ s, customerName, carrierName }) =>
        [
          s.number,
          s.status,
          customerName,
          carrierName ?? "",
          `${s.pickupCity} ${s.pickupCountry}`,
          `${s.deliveryCity} ${s.deliveryCountry}`,
          s.totalWeightKg ?? "",
          s.packages ?? "",
          s.createdAt.toISOString().slice(0, 10),
          s.deliveredAt?.toISOString().slice(0, 10) ?? "",
          costMap.get(s.id)?.toFixed(2) ?? "0.00",
        ].map(csv).join(";"),
      );
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="expedicoes-${fromDate.toISOString().slice(0, 10)}_${toDate.toISOString().slice(0, 10)}.csv"`);
      return reply.send(`﻿${header}\n${lines.join("\n")}`);
    },
  );
};
