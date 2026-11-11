import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  CARRIER_MODES,
  CARRIER_PROVIDERS,
  carrierConnectionCreateSchema,
  carrierConnectionDtoSchema,
  type CarrierProvider,
} from "@transitum/shared";
import { z } from "zod";
import { carrierConnections, partners } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { createCarrierAdapter, PROVIDER_FIELDS, PROVIDER_LABELS } from "../lib/carriers.js";
import { decryptJson, encryptJson } from "../lib/secrets.js";

const connDto = (c: typeof carrierConnections.$inferSelect, carrierName: string) => ({
  id: c.id,
  carrierId: c.carrierId,
  carrierName,
  provider: c.provider as CarrierProvider,
  mode: c.mode as "sandbox" | "live",
  config: (c.config as Record<string, string>) ?? {},
  credentialKeys: c.credentialsEnc ? Object.keys(decryptJson(c.credentialsEnc)) : [],
  active: c.active,
  createdAt: c.createdAt.toISOString(),
});

/** Ligações tenant → APIs das transportadoras (CTT, DPD, Nacex). */
export const carrierRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/providers",
    {
      preHandler: app.requirePermission("partners:read"),
      schema: {
        response: {
          200: z.object({
            providers: z.array(
              z.object({
                id: z.enum(CARRIER_PROVIDERS),
                label: z.string(),
                credentialFields: z.array(z.string()),
                configFields: z.array(z.string()),
                liveSupported: z.boolean(),
              }),
            ),
            modes: z.array(z.enum(CARRIER_MODES)),
          }),
        },
      },
    },
    async () => ({
      providers: CARRIER_PROVIDERS.map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        credentialFields: PROVIDER_FIELDS[id].credentials,
        configFields: PROVIDER_FIELDS[id].config,
        liveSupported: id === "nacex",
      })),
      modes: [...CARRIER_MODES],
    }),
  );

  app.get(
    "/",
    {
      preHandler: app.requirePermission("partners:read"),
      schema: { response: { 200: z.object({ connections: z.array(carrierConnectionDtoSchema) }) } },
    },
    async (req) => {
      const rows = await app.db
        .select({ conn: carrierConnections, carrierName: partners.name })
        .from(carrierConnections)
        .innerJoin(partners, eq(carrierConnections.carrierId, partners.id))
        .where(eq(carrierConnections.tenantId, req.user.tid));
      return { connections: rows.map((r) => connDto(r.conn, r.carrierName)) };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("partners:write"),
      schema: {
        body: carrierConnectionCreateSchema,
        response: { 201: z.object({ connection: carrierConnectionDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const [carrier] = await app.db
        .select()
        .from(partners)
        .where(and(eq(partners.id, body.carrierId), eq(partners.tenantId, req.user.tid)));
      if (!carrier || !carrier.types.includes("carrier")) {
        throw badRequest("Selecione um parceiro do tipo transportadora");
      }
      // Valida o adaptador antes de persistir (credenciais obrigatórias em live)
      createCarrierAdapter({
        provider: body.provider,
        mode: body.mode,
        credentials: body.credentials,
        config: body.config,
      });
      const [existing] = await app.db
        .select()
        .from(carrierConnections)
        .where(
          and(eq(carrierConnections.tenantId, req.user.tid), eq(carrierConnections.carrierId, body.carrierId)),
        );
      const values = {
        provider: body.provider,
        mode: body.mode,
        credentialsEnc: Object.keys(body.credentials).length ? encryptJson(body.credentials) : null,
        config: body.config,
      };
      const [conn] = existing
        ? await app.db.update(carrierConnections).set(values).where(eq(carrierConnections.id, existing.id)).returning()
        : await app.db
            .insert(carrierConnections)
            .values({ tenantId: req.user.tid, carrierId: body.carrierId, ...values })
            .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "carrier_connections.saved",
        entity: "carrier_connection",
        entityId: conn.id,
        metadata: { carrierId: body.carrierId, provider: body.provider, mode: body.mode },
        ip: req.ip,
      });
      return reply.code(201).send({ connection: connDto(conn, carrier.name) });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("partners:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          active: z.boolean().optional(),
          mode: z.enum(CARRIER_MODES).optional(),
          config: z.record(z.string().max(200)).optional(),
          credentials: z.record(z.string().max(200)).optional(),
        }),
        response: { 200: z.object({ connection: carrierConnectionDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select({ conn: carrierConnections, carrierName: partners.name })
        .from(carrierConnections)
        .innerJoin(partners, eq(carrierConnections.carrierId, partners.id))
        .where(and(eq(carrierConnections.id, req.params.id), eq(carrierConnections.tenantId, req.user.tid)));
      if (!row) throw notFound("Ligação não encontrada");
      const mode = req.body.mode ?? row.conn.mode;
      const credentials = req.body.credentials ?? decryptJson(row.conn.credentialsEnc);
      const config = req.body.config ?? ((row.conn.config as Record<string, string>) ?? {});
      createCarrierAdapter({ provider: row.conn.provider, mode, credentials, config });
      const [conn] = await app.db
        .update(carrierConnections)
        .set({
          active: req.body.active ?? row.conn.active,
          mode,
          config,
          credentialsEnc: req.body.credentials ? encryptJson(credentials) : row.conn.credentialsEnc,
        })
        .where(eq(carrierConnections.id, row.conn.id))
        .returning();
      return { connection: connDto(conn, row.carrierName) };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: app.requirePermission("partners:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const [conn] = await app.db
        .select()
        .from(carrierConnections)
        .where(and(eq(carrierConnections.id, req.params.id), eq(carrierConnections.tenantId, req.user.tid)));
      if (!conn) throw notFound("Ligação não encontrada");
      await app.db.delete(carrierConnections).where(eq(carrierConnections.id, conn.id));
      return { ok: true as const };
    },
  );
};
