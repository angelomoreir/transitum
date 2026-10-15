import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { statsSchema } from "@blujay/shared";
import { z } from "zod";
import {
  auditEvents,
  items,
  orders,
  partners,
  purchaseOrders,
  refreshTokens,
  routes,
  shipments,
  users,
} from "../db/schema.js";

export const miscRoutes: FastifyPluginAsyncZod = async (app) => {
  // Indicadores do dashboard — dados reais do tenant
  app.get(
    "/stats",
    {
      preHandler: app.requirePermission("stats:read"),
      schema: { response: { 200: statsSchema } },
    },
    async (req) => {
      const tid = req.user.tid;
      const [
        [active],
        [invited],
        [suspended],
        [sessions],
        [partnersCount],
        [ordersCount],
        [openOrders],
        [activeShipments],
        [deliveredShipments],
        [activeRoutes],
        [openPurchases],
        [stockItems],
        recent,
      ] = await Promise.all([
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.tenantId, tid), eq(users.status, "active"))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.tenantId, tid), eq(users.status, "invited"))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.tenantId, tid), eq(users.status, "suspended"))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.tenantId, tid),
              isNull(refreshTokens.revokedAt),
              gt(refreshTokens.expiresAt, new Date()),
            ),
          ),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(partners)
          .where(and(eq(partners.tenantId, tid), eq(partners.active, true))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(orders)
          .where(eq(orders.tenantId, tid)),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(orders)
          .where(and(eq(orders.tenantId, tid), eq(orders.status, "confirmed"))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(shipments)
          .where(
            and(
              eq(shipments.tenantId, tid),
              or(eq(shipments.status, "planned"), eq(shipments.status, "in_transit")),
            ),
          ),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(shipments)
          .where(and(eq(shipments.tenantId, tid), eq(shipments.status, "delivered"))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(routes)
          .where(and(eq(routes.tenantId, tid), eq(routes.status, "dispatched"))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.tenantId, tid),
              or(
                eq(purchaseOrders.status, "sent"),
                eq(purchaseOrders.status, "partially_received"),
              ),
            ),
          ),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(items)
          .where(and(eq(items.tenantId, tid), eq(items.active, true))),
        app.db
          .select({
            id: auditEvents.id,
            action: auditEvents.action,
            createdAt: auditEvents.createdAt,
            actorName: users.name,
          })
          .from(auditEvents)
          .leftJoin(users, eq(auditEvents.actorId, users.id))
          .where(eq(auditEvents.tenantId, tid))
          .orderBy(desc(auditEvents.createdAt))
          .limit(5),
      ]);
      return {
        activeUsers: active.count,
        pendingInvites: invited.count,
        suspendedUsers: suspended.count,
        activeSessions: sessions.count,
        partners: partnersCount.count,
        orders: ordersCount.count,
        openOrders: openOrders.count,
        activeShipments: activeShipments.count,
        deliveredShipments: deliveredShipments.count,
        activeRoutes: activeRoutes.count,
        openPurchases: openPurchases.count,
        stockItems: stockItems.count,
        recentEvents: recent.map((e) => ({
          id: e.id,
          action: e.action,
          actorName: e.actorName ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    "/search",
    {
      preHandler: app.requirePermission("search"),
      schema: {
        querystring: z.object({ q: z.string().trim().min(1).max(120) }),
        response: {
          200: z.object({
            users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
            partners: z.array(
              z.object({ id: z.string(), name: z.string(), code: z.string(), types: z.array(z.string()) }),
            ),
            orders: z.array(z.object({ id: z.string(), number: z.string(), status: z.string() })),
            shipments: z.array(z.object({ id: z.string(), number: z.string(), status: z.string() })),
            routes: z.array(
              z.object({ id: z.string(), number: z.string(), name: z.string(), status: z.string() }),
            ),
            purchaseOrders: z.array(
              z.object({ id: z.string(), number: z.string(), status: z.string() }),
            ),
            items: z.array(
              z.object({ id: z.string(), sku: z.string(), name: z.string() }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const pattern = `%${req.query.q}%`;
      const tid = req.user.tid;
      const [foundUsers, foundPartners, foundOrders, foundShipments, foundRoutes, foundPos, foundItems] =
        await Promise.all([
        app.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(
            and(eq(users.tenantId, tid), or(ilike(users.name, pattern), ilike(users.email, pattern))),
          )
          .limit(5),
        app.db
          .select({ id: partners.id, name: partners.name, code: partners.code, types: partners.types })
          .from(partners)
          .where(
            and(
              eq(partners.tenantId, tid),
              or(ilike(partners.name, pattern), ilike(partners.code, pattern)),
            ),
          )
          .limit(5),
        app.db
          .select({ id: orders.id, number: orders.number, status: orders.status })
          .from(orders)
          .where(and(eq(orders.tenantId, tid), ilike(orders.number, pattern)))
          .limit(5),
        app.db
          .select({ id: shipments.id, number: shipments.number, status: shipments.status })
          .from(shipments)
          .where(and(eq(shipments.tenantId, tid), ilike(shipments.number, pattern)))
          .limit(5),
        app.db
          .select({
            id: routes.id,
            number: routes.number,
            name: routes.name,
            status: routes.status,
          })
          .from(routes)
          .where(
            and(
              eq(routes.tenantId, tid),
              or(ilike(routes.number, pattern), ilike(routes.name, pattern)),
            ),
          )
          .limit(5),
        app.db
          .select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status })
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.tenantId, tid), ilike(purchaseOrders.number, pattern)))
          .limit(5),
        app.db
          .select({ id: items.id, sku: items.sku, name: items.name })
          .from(items)
          .where(
            and(
              eq(items.tenantId, tid),
              or(ilike(items.sku, pattern), ilike(items.name, pattern)),
            ),
          )
          .limit(5),
      ]);
      return {
        users: foundUsers,
        partners: foundPartners.map((p) => ({ ...p, types: p.types as string[] })),
        orders: foundOrders,
        shipments: foundShipments,
        routes: foundRoutes,
        purchaseOrders: foundPos,
        items: foundItems,
      };
    },
  );
};
