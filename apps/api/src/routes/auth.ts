import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  acceptInviteSchema,
  authResponseSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginResponseSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  ssoLookupResponseSchema,
  ssoLookupSchema,
  tenantDtoSchema,
  userDtoSchema,
} from "@transitum/shared";
import { z } from "zod";
import { authTokens, refreshTokens, ssoProviders, ssoStates, tenants, users } from "../db/schema.js";
import { env } from "../env.js";
import { audit } from "../lib/audit.js";
import {
  createTrialSubscription,
  isUserPlatformAdmin,
  syncPlatformAdmin,
} from "../lib/billing.js";
import { badRequest, conflict, forbidden, unauthorized } from "../lib/errors.js";
import { isProtectedDemoUser } from "../lib/demo.js";
import { seedDefaultRules } from "../lib/notify.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import { decryptSecret, encryptSecret } from "../lib/secrets.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp.js";
import { apiBaseUrl, redirectUri } from "./sso-providers.js";
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
      // Subscrição trial (14 dias, plano Starter)
      await createTrialSubscription(app.db, tenant.id);
      // Platform admin via PLATFORM_ADMIN_EMAILS
      const isPlatformAdmin = await syncPlatformAdmin(app.db, user);

      await createSession(app.db, reply, user, req);
      return {
        accessToken: signAccessToken(app, user),
        user: toUserDto(user, isPlatformAdmin),
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
        response: { 200: loginResponseSchema },
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

      // MFA ativo → o cliente recebe um token temporário e completa o login
      // com o código TOTP em /mfa/verify
      if (user.totpEnabledAt && user.totpSecret) {
        await audit(app.db, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: "auth.mfa_challenged",
          entity: "user",
          entityId: user.id,
          ip: req.ip,
        });
        const mfaToken = app.jwt.sign(
          {
            sub: user.id,
            tid: user.tenantId,
            role: user.role,
            name: user.name,
            email: user.email,
            purpose: "mfa",
          },
          { expiresIn: "5m" },
        );
        return { mfaRequired: true as const, mfaToken };
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

      const isPlatformAdmin = await syncPlatformAdmin(app.db, user);
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId));
      await createSession(app.db, reply, user, req);
      return {
        accessToken: signAccessToken(app, user),
        user: toUserDto(user, isPlatformAdmin),
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
      const isPlatformAdmin = await isUserPlatformAdmin(app.db, user.id);
      return { user: toUserDto(user, isPlatformAdmin), tenant: toTenantDto(tenant) };
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
          "Recuperação de palavra-passe — Transitum",
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

      const isPlatformAdmin = await syncPlatformAdmin(app.db, user);
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId));
      await createSession(app.db, reply, user, req);
      return {
        accessToken: signAccessToken(app, user),
        user: toUserDto(user, isPlatformAdmin),
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
      if (isProtectedDemoUser(user.email)) {
        throw forbidden("Modo demonstração — a palavra-passe desta conta não pode ser alterada");
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

  // ── MFA / TOTP ──────────────────────────────────────────────────────────

  // Segundo passo do login: mfaToken (5 min) + código TOTP → sessão completa
  app.post(
    "/mfa/verify",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: mfaVerifySchema, response: { 200: authResponseSchema } },
    },
    async (req, reply) => {
      let payload: { sub: string; tid: string; purpose?: string };
      try {
        payload = app.jwt.verify<{ sub: string; tid: string; purpose?: string }>(req.body.mfaToken);
      } catch {
        throw unauthorized("Sessão MFA expirada — inicie sessão de novo");
      }
      if (payload.purpose !== "mfa") throw unauthorized();
      const [user] = await app.db.select().from(users).where(eq(users.id, payload.sub));
      if (!user || user.status !== "active" || !user.totpEnabledAt || !user.totpSecret) {
        throw unauthorized();
      }
      if (!verifyTotp(decryptSecret(user.totpSecret), req.body.code)) {
        throw unauthorized("Código inválido");
      }

      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(app.db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.login",
        entity: "user",
        entityId: user.id,
        metadata: { mfa: true },
        ip: req.ip,
      });
      const isPlatformAdmin = await syncPlatformAdmin(app.db, user);
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId));
      await createSession(app.db, reply, user, req);
      return {
        accessToken: signAccessToken(app, user),
        user: toUserDto(user, isPlatformAdmin),
        tenant: toTenantDto(tenant),
      };
    },
  );

  // Enroll: gera segredo TOTP (ainda não ativo) + URI para QR
  app.post(
    "/mfa/setup",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: z.object({ secret: z.string(), otpauth: z.string() }) } },
    },
    async (req) => {
      const [user] = await app.db.select().from(users).where(eq(users.id, req.user.sub));
      if (!user) throw unauthorized();
      if (isProtectedDemoUser(user.email)) {
        throw forbidden("Modo demonstração — MFA não pode ser ativado nesta conta");
      }
      if (user.totpEnabledAt) throw badRequest("MFA já está ativo — desative primeiro");
      const secret = generateTotpSecret();
      await app.db
        .update(users)
        .set({ totpSecret: encryptSecret(secret), updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return { secret, otpauth: otpauthUri(secret, user.email) };
    },
  );

  // Ativa o MFA confirmando um código gerado com o segredo pendente
  app.post(
    "/mfa/enable",
    { preHandler: app.authenticate, schema: { body: mfaEnableSchema } },
    async (req) => {
      const [user] = await app.db.select().from(users).where(eq(users.id, req.user.sub));
      if (!user) throw unauthorized();
      if (isProtectedDemoUser(user.email)) {
        throw forbidden("Modo demonstração — MFA não pode ser ativado nesta conta");
      }
      if (!user.totpSecret) throw badRequest("Gere primeiro o segredo em /mfa/setup");
      if (user.totpEnabledAt) throw badRequest("MFA já está ativo");
      if (!verifyTotp(decryptSecret(user.totpSecret), req.body.code)) {
        throw badRequest("Código inválido");
      }
      await app.db
        .update(users)
        .set({ totpEnabledAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await audit(app.db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.mfa_enabled",
        entity: "user",
        entityId: user.id,
        ip: req.ip,
      });
      return { ok: true };
    },
  );

  // Desativa MFA com um código atual; revoga as outras sessões
  app.post(
    "/mfa/disable",
    { preHandler: app.authenticate, schema: { body: mfaDisableSchema } },
    async (req) => {
      const [user] = await app.db.select().from(users).where(eq(users.id, req.user.sub));
      if (!user) throw unauthorized();
      if (!user.totpEnabledAt || !user.totpSecret) throw badRequest("MFA não está ativo");
      if (!verifyTotp(decryptSecret(user.totpSecret), req.body.code)) {
        throw badRequest("Código inválido");
      }
      await app.db
        .update(users)
        .set({ totpSecret: null, totpEnabledAt: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await app.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
      await audit(app.db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.mfa_disabled",
        entity: "user",
        entityId: user.id,
        ip: req.ip,
      });
      return { ok: true };
    },
  );

  // ── SSO / OIDC ────────────────────────────────────────────────────────────
  // Fluxo: lookup (domínio do email) → start (redirect IdP com state+nonce) →
  // callback (troca code, obtém email, cria sessão → redirect para o SPA).

  app.post(
    "/sso/lookup",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: ssoLookupSchema, response: { 200: ssoLookupResponseSchema } },
    },
    async (req) => {
      const domain = req.body.email.split("@")[1]?.toLowerCase();
      if (!domain) return { sso: false as const };
      const [provider] = await app.db
        .select()
        .from(ssoProviders)
        .where(and(eq(ssoProviders.domain, domain), eq(ssoProviders.enabled, true)));
      if (!provider) return { sso: false as const };
      return {
        sso: true as const,
        providerId: provider.id,
        providerName: provider.name,
        startUrl: `${apiBaseUrl(req)}/api/auth/sso/${provider.id}/start`,
      };
    },
  );

  // Redireciona o browser para o IdP (authorization endpoint)
  app.get(
    "/sso/:providerId/start",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { params: z.object({ providerId: z.string().uuid() }) },
    },
    async (req, reply) => {
      const [provider] = await app.db
        .select()
        .from(ssoProviders)
        .where(and(eq(ssoProviders.id, req.params.providerId), eq(ssoProviders.enabled, true)));
      if (!provider) return reply.redirect(`${env.WEB_BASE_URL}/login?sso_error=provider`);
      const state = generateToken();
      const nonce = generateToken();
      await app.db.insert(ssoStates).values({
        state,
        tenantId: provider.tenantId,
        providerId: provider.id,
        nonce,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: provider.clientId,
        redirect_uri: redirectUri(req),
        scope: "openid email profile",
        state,
        nonce,
      });
      return reply.redirect(`${provider.authorizeUrl}${provider.authorizeUrl.includes("?") ? "&" : "?"}${params}`);
    },
  );

  const ssoError = (reply: import("fastify").FastifyReply, code: string) =>
    reply.redirect(`${env.WEB_BASE_URL}/login?sso_error=${code}`);

  // Callback do IdP: troca o código, obtém o email e cria a sessão
  app.get(
    "/sso/callback",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { querystring: z.object({ code: z.string().min(1), state: z.string().min(1) }) },
    },
    async (req, reply) => {
      const { code, state } = req.query;
      const [row] = await app.db.select().from(ssoStates).where(eq(ssoStates.state, state));
      if (row) await app.db.delete(ssoStates).where(eq(ssoStates.state, state));
      if (!row || row.expiresAt < new Date()) return ssoError(reply, "state");

      const [provider] = await app.db.select().from(ssoProviders).where(eq(ssoProviders.id, row.providerId));
      if (!provider || !provider.enabled) return ssoError(reply, "provider");

      // Troca code → tokens
      let email: string | undefined;
      let name: string | undefined;
      let nonceOk = true;
      try {
        const res = await fetch(provider.tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri(req),
            client_id: provider.clientId,
            client_secret: decryptSecret(provider.clientSecretEnc),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return ssoError(reply, "token");
        const tokens = (await res.json()) as {
          access_token?: string;
          id_token?: string;
        };
        // Claims do id_token (sem verificar assinatura — a confiança vem do
        // token endpoint TLS); o nonce é verificado quando presente.
        if (tokens.id_token) {
          const payload = JSON.parse(
            Buffer.from(tokens.id_token.split(".")[1] ?? "", "base64url").toString("utf8"),
          ) as { email?: string; name?: string; nonce?: string };
          email = payload.email;
          name = payload.name;
          if (payload.nonce && payload.nonce !== row.nonce) nonceOk = false;
        }
        if (!nonceOk) return ssoError(reply, "nonce");
        // userinfo complementa/confirma quando configurado
        if (provider.userinfoUrl && tokens.access_token) {
          const ui = await fetch(provider.userinfoUrl, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
            signal: AbortSignal.timeout(10_000),
          });
          if (ui.ok) {
            const info = (await ui.json()) as { email?: string; name?: string };
            email = info.email ?? email;
            name = info.name ?? name;
          }
        }
      } catch {
        return ssoError(reply, "network");
      }
      if (!email) return ssoError(reply, "email");
      email = email.toLowerCase();

      const domain = email.split("@")[1];
      if (!domain || domain !== provider.domain) return ssoError(reply, "domain");

      let [user] = await app.db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.tenantId, provider.tenantId)));
      if (!user) {
        if (!provider.autoProvision) return ssoError(reply, "not_provisioned");
        [user] = await app.db
          .insert(users)
          .values({
            tenantId: provider.tenantId,
            email,
            name: name?.slice(0, 120) || email.split("@")[0],
            passwordHash: hashPassword(generateToken()),
            role: provider.defaultRole,
            status: "active",
            lastLoginAt: new Date(),
          })
          .returning();
        await audit(app.db, {
          tenantId: provider.tenantId,
          actorId: user.id,
          action: "users.sso_provisioned",
          entity: "user",
          entityId: user.id,
          metadata: { providerId: provider.id },
          ip: req.ip,
        });
      }
      if (user.status === "suspended") return ssoError(reply, "suspended");
      if (user.status === "invited") return ssoError(reply, "invited");

      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(app.db, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: "auth.sso_login",
        entity: "user",
        entityId: user.id,
        metadata: { providerId: provider.id },
        ip: req.ip,
      });

      // MFA continua a aplicar-se: redireciona para o passo TOTP do login
      if (user.totpEnabledAt && user.totpSecret) {
        const mfaToken = app.jwt.sign(
          { sub: user.id, tid: user.tenantId, role: user.role, name: user.name, email: user.email, purpose: "mfa" },
          { expiresIn: "5m" },
        );
        return reply.redirect(`${env.WEB_BASE_URL}/login?mfa=${encodeURIComponent(mfaToken)}`);
      }

      await createSession(app.db, reply, user, req);
      const accessToken = signAccessToken(app, user);
      return reply.redirect(`${env.WEB_BASE_URL}/sso/callback#access_token=${encodeURIComponent(accessToken)}`);
    },
  );
};
