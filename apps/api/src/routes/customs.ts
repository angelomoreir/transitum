import { and, asc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  CUSTOMS_TRANSITIONS,
  customsItemCreateSchema,
  customsItemDtoSchema,
  customsUpdateSchema,
  type CustomsStatus,
} from "@blujay/shared";
import { z } from "zod";
import {
  customsItems,
  partners,
  shipmentEvents,
  shipments,
  tenants,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notifyTenant } from "../lib/notify.js";

const CUSTOMS_LABELS: Record<CustomsStatus, string> = {
  none: "Sem despacho",
  prepared: "Documentação preparada",
  submitted: "Submetido à alfândega",
  cleared: "Desalfandegado",
  held: "Retido na alfândega",
};

const itemDto = (i: typeof customsItems.$inferSelect) => ({
  id: i.id,
  description: i.description,
  hsCode: i.hsCode ?? null,
  originCountry: i.originCountry ?? null,
  quantity: i.quantity,
  weightKg: i.weightKg ?? null,
  value: i.value ?? null,
  currency: i.currency,
});

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export const customsRoutes: FastifyPluginAsyncZod = async (app) => {
  const findShipment = async (id: string, tid: string) => {
    const [s] = await app.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.id, id), eq(shipments.tenantId, tid)));
    return s ?? null;
  };

  // Atualiza incoterm e/ou estado aduaneiro (com validação de transição)
  app.patch(
    "/shipments/:id/customs",
    {
      preHandler: app.requirePermission("trade:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: customsUpdateSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const s = await findShipment(req.params.id, req.user.tid);
      if (!s) throw notFound("Expedição não encontrada");

      const next = req.body.customsStatus;
      if (next && next !== s.customsStatus) {
        const allowed = CUSTOMS_TRANSITIONS[s.customsStatus as CustomsStatus] ?? [];
        if (!allowed.includes(next)) {
          throw badRequest(
            `Transição aduaneira inválida: ${CUSTOMS_LABELS[s.customsStatus as CustomsStatus]} → ${CUSTOMS_LABELS[next]}`,
          );
        }
      }
      await app.db
        .update(shipments)
        .set({
          incoterm: req.body.incoterm === null ? null : (req.body.incoterm ?? undefined),
          customsStatus: next ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, s.id));

      if (next && next !== s.customsStatus) {
        await app.db.insert(shipmentEvents).values({
          tenantId: req.user.tid,
          shipmentId: s.id,
          type: "customs",
          description: req.body.note ?? `Alfândega: ${CUSTOMS_LABELS[next]}`,
          createdBy: req.user.sub,
        });
        if (next === "cleared") {
          await notifyTenant(app.db, {
            tenantId: req.user.tid,
            trigger: "shipment.customs_cleared",
            title: `Expedição ${s.number} desalfandegada`,
            link: `/shipments/${s.id}`,
          });
        }
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "shipments.customs_updated",
        entity: "shipment",
        entityId: s.id,
        metadata: req.body,
        ip: req.ip,
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/shipments/:id/customs-items",
    {
      preHandler: app.requirePermission("trade:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: customsItemCreateSchema,
        response: { 201: z.object({ item: customsItemDtoSchema }) },
      },
    },
    async (req, reply) => {
      const s = await findShipment(req.params.id, req.user.tid);
      if (!s) throw notFound("Expedição não encontrada");
      const [item] = await app.db
        .insert(customsItems)
        .values({
          tenantId: req.user.tid,
          shipmentId: s.id,
          ...req.body,
          hsCode: req.body.hsCode ?? null,
          originCountry: req.body.originCountry ?? null,
          weightKg: req.body.weightKg ?? null,
          value: req.body.value ?? null,
        })
        .returning();
      return reply.code(201).send({ item: itemDto(item) });
    },
  );

  app.delete(
    "/shipments/:id/customs-items/:itemId",
    {
      preHandler: app.requirePermission("trade:write"),
      schema: {
        params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const s = await findShipment(req.params.id, req.user.tid);
      if (!s) throw notFound("Expedição não encontrada");
      const [item] = await app.db
        .select()
        .from(customsItems)
        .where(
          and(
            eq(customsItems.id, req.params.itemId),
            eq(customsItems.shipmentId, s.id),
            eq(customsItems.tenantId, req.user.tid),
          ),
        );
      if (!item) throw notFound("Item não encontrado");
      await app.db.delete(customsItems).where(eq(customsItems.id, item.id));
      return { ok: true as const };
    },
  );

  // Fatura comercial (CSV) — exportação para despacho/transportadora
  app.get(
    "/shipments/:id/commercial-invoice.csv",
    {
      preHandler: app.requirePermission("trade:read"),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const [row] = await app.db
        .select({ s: shipments, customer: partners, tenant: tenants })
        .from(shipments)
        .innerJoin(partners, eq(shipments.customerId, partners.id))
        .innerJoin(tenants, eq(shipments.tenantId, tenants.id))
        .where(and(eq(shipments.id, req.params.id), eq(shipments.tenantId, req.user.tid)));
      if (!row) throw notFound("Expedição não encontrada");

      const items = await app.db
        .select()
        .from(customsItems)
        .where(
          and(eq(customsItems.shipmentId, row.s.id), eq(customsItems.tenantId, req.user.tid)),
        )
        .orderBy(asc(customsItems.createdAt));

      const s = row.s;
      const lines = [
        ["FATURA COMERCIAL", s.number].join(","),
        ["Exportador", csvCell(row.tenant.name)].join(","),
        ["Destinatário", csvCell(row.customer.name)].join(","),
        ["Incoterm", s.incoterm ?? ""].join(","),
        [
          "Origem",
          csvCell(`${s.pickupLine1}, ${s.pickupCity} ${s.pickupPostalCode}, ${s.pickupCountry}`),
        ].join(","),
        [
          "Destino",
          csvCell(`${s.deliveryLine1}, ${s.deliveryCity} ${s.deliveryPostalCode}, ${s.deliveryCountry}`),
        ].join(","),
        "",
        ["Descrição", "HS Code", "País origem", "Qtd", "Peso kg", "Valor", "Moeda"]
          .map(csvCell)
          .join(","),
        ...items.map((i) =>
          [i.description, i.hsCode ?? "", i.originCountry ?? "", i.quantity, i.weightKg ?? "", i.value ?? "", i.currency]
            .map(csvCell)
            .join(","),
        ),
        "",
        ["Total", "", "", items.reduce((a, i) => a + i.quantity, 0),
          items.reduce((a, i) => a + (i.weightKg ?? 0), 0).toFixed(2),
          items.reduce((a, i) => a + (i.value ?? 0), 0).toFixed(2),
          items[0]?.currency ?? "EUR",
        ].map(csvCell).join(","),
      ];
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${s.number}-invoice.csv"`)
        .send(lines.join("\r\n"));
    },
  );
};
