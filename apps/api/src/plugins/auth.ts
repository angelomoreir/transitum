import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { eq } from "drizzle-orm";
import { hasPermission, type Permission, type Role } from "@transitum/shared";
import { tenants } from "../db/schema.js";
import { forbidden, unauthorized } from "../lib/errors.js";

interface JwtUser {
  sub: string;
  tid: string;
  role: Role;
  name: string;
  email: string;
  /** Tokens com propósito especial (ex.: desafio MFA) não são tokens de acesso */
  purpose?: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: Permission,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorate("authenticate", async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    if (req.user.purpose) throw unauthorized();
  });

  app.decorate("requirePermission", (permission: Permission) => {
    return async (req: FastifyRequest) => {
      try {
        await req.jwtVerify();
      } catch {
        throw unauthorized();
      }
      if (req.user.purpose) throw unauthorized();
      if (!hasPermission(req.user.role, permission)) {
        throw forbidden();
      }
      // Tenants suspensos pelo admin da plataforma mantêm leitura, mas não escrita
      if (!isReadPermission(permission)) {
        const [tenant] = await app.db
          .select({ suspendedAt: tenants.suspendedAt })
          .from(tenants)
          .where(eq(tenants.id, req.user.tid));
        if (tenant?.suspendedAt) {
          throw forbidden("Conta suspensa — contacte o suporte da plataforma");
        }
      }
    };
  });
});

const isReadPermission = (p: Permission) => p.endsWith(":read") || p === "search" || p === "stats:read";
