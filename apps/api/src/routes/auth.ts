import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  acceptInviteSchema,
  authResponseSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tenantDtoSchema,
  userDtoSchema,
} from "@blujay/shared";
import { z } from "zod";
import { authTokens, refreshTokens, tenants, users } from "../db/schema.js";
import { env } from "../env.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";
import { seedDefaultRules } from "../lib/notify.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import {
  clearSessionCookie,
  createSession,
  REFRESH_COOKIE,
  signAccessToken,
  toTenantDto,
  toUserDto,
} from "../lib/session.js";
import { generateToken, hashToken, slugify } from "../lib/tokens.js";

const AUTH_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {

  // Registo: cria empresa (tenant) + utilizador admin
  app.post(
    "/register",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: registerSchema, response: { 200: authResponseSchema } },
    },
    async (req, reply) => {
      const { companyName, name, email, password } = req.body;
      const [existing] = await app.db.select().from(users).where(eq(users.email, email));
      if (existing) throw conflict("Já existe uma conta com este email");

      const baseSlug = slugify(companyName);
      let slug = baseSlug;
      for (let i = 2; ; i++) {
        const [dup] = await app.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
        if (!dup) break;
        slug = `${baseSlug}-${i}`;
      }

      const [tenant] = await app.db
        .insert(tenants)
        .values({ name: companyName, slug })
        .returning();
      const [user] = await app.db
        .insert(users)
        .values({
          tenantId: tenant.id,
          email,
          name,
          passwordHash: hashPassword(password),
          role: "admin",
          status: "active",
          lastLoginAt: new Date(),
        })
        .returning();

      await audit(app.db, {
        tenantId: tenant.id,
        actorId: user.id,
        action: "tenant.registered",
        entity: "tenant",
        entityId: tenant.id,
        ip: req.ip,
      });

      // Regras de automatização por omissão do novo tenant
      await seedDefaultRules(app.db, tenant.id);

      await createSession(app.db, reply, user, req);
      return {
        accessToken: signAccessToken(app, user),
        user: toUserDto(user),
        tenant: toTenantDto(tenant),
      };
    },
  );

  app.post(
    "/login",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: loginSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const [user] = await app.db.select().from(users).where(eq(users.email, email));
      if (!user || !verifyPassword(password, user.passwordHash)) {
        throw unauthorized("Email ou palavra-passe incorretos");
      }
      if (user.status === "suspended") {
        throw unauthorized("Conta suspensa — contacte o administrador");
      }
      if (user.status === "invited") {
        throw unauthorized("Conta ainda não ativada — verifique o convite");
      }

      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(app.db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.login",
        entity: "user",
        entityId: user.id,
        ip: req.ip,
      });

      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId));
      await createSession(app.db, reply, user, req);
      return {
        accessToken: signAccessToken(app, user),
        user: toUserDto(user),
        tenant: toTenantDto(tenant),
      };
    },
  );

  // Rotação de refresh token (cookie httpOnly)
  app.post("/refresh", async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw unauthorized();
    const tokenHash = hashToken(raw);
    const [session] = await app.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));

    if (!session) throw unauthorized();

    // Reutilização de token revogado → revogar todas as sessões do utilizador
    if (session.revokedAt) {
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, session.userId), isNull(refreshTokens.revokedAt)));
      throw unauthorized();
    }
    if (session.expiresAt < new Date()) throw unauthorized();

    const [user] = await app.db.select().from(users).where(eq(users.id, session.userId));
    if (!user || user.status !== "active") throw unauthorized();

    const token = generateToken();
    const [next] = await app.db
      .insert(refreshTokens)
      .values({
        tenantId: session.tenantId,
        userId: session.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.slice(0, 255) ?? null,
      })
      .returning();
    await app.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedById: next.id })
      .where(eq(refreshTokens.id, session.id));

    reply.setCookie(REFRESH_COOKIE, token, {
      path: "/api/auth",
      httpOnly: true,
      sameSite: "lax",
      secure: env.COOKIE_SECURE,
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
    });
    return { accessToken: signAccessToken(app, user) };
  });

  app.post("/logout", async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) {
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashToken(raw)));
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get(
    "/me",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: z.object({ user: userDtoSchema, tenant: tenantDtoSchema }) } },
    },
    async (req) => {
      const [user] = await app.db
        .select()
        .from(users)
        .where(and(eq(users.id, req.user.sub), eq(users.tenantId, req.user.tid)));
      if (!user) throw unauthorized();
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId));
      return { user: toUserDto(user), tenant: toTenantDto(tenant) };
    },
  );

  // Recuperação de palavra-passe — resposta sempre 200 para não revelar emails
  app.post(
    "/forgot-password",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: forgotPasswordSchema },
    },
    async (req) => {
      const { email } = req.body;
      const [user] = await app.db.select().from(users).where(eq(users.email, email));
      if (user && user.status === "active") {
        const token = generateToken();
        await app.db.insert(authTokens).values({
          tenantId: user.tenantId,
          userId: user.id,
          type: "reset",
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + env.RESET_TOKEN_TTL_MINUTES * 60_000),
        });
        await app.mailer.send(
          email,
          "Recuperação de palavra-passe — Blujay",
          `Para redefinir a sua palavra-passe: ${env.WEB_BASE_URL}/reset-password?token=${token}`,
        );
        await audit(app.db, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "auth.password_reset_requested",
          entity: "user",
          entityId: user.id,
          ip: req.ip,
        });
      }
      return { ok: true };
    },
  );

  app.post(
    "/reset-password",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: resetPasswordSchema },
    },
    async (req) => {
      const { token, password } = req.body;
      const [row] = await app.db
        .select()
        .from(authTokens)
        .where(
          and(
            eq(authTokens.tokenHash, hashToken(token)),
            eq(authTokens.type, "reset"),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, new Date()),
          ),
        );
      if (!row) throw badRequest("Token inválido ou expirado");

      await app.db
        .update(users)
        .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
        .where(eq(users.id, row.userId));
      await app.db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
      // Terminar todas as sessões após reset
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      await audit(app.db, {
        tenantId: row.tenantId,
        actorId: row.userId,
        action: "auth.password_reset",
        entity: "user",
        entityId: row.userId,
        ip: req.ip,
      });
      return { ok: true };
    },
  );

  app.post(
    "/accept-invite",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: acceptInviteSchema, response: { 200: authResponseSchema } },
    },
    async (req, reply) => {
      const { token, password, name } = req.body;
      const [row] = await app.db
        .select()
        .from(authTokens)
        .where(
          and(
            eq(authTokens.tokenHash, hashToken(token)),
            eq(authTokens.type, "invite"),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, new Date()),
          ),
        );
      if (!row) throw badRequest("Convite inválido ou expirado");

      const [user] = await app.db
        .update(users)
        .set({
          passwordHash: hashPassword(password),
          status: "active",
          name: name ?? undefined,
          updatedAt: new Date(),
          lastLoginAt: new Date(),
        })
        .where(eq(users.id, row.userId))
        .returning();
      if (!user) throw badRequest("Convite inválido");
      await app.db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
      await audit(app.db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "users.invite_accepted",
        entity: "user",
        entityId: user.id,
        ip: req.ip,
      });

      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId));
      await createSession(app.db, reply, user, req);
      return {
        accessToken: signAccessToken(app, user),
        user: toUserDto(user),
        tenant: toTenantDto(tenant),
      };
    },
  );

  app.post(
    "/change-password",
    {
      preHandler: app.authenticate,
      schema: { body: changePasswordSchema },
    },
    async (req) => {
      const { currentPassword, newPassword } = req.body;
      const [user] = await app.db.select().from(users).where(eq(users.id, req.user.sub));
      if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
        throw badRequest("Palavra-passe atual incorreta");
      }
      await app.db
        .update(users)
        .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
        .where(eq(users.id, user.id));
      // Revogar outras sessões; a atual mantém-se via novo refresh implícito
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
      await audit(app.db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.password_changed",
        entity: "user",
        entityId: user.id,
        ip: req.ip,
      });
      return { ok: true };
    },
  );
};
