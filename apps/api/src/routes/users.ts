import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import {
  inviteUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userDtoSchema,
} from "@transitum/shared";
import { z } from "zod";
import { authTokens, refreshTokens, users } from "../db/schema.js";
import { env } from "../env.js";
import { audit } from "../lib/audit.js";
import { getSubscriptionWithPlan } from "../lib/billing.js";
import { isProtectedDemoUser } from "../lib/demo.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { toUserDto } from "../lib/session.js";
import { generateToken, hashToken } from "../lib/tokens.js";

const INVITE_TTL_DAYS = 7;

const userListResponse = z.object({
  items: z.array(userDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const userRoutes: FastifyPluginAsyncZod = async (app) => {

  app.get(
    "/",
    {
      preHandler: app.requirePermission("users:read"),
      schema: { querystring: listUsersQuerySchema, response: { 200: userListResponse } },
    },
    async (req) => {
      const { page, pageSize, q, role, status } = req.query;
      const conditions = [eq(users.tenantId, req.user.tid)];
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
      }
      if (role) conditions.push(eq(users.role, role));
      if (status) conditions.push(eq(users.status, status));

      const where = and(...conditions);
      const [items, [{ count }]] = await Promise.all([
        app.db
          .select()
          .from(users)
          .where(where)
          .orderBy(desc(users.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
      ]);
      return { items: items.map((u) => toUserDto(u)), total: count, page, pageSize };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("users:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ user: userDtoSchema }) },
      },
    },
    async (req) => {
      const [user] = await app.db
        .select()
        .from(users)
        .where(and(eq(users.id, req.params.id), eq(users.tenantId, req.user.tid)));
      if (!user) throw notFound("Utilizador não encontrado");
      return { user: toUserDto(user) };
    },
  );

  app.post(
    "/invite",
    {
      preHandler: app.requirePermission("users:invite"),
      schema: {
        body: inviteUserSchema,
        response: { 201: z.object({ user: userDtoSchema, inviteUrl: z.string() }) },
      },
    },
    async (req, reply) => {
      const { name, email, role } = req.body;
      const [existing] = await app.db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (existing) throw badRequest("Já existe um utilizador com este email");

      // Limite de utilizadores do plano de subscrição
      const sp = await getSubscriptionWithPlan(app.db, req.user.tid);
      if (sp) {
        const [{ count: userCount }] = await app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.tenantId, req.user.tid), ne(users.status, "suspended")));
        if (userCount >= sp.plan.maxUsers) {
          throw forbidden(
            `Limite do plano ${sp.plan.name} atingido (${sp.plan.maxUsers} utilizadores)`,
          );
        }
      }

      const [user] = await app.db
        .insert(users)
        .values({ tenantId: req.user.tid, name, email, role, status: "invited" })
        .returning();

      const token = generateToken();
      await app.db.insert(authTokens).values({
        tenantId: req.user.tid,
        userId: user.id,
        type: "invite",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      });
      const inviteUrl = `${env.WEB_BASE_URL}/accept-invite?token=${token}`;
      await app.mailer.send(
        email,
        "Convite para a Transitum",
        `Foi convidado para a plataforma Transitum. Ative a sua conta: ${inviteUrl}`,
      );
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "users.invited",
        entity: "user",
        entityId: user.id,
        metadata: { email, role },
        ip: req.ip,
      });
      return reply.code(201).send({ user: toUserDto(user), inviteUrl });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("users:update"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: updateUserSchema,
        response: { 200: z.object({ user: userDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(users)
        .where(and(eq(users.id, req.params.id), eq(users.tenantId, req.user.tid)));
      if (!target) throw notFound("Utilizador não encontrado");
      if (target.id === req.user.sub && (req.body.role || req.body.status)) {
        throw badRequest("Não pode alterar a sua própria função ou estado");
      }
      if (isProtectedDemoUser(target.email) && (req.body.role || req.body.status)) {
        throw forbidden("Modo demonstração — contas demo não podem ser alteradas");
      }
      // Apenas admin pode alterar função/estado
      if ((req.body.role || req.body.status) && req.user.role !== "admin") {
        throw forbidden("Apenas administradores podem alterar função ou estado");
      }
      if (target.role === "admin" && req.user.role !== "admin") {
        throw forbidden("Apenas administradores podem editar administradores");
      }
      // Impedir suspensão/despromoção do último admin ativo
      const removingAdmin =
        target.role === "admin" &&
        ((req.body.role && req.body.role !== "admin") || req.body.status === "suspended");
      if (removingAdmin) {
        const [{ count }] = await app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.tenantId, req.user.tid),
              eq(users.role, "admin"),
              eq(users.status, "active"),
              ne(users.id, target.id),
            ),
          );
        if (count === 0) throw badRequest("Tem de existir pelo menos um administrador ativo");
      }

      const [updated] = await app.db
        .update(users)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(users.id, target.id))
        .returning();
      if (req.body.status === "suspended") {
        await app.db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, target.id), isNull(refreshTokens.revokedAt)));
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "users.updated",
        entity: "user",
        entityId: target.id,
        metadata: req.body,
        ip: req.ip,
      });
      return { user: toUserDto(updated) };
    },
  );

  app.delete(
    "/:id",
    { preHandler: app.requirePermission("users:suspend") },
    async (req) => {
      const id = (req.params as { id: string }).id;
      const [target] = await app.db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, req.user.tid)));
      if (!target) throw notFound("Utilizador não encontrado");
      if (target.id === req.user.sub) throw badRequest("Não pode suspender a sua própria conta");
      if (isProtectedDemoUser(target.email)) {
        throw forbidden("Modo demonstração — contas demo não podem ser suspensas");
      }
      if (target.role === "admin" && req.user.role !== "admin") {
        throw forbidden("Apenas administradores podem suspender administradores");
      }
      const [updated] = await app.db
        .update(users)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(eq(users.id, target.id))
        .returning();
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, target.id), isNull(refreshTokens.revokedAt)));
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "users.suspended",
        entity: "user",
        entityId: target.id,
        ip: req.ip,
      });
      return { user: toUserDto(updated) };
    },
  );

  app.post(
    "/:id/resend-invite",
    { preHandler: app.requirePermission("users:invite") },
    async (req) => {
      const id = (req.params as { id: string }).id;
      const [target] = await app.db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.tenantId, req.user.tid)));
      if (!target) throw notFound("Utilizador não encontrado");
      if (target.status !== "invited") {
        throw badRequest("Só é possível reenviar convites a contas por ativar");
      }
      const token = generateToken();
      await app.db.insert(authTokens).values({
        tenantId: req.user.tid,
        userId: target.id,
        type: "invite",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      });
      const inviteUrl = `${env.WEB_BASE_URL}/accept-invite?token=${token}`;
      await app.mailer.send(
        target.email,
        "Convite para a Transitum",
        `Foi convidado para a plataforma Transitum. Ative a sua conta: ${inviteUrl}`,
      );
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "users.invite_resent",
        entity: "user",
        entityId: target.id,
        ip: req.ip,
      });
      return { inviteUrl };
    },
  );
};
