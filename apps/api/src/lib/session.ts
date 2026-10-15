import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { refreshTokens, users, type tenants } from "../db/schema.js";
import { env } from "../env.js";
import { generateToken, hashToken } from "./tokens.js";

export const REFRESH_COOKIE = "blujay_rt";

type UserRow = typeof users.$inferSelect;
type TenantRow = typeof tenants.$inferSelect;

export function signAccessToken(app: FastifyInstance, user: UserRow): string {
  return app.jwt.sign(
    {
      sub: user.id,
      tid: user.tenantId,
      role: user.role,
      name: user.name,
      email: user.email,
    },
    { expiresIn: env.ACCESS_TOKEN_TTL as never },
  );
}

export async function createSession(
  db: DB,
  reply: FastifyReply,
  user: UserRow,
  req: FastifyRequest,
): Promise<string> {
  const token = generateToken();
  await db.insert(refreshTokens).values({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 255) ?? null,
  });
  reply.setCookie(REFRESH_COOKIE, token, {
    path: "/api/auth",
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });
  return token;
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}

export function toUserDto(u: UserRow, isPlatformAdmin = false) {
  return {
    id: u.id,
    tenantId: u.tenantId,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    isPlatformAdmin,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toTenantDto(t: TenantRow) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    createdAt: t.createdAt.toISOString(),
  };
}
