import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  DOC_ENTITY_TYPES,
  documentCreateSchema,
  documentDtoSchema,
  listDocumentsQuerySchema,
} from "@blujay/shared";
import { z } from "zod";
import {
  documents,
  orders,
  partners,
  purchaseOrders,
  routes,
  shipments,
  users,
} from "../db/schema.js";
import type { DB } from "../db/client.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notifyTenant } from "../lib/notify.js";
import type { StorageDriver } from "../lib/storage.js";

type DocRow = typeof documents.$inferSelect;

const docDto = (d: DocRow, uploadedByName: string | null) => ({
  id: d.id,
  entityType: d.entityType,
  entityId: d.entityId,
  fileName: d.fileName,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  uploadedByName,
  createdAt: d.createdAt.toISOString(),
});

/** Valida que a entidade referenciada existe no tenant. */
async function checkEntity(
  db: DB,
  tenantId: string,
  entityType: (typeof DOC_ENTITY_TYPES)[number],
  entityId: string,
) {
  const table = {
    shipment: shipments,
    order: orders,
    purchase_order: purchaseOrders,
    partner: partners,
    route: routes,
  }[entityType];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.tenantId, tenantId)));
  if (!row) throw badRequest("Entidade não encontrada");
}

export function createDocumentRoutes(
  storage: StorageDriver,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/",
      {
        preHandler: app.requirePermission("documents:read"),
        schema: {
          querystring: listDocumentsQuerySchema,
          response: {
            200: z.object({
              items: z.array(documentDtoSchema),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
            }),
          },
        },
      },
      async (req) => {
        const { page, pageSize, entityType, entityId, q } = req.query;
        const conditions = [eq(documents.tenantId, req.user.tid)];
        if (entityType) conditions.push(eq(documents.entityType, entityType));
        if (entityId) conditions.push(eq(documents.entityId, entityId));
        if (q) conditions.push(ilike(documents.fileName, `%${q}%`));
        const where = and(...conditions);

        const [rows, [{ count }]] = await Promise.all([
          app.db
            .select({ doc: documents, userName: users.name })
            .from(documents)
            .leftJoin(users, eq(documents.uploadedBy, users.id))
            .where(where)
            .orderBy(desc(documents.createdAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
          app.db.select({ count: sql`count(*)::int` }).from(documents).where(where),
        ]);
        return {
          items: rows.map((r) => docDto(r.doc, r.userName)),
          total: count as number,
          page,
          pageSize,
        };
      },
    );

    app.post(
      "/",
      {
        // ~7 MB para acomodar 5 MB em base64
        bodyLimit: 8 * 1024 * 1024,
        preHandler: app.requirePermission("documents:write"),
        schema: {
          body: documentCreateSchema,
          response: { 201: z.object({ document: documentDtoSchema }) },
        },
      },
      async (req, reply) => {
        const body = req.body;
        await checkEntity(app.db, req.user.tid, body.entityType, body.entityId);

        const data = Buffer.from(body.contentBase64, "base64");
        const id = crypto.randomUUID();
        const storageKey = `${req.user.tid}/${id}`;
        await storage.put(storageKey, data);

        const [doc] = await app.db
          .insert(documents)
          .values({
            id,
            tenantId: req.user.tid,
            entityType: body.entityType,
            entityId: body.entityId,
            fileName: body.fileName,
            mimeType: body.mimeType,
            sizeBytes: data.length,
            storageKey,
            uploadedBy: req.user.sub,
          })
          .returning();
        await audit(app.db, {
          tenantId: req.user.tid,
          actorId: req.user.sub,
          action: "documents.uploaded",
          entity: "document",
          entityId: doc.id,
          metadata: { fileName: doc.fileName, entityType: doc.entityType },
          ip: req.ip,
        });
        await notifyTenant(app.db, {
          tenantId: req.user.tid,
          trigger: "document.uploaded",
          title: `Documento carregado: ${doc.fileName}`,
          link: "/documents",
        });
        return reply.code(201).send({ document: docDto(doc, req.user.name) });
      },
    );

    app.get(
      "/:id/download",
      {
        preHandler: app.requirePermission("documents:read"),
        schema: { params: z.object({ id: z.string().uuid() }) },
      },
      async (req, reply) => {
        const [doc] = await app.db
          .select()
          .from(documents)
          .where(and(eq(documents.id, req.params.id), eq(documents.tenantId, req.user.tid)));
        if (!doc) throw notFound("Documento não encontrado");
        const data = await storage.get(doc.storageKey);
        return reply
          .header("content-type", doc.mimeType)
          .header(
            "content-disposition",
            `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
          )
          .send(data);
      },
    );

    app.delete(
      "/:id",
      {
        preHandler: app.requirePermission("documents:write"),
        schema: {
          params: z.object({ id: z.string().uuid() }),
          response: { 200: z.object({ ok: z.literal(true) }) },
        },
      },
      async (req) => {
        const [doc] = await app.db
          .select()
          .from(documents)
          .where(and(eq(documents.id, req.params.id), eq(documents.tenantId, req.user.tid)));
        if (!doc) throw notFound("Documento não encontrado");
        await storage.delete(doc.storageKey);
        await app.db.delete(documents).where(eq(documents.id, doc.id));
        return { ok: true as const };
      },
    );
  };
}
