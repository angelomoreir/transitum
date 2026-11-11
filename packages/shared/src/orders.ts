import { z } from "zod";

export const ORDER_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderLineSchema = z
  .object({
    /** Artigo do catálogo — liga a linha ao stock (reserva/saída) */
    itemId: z.string().uuid().optional(),
    description: z.string().trim().max(200).optional(),
    quantity: z.coerce.number().int().min(1).default(1),
    weightKg: z.coerce.number().min(0).optional(),
    unitPrice: z.coerce.number().min(0).max(1_000_000_000).optional(),
  })
  .refine((l) => !!l.itemId || !!l.description, {
    message: "Cada linha precisa de um artigo ou de uma descrição",
    path: ["description"],
  });
export type OrderLineInput = z.infer<typeof orderLineSchema>;

export const orderCreateSchema = z.object({
  customerId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  requestedDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  deliveryLine1: z.string().trim().max(160).optional(),
  deliveryCity: z.string().trim().max(80).optional(),
  deliveryPostalCode: z.string().trim().max(16).optional(),
  deliveryCountry: z.string().trim().length(2).toUpperCase().optional(),
  lines: z.array(orderLineSchema).min(1, "A encomenda precisa de pelo menos uma linha"),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderUpdateSchema = z.object({
  status: orderStatusSchema.optional(),
  /** Só pode ser alterado em rascunho */
  warehouseId: z.string().uuid().nullish(),
  requestedDate: z.string().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export const orderLineDtoSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  description: z.string(),
  quantity: z.number(),
  weightKg: z.number().nullable(),
  itemId: z.string().nullable(),
  sku: z.string().nullable(),
  unit: z.string().nullable(),
  unitPrice: z.number().nullable(),
  reservedQty: z.number(),
  shippedQty: z.number(),
});
export type OrderLineDto = z.infer<typeof orderLineDtoSchema>;

export const orderDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  number: z.string(),
  status: orderStatusSchema,
  customerId: z.string(),
  customerName: z.string(),
  requestedDate: z.string().nullable(),
  notes: z.string().nullable(),
  deliveryLine1: z.string().nullable(),
  deliveryCity: z.string().nullable(),
  deliveryPostalCode: z.string().nullable(),
  deliveryCountry: z.string().nullable(),
  warehouseId: z.string().nullable(),
  warehouseName: z.string().nullable(),
  createdAt: z.string(),
});
export type OrderDto = z.infer<typeof orderDtoSchema>;

export const orderDetailDtoSchema = orderDtoSchema.extend({
  lines: z.array(orderLineDtoSchema),
  totalValue: z.number(),
  shipments: z.array(z.object({ id: z.string(), number: z.string(), status: z.string() })),
});
export type OrderDetailDto = z.infer<typeof orderDetailDtoSchema>;

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: orderStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
});

// ---- Guia de picking ----

export const pickListLineDtoSchema = z.object({
  sku: z.string().nullable(),
  itemName: z.string(),
  itemId: z.string().nullable(),
  unit: z.string().nullable(),
  ordered: z.number(),
  reserved: z.number(),
  shipped: z.number(),
  /** Quantidade por expedir (ordered − shipped) */
  toPick: z.number(),
  /** Stock disponível no armazém da encomenda (null sem armazém/artigo) */
  available: z.number().nullable(),
  /** Localização preferencial de picking (zona-código), null se não atribuída */
  location: z.string().nullable(),
});
export type PickListLineDto = z.infer<typeof pickListLineDtoSchema>;

export const pickListDtoSchema = z.object({
  orderId: z.string(),
  number: z.string(),
  customerName: z.string(),
  warehouseName: z.string().nullable(),
  requestedDate: z.string().nullable(),
  lines: z.array(pickListLineDtoSchema),
});
export type PickListDto = z.infer<typeof pickListDtoSchema>;

// ---- Devoluções (RMA) ----

export const RETURN_STATUSES = ["draft", "received", "cancelled"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const returnStatusSchema = z.enum(RETURN_STATUSES);

export const returnLineSchema = z.object({
  itemId: z.string().uuid().optional(),
  /** Omitida com itemId → usa o nome do artigo */
  description: z.string().trim().min(1).max(200).optional(),
  quantity: z.coerce.number().int().min(1),
});
export type ReturnLineInput = z.infer<typeof returnLineSchema>;

export const returnCreateSchema = z.object({
  customerId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  reason: z.string().trim().max(300).optional(),
  lines: z.array(returnLineSchema).min(1, "A devolução precisa de pelo menos uma linha"),
});
export type ReturnCreateInput = z.infer<typeof returnCreateSchema>;

export const returnLineDtoSchema = z.object({
  id: z.string(),
  itemId: z.string().nullable(),
  sku: z.string().nullable(),
  description: z.string(),
  quantity: z.number(),
  receivedQty: z.number(),
});
export type ReturnLineDto = z.infer<typeof returnLineDtoSchema>;

export const returnDtoSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: returnStatusSchema,
  customerId: z.string(),
  customerName: z.string(),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  reason: z.string().nullable(),
  receivedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ReturnDto = z.infer<typeof returnDtoSchema>;

export const returnDetailDtoSchema = returnDtoSchema.extend({
  lines: z.array(returnLineDtoSchema),
});
export type ReturnDetailDto = z.infer<typeof returnDetailDtoSchema>;

export const listReturnsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: returnStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
});
