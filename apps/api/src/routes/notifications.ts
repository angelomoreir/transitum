import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { listNotificationsQuerySchema, notificationSchema } from "@transitum/shared";
import { z } from "zod";
import { notifications } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/notifications",
    {
      preHandler: app.requirePermission("notifications:read"),
      schema: {
        querystring: listNotificationsQuerySchema,
        response: {
          200: z.object({
            items: z.array(notificationSchema),
            total: z.number(),
            unread: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        },
      },
    },
    async (req) => {
      const { page, pageSize, unread } = req.query;
      const conditions = [
        eq(notifications.tenantId, req.user.tid),
        eq(notifications.userId, req.user.sub),
      ];
      if (unread === "true") conditions.push(isNull(notifications.readAt));
      const where = and(...conditions);

      const [rows, [{ count }], [{ unreadCount }]] = await Promise.all([
        app.db
          .select()
          .from(notifications)
          .where(where)
          .orderBy(desc(notifications.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(where),
        app.db
          .select({ unreadCount: sql<number>`count(*)::int` })
          .from(notifications)
          .where(
            and(
              eq(notifications.tenantId, req.user.tid),
              eq(notifications.userId, req.user.sub),
              isNull(notifications.readAt),
            ),
          ),
      ]);
      return {
        items: rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body ?? null,
          link: n.link ?? null,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
        total: count,
        unread: unreadCount,
        page,
        pageSize,
      };
    },
  );

  app.post(
    "/notifications/:id/read",
    {
      preHandler: app.requirePermission("notifications:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const [n] = await app.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.id, req.params.id),
            eq(notifications.userId, req.user.sub),
            eq(notifications.tenantId, req.user.tid),
          ),
        );
      if (!n) throw notFound("Notificação não encontrada");
      await app.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, n.id));
      return { ok: true as const };
    },
  );

  app.post(
    "/notifications/read-all",
    {
      preHandler: app.requirePermission("notifications:read"),
      schema: { response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async (req) => {
      await app.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, req.user.sub),
            eq(notifications.tenantId, req.user.tid),
            isNull(notifications.readAt),
          ),
        );
      return { ok: true as const };
    },
  );
};
