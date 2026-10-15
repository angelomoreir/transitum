import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { tenantDtoSchema, updateTenantSchema } from "@blujay/shared";
import { z } from "zod";
import { tenants } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";
import { toTenantDto } from "../lib/session.js";

export const tenantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: app.requirePermission("tenant:read"),
      schema: { response: { 200: z.object({ tenant: tenantDtoSchema }) } },
    },
    async (req) => {
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, req.user.tid));
      if (!tenant) throw notFound();
      return { tenant: toTenantDto(tenant) };
    },
  );

  app.patch(
    "/",
    {
      preHandler: app.requirePermission("tenant:update"),
      schema: {
        body: updateTenantSchema,
        response: { 200: z.object({ tenant: tenantDtoSchema }) },
      },
    },
    async (req) => {
      const [tenant] = await app.db
        .update(tenants)
        .set({ name: req.body.name, updatedAt: new Date() })
        .where(eq(tenants.id, req.user.tid))
        .returning();
      if (!tenant) throw notFound();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "tenant.updated",
        entity: "tenant",
        entityId: tenant.id,
        metadata: req.body,
        ip: req.ip,
      });
      return { tenant: toTenantDto(tenant) };
    },
  );
};
