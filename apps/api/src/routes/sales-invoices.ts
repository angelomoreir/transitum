import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listSalesInvoicesQuerySchema,
  SALES_INVOICE_TRANSITIONS,
  salesInvoiceCreateSchema,
  salesInvoiceDtoSchema,
  salesInvoiceStatusUpdateSchema,
  type SalesInvoiceStatus,
} from "@transitum/shared";
import { z } from "zod";
import {
  atSettings,
  orderLines,
  orders,
  partners,
  salesInvoiceLines,
  salesInvoices,
  tenants,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import {
  buildAtQr,
  FINAL_CONSUMER_NIF,
  hashChars,
  signDocument,
  validateInvoice,
  type AtInvoice,
} from "../lib/at.js";
import { badRequest, notFound } from "../lib/errors.js";
import { decryptSecret } from "../lib/secrets.js";
import { salesInvoicePdf } from "../lib/pdf.js";
import { nextNumber } from "../lib/sequences.js";
import { env } from "../env.js";

const listResponse = z.object({
  items: z.array(salesInvoiceDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  draft: "Rascunho",
  issued: "Emitida",
  paid: "Paga",
  void: "Anulada",
};

type InvoiceRow = typeof salesInvoices.$inferSelect;
type LineRow = typeof salesInvoiceLines.$inferSelect;

const lineDto = (l: LineRow) => ({
  id: l.id,
  lineNo: l.lineNo,
  description: l.description,
  quantity: l.quantity,
  unitPrice: l.unitPrice,
  taxRate: l.taxRate,
  taxAmount: l.taxAmount,
  lineTotal: l.lineTotal,
});

const toDto = (
  inv: InvoiceRow,
  customerName: string | null,
  orderNumber: string | null,
  lines: LineRow[] = [],
) => ({
  id: inv.id,
  number: inv.number,
  customerId: inv.customerId,
  customerName: customerName ?? "",
  orderId: inv.orderId ?? null,
  orderNumber,
  status: inv.status,
  issueDate: inv.issueDate,
  dueDate: inv.dueDate ?? null,
  subtotal: inv.subtotal,
  taxTotal: inv.taxTotal,
  total: inv.total,
  notes: inv.notes ?? null,
  series: inv.series ?? null,
  seq: inv.seq ?? null,
  atcud: inv.atcud ?? null,
  hashControl: inv.hash ? hashChars(inv.hash) : null,
  atStatus: (inv.atStatus as never) ?? null,
  atMessage: inv.atMessage ?? null,
  createdAt: inv.createdAt.toISOString(),
  lines: lines.length ? lines.map(lineDto) : undefined,
});

type LineInput = { description: string; quantity: number; unitPrice: number; taxRate: number };

const cents = (v: number) => Math.round(v * 100) / 100;

/** Totais da fatura: base tributável, IVA e total com IVA. */
const totals = (lines: LineInput[]) => {
  const subtotal = cents(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const taxTotal = cents(
    lines.reduce((s, l) => s + (l.quantity * l.unitPrice * l.taxRate) / 100, 0),
  );
  return { subtotal, taxTotal, total: cents(subtotal + taxTotal) };
};

/**
 * Faturação ao cliente — documentos comerciais com linhas, numeração FT-XXXXX
 * e ciclo de vida rascunho → emitida → paga (ou anulada).
 */
export const salesInvoiceRoutes: FastifyPluginAsyncZod = async (app) => {
  const loadDetail = async (tid: string, id: string) => {
    const [row] = await app.db
      .select({ inv: salesInvoices, customerName: partners.name, orderNumber: orders.number })
      .from(salesInvoices)
      .innerJoin(partners, eq(salesInvoices.customerId, partners.id))
      .leftJoin(orders, eq(salesInvoices.orderId, orders.id))
      .where(and(eq(salesInvoices.id, id), eq(salesInvoices.tenantId, tid)));
    if (!row) throw notFound("Fatura não encontrada");
    const lines = await app.db
      .select()
      .from(salesInvoiceLines)
      .where(eq(salesInvoiceLines.invoiceId, id))
      .orderBy(salesInvoiceLines.lineNo);
    return toDto(row.inv, row.customerName, row.orderNumber, lines);
  };

  app.get(
    "/",
    {
      preHandler: app.requirePermission("billing:read"),
      schema: { querystring: listSalesInvoicesQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, customerId, status } = req.query;
      const conditions = [eq(salesInvoices.tenantId, req.user.tid)];
      if (customerId) conditions.push(eq(salesInvoices.customerId, customerId));
      if (status) conditions.push(eq(salesInvoices.status, status));
      const where = and(...conditions);

      const [rows, [{ count }]] = await Promise.all([
        app.db
          .select({ inv: salesInvoices, customerName: partners.name, orderNumber: orders.number })
          .from(salesInvoices)
          .innerJoin(partners, eq(salesInvoices.customerId, partners.id))
          .leftJoin(orders, eq(salesInvoices.orderId, orders.id))
          .where(where)
          .orderBy(desc(salesInvoices.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(salesInvoices).where(where),
      ]);
      return {
        items: rows.map((r) => toDto(r.inv, r.customerName, r.orderNumber)),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("billing:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ invoice: salesInvoiceDtoSchema }) },
      },
    },
    async (req) => ({ invoice: await loadDetail(req.user.tid, req.params.id) }),
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("billing:write"),
      schema: {
        body: salesInvoiceCreateSchema,
        response: { 201: z.object({ invoice: salesInvoiceDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const [customer] = await app.db
        .select()
        .from(partners)
        .where(
          and(
            eq(partners.id, body.customerId),
            eq(partners.tenantId, req.user.tid),
            eq(partners.active, true),
          ),
        );
      if (!customer || !customer.types.includes("customer")) {
        throw badRequest("Cliente não encontrado");
      }

      // Com encomenda de origem sem linhas explícitas → copia as linhas com preço
      let order: typeof orders.$inferSelect | null = null;
      let lines: LineInput[] = [];
      if (body.orderId) {
        const [o] = await app.db
          .select()
          .from(orders)
          .where(and(eq(orders.id, body.orderId), eq(orders.tenantId, req.user.tid)));
        if (!o) throw badRequest("Encomenda não encontrada");
        order = o;
        if (!body.lines?.length) {
          const ols = await app.db
            .select()
            .from(orderLines)
            .where(eq(orderLines.orderId, o.id))
            .orderBy(orderLines.lineNo);
          lines = ols
            .filter((l) => l.unitPrice != null)
            .map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice!,
              taxRate: 23,
            }));
        }
      }
      if (body.lines?.length) lines = body.lines;
      if (!lines.length) {
        throw badRequest("A fatura precisa de linhas (a encomenda não tem linhas com preço)");
      }

      const { subtotal, taxTotal, total } = totals(lines);
      const number = await nextNumber(app.db, req.user.tid, "sales_invoice");
      const seq = Number(number.split("-").pop()) || 0;
      const today = new Date().toISOString().slice(0, 10);

      const [inv] = await app.db
        .insert(salesInvoices)
        .values({
          tenantId: req.user.tid,
          number,
          series: "FT",
          seq,
          customerId: customer.id,
          orderId: order?.id ?? null,
          issueDate: today,
          dueDate: body.dueDate ?? null,
          subtotal,
          taxTotal,
          total,
          notes: body.notes ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      const inserted = await app.db
        .insert(salesInvoiceLines)
        .values(
          lines.map((l, i) => ({
            tenantId: req.user.tid,
            invoiceId: inv.id,
            lineNo: i + 1,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            taxAmount: cents((l.quantity * l.unitPrice * l.taxRate) / 100),
            lineTotal: cents(l.quantity * l.unitPrice),
          })),
        )
        .returning();

      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "sales_invoices.created",
        entity: "sales_invoice",
        entityId: inv.id,
        metadata: { number, total, customerId: customer.id },
        ip: req.ip,
      });
      return reply
        .code(201)
        .send({ invoice: toDto(inv, customer.name, order?.number ?? null, inserted) });
    },
  );

  app.post(
    "/:id/status",
    {
      preHandler: app.requirePermission("billing:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: salesInvoiceStatusUpdateSchema,
        response: { 200: z.object({ invoice: salesInvoiceDtoSchema }) },
      },
    },
    async (req) => {
      const [inv] = await app.db
        .select()
        .from(salesInvoices)
        .where(and(eq(salesInvoices.id, req.params.id), eq(salesInvoices.tenantId, req.user.tid)));
      if (!inv) throw notFound("Fatura não encontrada");
      const next = req.body.status;
      const allowed = SALES_INVOICE_TRANSITIONS[inv.status as SalesInvoiceStatus] ?? [];
      if (!allowed.includes(next)) {
        throw badRequest(
          `Transição inválida: ${STATUS_LABELS[inv.status as SalesInvoiceStatus]} → ${STATUS_LABELS[next]}`,
        );
      }
      // Na emissão: ATCUD, assinatura encadeada e comunicação à AT
      const fiscal =
        next === "issued" ? await fiscalize(app, req.user.tid, inv) : {};
      await app.db
        .update(salesInvoices)
        .set({ status: next, ...fiscal, updatedAt: new Date() })
        .where(eq(salesInvoices.id, inv.id));
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "sales_invoices.status_changed",
        entity: "sales_invoice",
        entityId: inv.id,
        metadata: { from: inv.status, to: next, number: inv.number },
        ip: req.ip,
      });
      return { invoice: await loadDetail(req.user.tid, inv.id) };
    },
  );

  // PDF da fatura (A4, com QR + assinatura quando fiscalizada)
  app.get(
    "/:id/pdf",
    {
      preHandler: app.requirePermission("billing:read"),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const [row] = await app.db
        .select({ inv: salesInvoices, customer: partners, tenant: tenants })
        .from(salesInvoices)
        .innerJoin(partners, eq(salesInvoices.customerId, partners.id))
        .innerJoin(tenants, eq(salesInvoices.tenantId, tenants.id))
        .where(and(eq(salesInvoices.id, req.params.id), eq(salesInvoices.tenantId, req.user.tid)));
      if (!row) throw notFound("Fatura não encontrada");
      const lines = await app.db
        .select()
        .from(salesInvoiceLines)
        .where(eq(salesInvoiceLines.invoiceId, row.inv.id))
        .orderBy(salesInvoiceLines.lineNo);
      const [order] = row.inv.orderId
        ? await app.db.select().from(orders).where(eq(orders.id, row.inv.orderId))
        : [];
      const pdf = await salesInvoicePdf({
        issuer: {
          name: row.tenant.name,
          taxId: row.tenant.taxId ?? null,
          line1: row.tenant.addressLine1 ?? null,
          city: row.tenant.city ?? null,
          postalCode: row.tenant.postalCode ?? null,
          country: row.tenant.country ?? null,
        },
        customer: {
          name: row.customer.name,
          taxId: row.customer.taxId ?? null,
          line1: row.customer.addressLine1 ?? null,
          city: row.customer.city ?? null,
          postalCode: row.customer.postalCode ?? null,
          country: row.customer.country ?? null,
        },
        invoice: {
          number: row.inv.number,
          issueDate: row.inv.issueDate,
          dueDate: row.inv.dueDate ?? null,
          orderNumber: order?.number ?? null,
          subtotal: row.inv.subtotal,
          taxTotal: row.inv.taxTotal,
          total: row.inv.total,
          notes: row.inv.notes ?? null,
        },
        lines,
        fiscal: {
          atcud: row.inv.atcud ?? null,
          hashChars: hashChars(row.inv.hash),
          signed: !!row.inv.hash,
          qr: row.inv.atcud
            ? buildAtQr({
                issuerTaxId: row.tenant.taxId ?? "",
                customerTaxId: row.customer.taxId ?? FINAL_CONSUMER_NIF,
                customerCountry: row.customer.country ?? "PT",
                docType: "FT",
                date: row.inv.issueDate,
                documentNumber: row.inv.number,
                atcud: row.inv.atcud,
                hash: row.inv.hash,
                taxableBase: row.inv.subtotal.toFixed(2),
                taxAmount: row.inv.taxTotal.toFixed(2),
                grossTotal: row.inv.total.toFixed(2),
              })
            : null,
          softwareCert: env.AT_SOFTWARE_CERT_NUMBER,
          atStatus: row.inv.atStatus ?? null,
        },
      });
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="fatura-${row.inv.number}.pdf"`)
        .send(pdf);
    },
  );
};

/**
 * Fiscalização na emissão: ATCUD da série (código de validação das definições
 * AT), assinatura encadeada RSA-SHA1 com o total bruto e comunicação à AT
 * (webservice de faturas) quando as credenciais estão ativas.
 */
async function fiscalize(
  app: FastifyInstance,
  tid: string,
  inv: InvoiceRow,
) {
  const [settings, tenant, customer, lines, prev] = await Promise.all([
    app.db.select().from(atSettings).where(eq(atSettings.tenantId, tid)).then((r) => r[0]),
    app.db.select().from(tenants).where(eq(tenants.id, tid)).then((r) => r[0]),
    app.db.select().from(partners).where(eq(partners.id, inv.customerId)).then((r) => r[0]),
    app.db
      .select()
      .from(salesInvoiceLines)
      .where(eq(salesInvoiceLines.invoiceId, inv.id))
      .orderBy(salesInvoiceLines.lineNo),
    app.db
      .select({ hash: salesInvoices.hash })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.tenantId, tid),
          eq(salesInvoices.series, inv.series),
          ne(salesInvoices.id, inv.id),
          isNotNull(salesInvoices.hash),
        ),
      )
      .orderBy(desc(salesInvoices.seq))
      .limit(1)
      .then((r) => r[0]),
  ]);
  const seq = inv.seq ?? 0;
  const atcud = `${settings?.seriesValidationCode ?? "0"}-${seq}`;
  const sig = signDocument({
    movementDate: inv.issueDate,
    systemEntryDate: new Date(),
    documentNumber: inv.number,
    previousHash: prev?.hash ?? null,
    grossTotal: inv.total.toFixed(2),
  });

  let atStatus: string = sig ? "signed" : "unsigned";
  let atMessage: string | null = null;
  if (settings?.enabled && tenant && customer) {
    if (!settings.username || !settings.passwordEnc) {
      atStatus = "failed";
      atMessage = "Credenciais da AT em falta";
    } else {
      const doc: AtInvoice = {
        taxId: tenant.taxId ?? "",
        companyName: tenant.name,
        companyAddress: {
          detail: tenant.addressLine1 ?? "",
          city: tenant.city ?? "",
          postalCode: tenant.postalCode ?? "",
          country: tenant.country ?? "PT",
        },
        documentNumber: inv.number,
        atcud,
        invoiceDate: inv.issueDate,
        customerTaxId: customer.taxId ?? FINAL_CONSUMER_NIF,
        customerName: customer.name,
        customerAddress: {
          detail: customer.addressLine1 ?? "",
          city: customer.city ?? "",
          postalCode: customer.postalCode ?? "",
          country: customer.country ?? "PT",
        },
        customerCountry: customer.country ?? "PT",
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
        })),
        taxPayable: inv.taxTotal,
        netTotal: inv.subtotal,
        grossTotal: inv.total,
      };
      const errors = validateInvoice(doc);
      if (errors.length) {
        atStatus = "failed";
        atMessage = errors.join("; ").slice(0, 480);
      } else {
        const res = await app.atClient.communicateInvoice(
          (settings.environment as "test" | "production") ?? "test",
          { username: settings.username, password: decryptSecret(settings.passwordEnc) },
          doc,
        );
        atStatus = res.ok ? "communicated" : "failed";
        atMessage = res.ok ? res.message : `${res.code}: ${res.message}`.slice(0, 480);
      }
    }
  }
  return {
    atcud,
    hash: sig?.hash ?? null,
    hashControl: sig?.hashControl ?? null,
    atStatus,
    atMessage,
  };
}
