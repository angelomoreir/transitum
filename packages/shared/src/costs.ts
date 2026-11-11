import { z } from "zod";

export const COST_TYPES = ["freight", "fuel", "tolls", "other"] as const;
export type CostType = (typeof COST_TYPES)[number];
export const costTypeSchema = z.enum(COST_TYPES);

export const RATE_BASES = ["flat", "per_kg", "per_km", "per_package"] as const;
export type RateBasis = (typeof RATE_BASES)[number];
export const rateBasisSchema = z.enum(RATE_BASES);

const money = z.coerce.number().min(0).max(1_000_000_000);

// ---- Tarifas de transportadora ----

export const rateCreateSchema = z.object({
  carrierId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  basis: rateBasisSchema,
  price: money,
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
  minCharge: money.optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type RateCreateInput = z.infer<typeof rateCreateSchema>;

export const rateUpdateSchema = rateCreateSchema.partial().extend({
  active: z.boolean().optional(),
});
export type RateUpdateInput = z.infer<typeof rateUpdateSchema>;

export const rateDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  carrierId: z.string(),
  carrierName: z.string(),
  name: z.string(),
  basis: rateBasisSchema,
  price: z.number(),
  currency: z.string(),
  minCharge: z.number().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  active: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type RateDto = z.infer<typeof rateDtoSchema>;

export const listRatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  carrierId: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
});

// ---- Custos de expedição ----

export const shipmentCostCreateSchema = z.object({
  type: costTypeSchema,
  description: z.string().trim().min(1).max(200),
  amount: z.coerce.number().min(0.01).max(1_000_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
});
export type ShipmentCostCreateInput = z.infer<typeof shipmentCostCreateSchema>;

export const shipmentCostDtoSchema = z.object({
  id: z.string(),
  type: costTypeSchema,
  description: z.string(),
  amount: z.number(),
  currency: z.string(),
  /** Preenchido quando o custo foi calculado a partir de uma tarifa */
  rateId: z.string().nullable(),
  createdAt: z.string(),
});
export type ShipmentCostDto = z.infer<typeof shipmentCostDtoSchema>;

// ---- Cotação automática (motor de tarifas) ----

export const rateQuoteDtoSchema = z.object({
  rateId: z.string(),
  rateName: z.string(),
  carrierId: z.string(),
  carrierName: z.string(),
  basis: rateBasisSchema,
  /** null quando falta informação na expedição (ver `missing`) */
  amount: z.number().nullable(),
  currency: z.string(),
  minChargeApplied: z.boolean(),
  missing: z.enum(["weight", "distance", "packages"]).nullable(),
});
export type RateQuoteDto = z.infer<typeof rateQuoteDtoSchema>;

export const applyRateSchema = z.object({
  /** Omitido → tarifa mais barata da transportadora da expedição */
  rateId: z.string().uuid().optional(),
});

// ---- Auditoria de faturas de frete ----

export const CARRIER_INVOICE_STATUSES = ["pending", "matched", "discrepancy"] as const;
export type CarrierInvoiceStatus = (typeof CARRIER_INVOICE_STATUSES)[number];

export const carrierInvoiceCreateSchema = z.object({
  carrierId: z.string().uuid(),
  shipmentId: z.string().uuid().optional(),
  invoiceNumber: z.string().trim().min(1).max(60),
  amount: z.coerce.number().min(0.01).max(1_000_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
  issuedAt: z.string().optional(),
  note: z.string().trim().max(300).optional(),
});
export type CarrierInvoiceCreateInput = z.infer<typeof carrierInvoiceCreateSchema>;

export const carrierInvoiceDtoSchema = z.object({
  id: z.string(),
  carrierId: z.string(),
  carrierName: z.string(),
  shipmentId: z.string().nullable(),
  shipmentNumber: z.string().nullable(),
  invoiceNumber: z.string(),
  amount: z.number(),
  currency: z.string(),
  /** Soma dos custos de frete da expedição quando registada */
  expectedAmount: z.number().nullable(),
  /** amount − expectedAmount */
  variance: z.number().nullable(),
  status: z.enum(CARRIER_INVOICE_STATUSES),
  issuedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type CarrierInvoiceDto = z.infer<typeof carrierInvoiceDtoSchema>;

export const listCarrierInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  carrierId: z.string().uuid().optional(),
  status: z.enum(CARRIER_INVOICE_STATUSES).optional(),
});

// ---- Faturação ao cliente ----

export const SALES_INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;
export type SalesInvoiceStatus = (typeof SALES_INVOICE_STATUSES)[number];
export const SALES_INVOICE_TRANSITIONS: Record<SalesInvoiceStatus, SalesInvoiceStatus[]> = {
  draft: ["issued", "void"],
  issued: ["paid", "void"],
  paid: [],
  void: [],
};

const salesInvoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000),
  /** Taxa de IVA em % — 23 normal, 13 intermédia, 6 reduzida, 0 isenta */
  taxRate: z.coerce.number().min(0).max(100).default(23),
});

/** Fatura manual — linhas indicadas diretamente. */
export const salesInvoiceCreateSchema = z.object({
  customerId: z.string().uuid(),
  /** Opcional: encomenda de origem (copia as linhas com preço) */
  orderId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(salesInvoiceLineSchema).min(1).optional(),
});
export type SalesInvoiceCreateInput = z.infer<typeof salesInvoiceCreateSchema>;

export const salesInvoiceStatusUpdateSchema = z.object({
  status: z.enum(["issued", "paid", "void"]),
});
export type SalesInvoiceStatusUpdate = z.infer<typeof salesInvoiceStatusUpdateSchema>;

export const salesInvoiceLineDtoSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  /** Taxa de IVA em % */
  taxRate: z.number(),
  /** Valor do IVA da linha (lineTotal × taxRate/100) */
  taxAmount: z.number(),
  /** Total sem IVA */
  lineTotal: z.number(),
});
export type SalesInvoiceLineDto = z.infer<typeof salesInvoiceLineDtoSchema>;

/** Estado da parte fiscal (ATCUD/assinatura/comunicação) — null em rascunho */
export const SALES_INVOICE_AT_STATUSES = ["unsigned", "signed", "communicated", "failed"] as const;
export type SalesInvoiceAtStatus = (typeof SALES_INVOICE_AT_STATUSES)[number];

export const salesInvoiceDtoSchema = z.object({
  id: z.string(),
  number: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  status: z.enum(SALES_INVOICE_STATUSES),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  /** Base tributável (sem IVA) */
  subtotal: z.number(),
  /** Total do IVA */
  taxTotal: z.number(),
  /** Total com IVA (subtotal + taxTotal) */
  total: z.number(),
  notes: z.string().nullable(),
  /** Série e sequência usadas no ATCUD — null em faturas antigas */
  series: z.string().nullable(),
  seq: z.number().nullable(),
  /** ATCUD atribuído na emissão; null em rascunho */
  atcud: z.string().nullable(),
  /** 4 caracteres de controlo do hash (impressos no documento) */
  hashControl: z.string().nullable(),
  atStatus: z.enum(SALES_INVOICE_AT_STATUSES).nullable(),
  atMessage: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(salesInvoiceLineDtoSchema).optional(),
});
export type SalesInvoiceDto = z.infer<typeof salesInvoiceDtoSchema>;

export const listSalesInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  customerId: z.string().uuid().optional(),
  status: z.enum(SALES_INVOICE_STATUSES).optional(),
});
