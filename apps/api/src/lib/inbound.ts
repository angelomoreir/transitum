import { and, eq, ilike, inArray } from "drizzle-orm";
import type { InboundOrderInput } from "@transitum/shared";
import { items, orderLines, orders, partners, warehouses } from "../db/schema.js";
import type { DB } from "../db/client.js";
import { badRequest } from "./errors.js";
import { nextNumber } from "./sequences.js";

/**
 * Cria uma encomenda a partir de dados de um sistema externo (EDI/e-commerce).
 * Partilhado entre `POST /api/v1/inbound-orders` e os canais de webhook
 * (`/api/inbound/:token`). Idempotência por `externalRef` é garantida pelo
 * índice único e verificada pelo chamador antes de invocar.
 */
export async function createInboundOrder(
  db: DB,
  tenantId: string,
  body: InboundOrderInput,
  createdBy?: string | null,
) {
  // Cliente: por NIF, depois por nome; cria se não existir
  let [customer] = body.customer.taxId
    ? await db
        .select()
        .from(partners)
        .where(and(eq(partners.tenantId, tenantId), eq(partners.taxId, body.customer.taxId)))
    : [];
  if (!customer) {
    [customer] = await db
      .select()
      .from(partners)
      .where(and(eq(partners.tenantId, tenantId), ilike(partners.name, body.customer.name)));
  }
  if (!customer) {
    [customer] = await db
      .insert(partners)
      .values({
        tenantId,
        code: await nextNumber(db, tenantId, "customer"),
        types: ["customer"],
        name: body.customer.name,
        taxId: body.customer.taxId ?? null,
        email: body.customer.email ?? null,
        phone: body.customer.phone ?? null,
      })
      .returning();
  }

  // Armazém: pelo código ou o primeiro ativo
  let warehouseId: string | null = null;
  if (body.warehouseCode) {
    const [wh] = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.tenantId, tenantId),
          eq(warehouses.code, body.warehouseCode),
          eq(warehouses.active, true),
        ),
      );
    if (!wh) throw badRequest("Armazém não encontrado pelo código indicado");
    warehouseId = wh.id;
  } else {
    const [wh] = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.active, true)))
      .limit(1);
    warehouseId = wh?.id ?? null;
  }

  // Artigos por SKU (SKU desconhecido → linha de texto com o SKU)
  const skus = [...new Set(body.lines.map((l) => l.sku).filter((v): v is string => !!v))];
  const itemRows = skus.length
    ? await db.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.sku, skus)))
    : [];
  const itemBySku = new Map(itemRows.map((i) => [i.sku, i]));

  const [order] = await db
    .insert(orders)
    .values({
      tenantId,
      number: await nextNumber(db, tenantId, "order"),
      customerId: customer.id,
      warehouseId,
      requestedDate: body.requestedDate || null,
      notes: body.notes ?? null,
      deliveryLine1: body.deliveryLine1 ?? null,
      deliveryCity: body.deliveryCity ?? null,
      deliveryPostalCode: body.deliveryPostalCode ?? null,
      deliveryCountry: body.deliveryCountry ?? null,
      externalRef: body.externalRef,
      createdBy: createdBy ?? null,
    })
    .returning();
  await db.insert(orderLines).values(
    body.lines.map((l, i) => {
      const item = l.sku ? itemBySku.get(l.sku) : undefined;
      return {
        tenantId,
        orderId: order.id,
        lineNo: i + 1,
        itemId: item?.id ?? null,
        description: l.description ?? (item ? item.name : l.sku ? `[${l.sku}]` : ""),
        quantity: l.quantity,
        weightKg: item?.weightKg != null ? item.weightKg * l.quantity : null,
        unitPrice: l.unitPrice ?? null,
      };
    }),
  );
  return order;
}

// ── Mapeadores de payloads externos ────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const personName = (o: any, fallback?: string) =>
  [str(o?.first_name), str(o?.last_name)].filter(Boolean).join(" ") ||
  str(o?.name) ||
  str(o?.company) ||
  fallback;

/**
 * Shopify `orders/create` webhook → inbound order.
 * https://shopify.dev/docs/api/webhooks — campos principais do recurso Order.
 */
export function mapShopifyOrder(body: any): InboundOrderInput {
  const ship = body?.shipping_address ?? body?.billing_address ?? {};
  const bill = body?.billing_address ?? {};
  const customerName =
    str(ship.company) ||
    personName(ship) ||
    personName(bill) ||
    personName(body?.customer) ||
    "Cliente Shopify";
  const lines = Array.isArray(body?.line_items) ? body.line_items : [];
  if (!lines.length) throw badRequest("Webhook Shopify sem line_items");
  return {
    externalRef: `shopify:${str(body?.name) ?? str(body?.order_number) ?? str(body?.id) ?? "sem-ref"}`,
    customer: {
      name: customerName,
      taxId: undefined,
      email: str(body?.email) ?? str(body?.customer?.email),
      phone: str(ship.phone) ?? str(bill.phone),
    },
    requestedDate: str(body?.expected_shipping_date),
    notes: str(body?.note) ?? str(body?.tags) ?? undefined,
    deliveryLine1: [str(ship.address1), str(ship.address2)].filter(Boolean).join(", ") || undefined,
    deliveryCity: str(ship.city),
    deliveryPostalCode: str(ship.zip),
    deliveryCountry: str(ship.country_code),
    lines: lines.map((l: any) => ({
      sku: str(l?.sku),
      description: str(l?.name),
      quantity: num(l?.quantity) ?? 1,
      unitPrice: num(l?.price),
    })),
  };
}

/**
 * WooCommerce `order.created` webhook → inbound order.
 */
export function mapWooCommerceOrder(body: any): InboundOrderInput {
  const ship = body?.shipping ?? {};
  const bill = body?.billing ?? {};
  const customerName =
    str(ship.company) || personName(ship) || str(bill.company) || personName(bill) || "Cliente WooCommerce";
  const lines = Array.isArray(body?.line_items) ? body.line_items : [];
  if (!lines.length) throw badRequest("Webhook WooCommerce sem line_items");
  const qty = (l: any) => {
    const q = num(l?.quantity);
    return q != null ? Math.max(1, Math.round(q)) : 1;
  };
  return {
    externalRef: `woocommerce:${str(body?.number) ?? str(body?.id) ?? "sem-ref"}`,
    customer: {
      name: customerName,
      taxId: undefined,
      email: str(bill.email),
      phone: str(bill.phone) ?? str(ship.phone),
    },
    requestedDate: str(body?.date_completed)?.slice(0, 10),
    notes: str(body?.customer_note),
    deliveryLine1: [str(ship.address_1), str(ship.address_2)].filter(Boolean).join(", ") || undefined,
    deliveryCity: str(ship.city),
    deliveryPostalCode: str(ship.postcode),
    deliveryCountry: str(ship.country),
    lines: lines.map((l: any) => ({
      sku: str(l?.sku),
      description: str(l?.name),
      quantity: qty(l),
      unitPrice: num(l?.price) ?? (num(l?.total) != null ? num(l!.total)! / qty(l) : undefined),
    })),
  };
}

/**
 * Canal genérico — aceita o payload já no formato `InboundOrderInput`
 * (qualquer middleware/EDI que faça o mapeamento antes de chamar).
 */
export const mapGenericOrder = (body: unknown) => body as InboundOrderInput;

/* eslint-enable @typescript-eslint/no-explicit-any */
