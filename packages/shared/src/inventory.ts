import { z } from "zod";
import { addressSchema } from "./shipments.js";

// ── Armazéns ────────────────────────────────────────────────────────────────

export const warehouseCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  address: addressSchema.optional(),
});
export type WarehouseCreateInput = z.infer<typeof warehouseCreateSchema>;

export const warehouseUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  address: addressSchema.nullish(),
  active: z.boolean().optional(),
});
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>;

export const warehouseDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  code: z.string(),
  name: z.string(),
  address: addressSchema.nullable(),
  active: z.boolean(),
  itemCount: z.number(),
  createdAt: z.string(),
});
export type WarehouseDto = z.infer<typeof warehouseDtoSchema>;

export const listWarehousesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  active: z.enum(["true", "false"]).optional(),
});

// ── Artigos ─────────────────────────────────────────────────────────────────

export const itemCreateSchema = z.object({
  sku: z.string().trim().min(1).max(60).toUpperCase(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  unit: z.string().trim().min(1).max(12).default("un"),
  weightKg: z.coerce.number().min(0).optional(),
});
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;

export const itemUpdateSchema = itemCreateSchema.partial().extend({
  active: z.boolean().optional(),
});
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;

export const itemDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  weightKg: z.number().nullable(),
  active: z.boolean(),
  totalStock: z.number(),
  createdAt: z.string(),
});
export type ItemDto = z.infer<typeof itemDtoSchema>;

export const listItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  active: z.enum(["true", "false"]).optional(),
});

// ── Stock e movimentos ──────────────────────────────────────────────────────

export const MOVEMENT_TYPES = ["in", "out", "adjust", "transfer"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const movementTypeSchema = z.enum(MOVEMENT_TYPES);

export const stockLevelDtoSchema = z.object({
  warehouseId: z.string(),
  warehouseCode: z.string(),
  warehouseName: z.string(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  onHand: z.number(),
  reserved: z.number(),
});
export type StockLevelDto = z.infer<typeof stockLevelDtoSchema>;

export const listStockQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});

export const movementCreateSchema = z
  .object({
    type: movementTypeSchema,
    itemId: z.string().uuid(),
    quantity: z.coerce.number().int(),
    warehouseId: z.string().uuid().optional(),
    toWarehouseId: z.string().uuid().optional(),
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "transfer") {
      if (!v.warehouseId || !v.toWarehouseId) {
        ctx.addIssue({ code: "custom", message: "Transferência exige armazém de origem e destino" });
      } else if (v.warehouseId === v.toWarehouseId) {
        ctx.addIssue({ code: "custom", message: "Origem e destino têm de ser diferentes" });
      }
      if (v.quantity <= 0) {
        ctx.addIssue({ code: "custom", message: "Quantidade deve ser positiva" });
      }
    } else {
      if (!v.warehouseId) {
        ctx.addIssue({ code: "custom", message: "Armazém obrigatório" });
      }
      if ((v.type === "in" || v.type === "out") && v.quantity <= 0) {
        ctx.addIssue({ code: "custom", message: "Quantidade deve ser positiva" });
      }
      if (v.type === "adjust" && v.quantity === 0) {
        ctx.addIssue({ code: "custom", message: "Ajuste não pode ser zero" });
      }
    }
  });
export type MovementCreateInput = z.infer<typeof movementCreateSchema>;

export const stockMovementDtoSchema = z.object({
  id: z.string(),
  type: movementTypeSchema,
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  quantity: z.number(),
  warehouseId: z.string().nullable(),
  warehouseCode: z.string().nullable(),
  toWarehouseId: z.string().nullable(),
  toWarehouseCode: z.string().nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;

export const listMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  type: movementTypeSchema.optional(),
});

// ── Compras (cadeia de abastecimento) ───────────────────────────────────────

export const PO_STATUSES = [
  "draft",
  "sent",
  "partially_received",
  "received",
  "cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const poStatusSchema = z.enum(PO_STATUSES);

export const PO_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["cancelled"],
  partially_received: ["cancelled"],
  received: [],
  cancelled: [],
};

export const poLineSchema = z.object({
  itemId: z.string().uuid(),
  description: z.string().trim().max(200).optional(),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0).optional(),
});
export type PoLineInput = z.infer<typeof poLineSchema>;

export const poCreateSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(poLineSchema).min(1, "A compra precisa de pelo menos uma linha"),
});
export type PoCreateInput = z.infer<typeof poCreateSchema>;

export const poStatusUpdateSchema = z.object({
  status: z.enum(["sent", "cancelled"]),
});
export type PoStatusUpdate = z.infer<typeof poStatusUpdateSchema>;

export const poReceiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1),
});
export type PoReceiveInput = z.infer<typeof poReceiveSchema>;

export const poLineDtoSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  description: z.string().nullable(),
  quantity: z.number(),
  receivedQty: z.number(),
  unit: z.string(),
  unitPrice: z.number().nullable(),
});
export type PoLineDto = z.infer<typeof poLineDtoSchema>;

export const purchaseOrderDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  number: z.string(),
  status: poStatusSchema,
  supplierId: z.string(),
  supplierName: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  expectedDate: z.string().nullable(),
  notes: z.string().nullable(),
  lineCount: z.number(),
  totalQty: z.number(),
  receivedQty: z.number(),
  createdAt: z.string(),
});
export type PurchaseOrderDto = z.infer<typeof purchaseOrderDtoSchema>;

export const purchaseOrderDetailDtoSchema = purchaseOrderDtoSchema.extend({
  lines: z.array(poLineDtoSchema),
});
export type PurchaseOrderDetailDto = z.infer<typeof purchaseOrderDetailDtoSchema>;

export const listPoQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: poStatusSchema.optional(),
  supplierId: z.string().uuid().optional(),
});
