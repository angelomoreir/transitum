import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import {
  fiscalSettingsDtoSchema,
  fiscalSettingsUpdateSchema,
  tenantDtoSchema,
  updateTenantSchema,
} from "@transitum/shared";
import { z } from "zod";
import { atSettings, tenants } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";
import { toTenantDto } from "../lib/session.js";
import { signingConfigured } from "../lib/at.js";
import { encryptSecret } from "../lib/secrets.js";

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

  // ── Dados fiscais do emitente + configuração AT ──────────────────────────

  const fiscalDto = async (tid: string) => {
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, tid));
    const [at] = await app.db.select().from(atSettings).where(eq(atSettings.tenantId, tid));
    return {
      taxId: tenant?.taxId ?? null,
      addressLine1: tenant?.addressLine1 ?? null,
      city: tenant?.city ?? null,
      postalCode: tenant?.postalCode ?? null,
      country: tenant?.country ?? null,
      at: {
        enabled: at?.enabled ?? false,
        environment: (at?.environment ?? "test") as "test" | "production",
        username: at?.username ?? null,
        hasPassword: !!at?.passwordEnc,
        docType: (at?.docType ?? "GT") as "GT" | "GR",
        series: at?.series ?? "A",
        seriesValidationCode: at?.seriesValidationCode ?? null,
      },
      atClientMode: app.atClient.mode,
      signingConfigured: signingConfigured(),
    };
  };

  app.get(
    "/fiscal",
    {
      preHandler: app.requirePermission("tenant:read"),
      schema: { response: { 200: z.object({ fiscal: fiscalSettingsDtoSchema }) } },
    },
    async (req) => ({ fiscal: await fiscalDto(req.user.tid) }),
  );

  app.patch(
    "/fiscal",
    {
      preHandler: app.requirePermission("tenant:update"),
      schema: {
        body: fiscalSettingsUpdateSchema,
        response: { 200: z.object({ fiscal: fiscalSettingsDtoSchema }) },
      },
    },
    async (req) => {
      const b = req.body;
      if (b.taxId !== undefined || b.addressLine1 !== undefined || b.city !== undefined || b.postalCode !== undefined || b.country !== undefined) {
        await app.db
          .update(tenants)
          .set({
            taxId: b.taxId,
            addressLine1: b.addressLine1,
            city: b.city,
            postalCode: b.postalCode,
            country: b.country,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, req.user.tid));
      }
      if (b.at) {
        const [existing] = await app.db.select().from(atSettings).where(eq(atSettings.tenantId, req.user.tid));
        const values = {
          enabled: b.at.enabled,
          environment: b.at.environment,
          username: b.at.username ?? null,
          docType: b.at.docType,
          series: b.at.series,
          seriesValidationCode: b.at.seriesValidationCode ?? null,
          ...(b.at.password ? { passwordEnc: encryptSecret(b.at.password) } : {}),
          updatedAt: new Date(),
        };
        if (existing) {
          await app.db.update(atSettings).set(values).where(eq(atSettings.tenantId, req.user.tid));
        } else {
          await app.db.insert(atSettings).values({ tenantId: req.user.tid, ...values });
        }
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "tenant.fiscal_updated",
        entity: "tenant",
        entityId: req.user.tid,
        metadata: { atEnabled: b.at?.enabled },
        ip: req.ip,
      });
      return { fiscal: await fiscalDto(req.user.tid) };
    },
  );
};
