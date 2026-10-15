import { z } from "zod";

export const ORDER_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().int().min(1).default(1),
  weightKg: z.coerce.number().min(0).optional(),
});
export type OrderLineInput = z.infer<typeof orderLineSchema>;

export const orderCreateSchema = z.object({
  customerId: z.string().uuid(),
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
  createdAt: z.string(),
});
export type OrderDto = z.infer<typeof orderDtoSchema>;

export const orderDetailDtoSchema = orderDtoSchema.extend({
  lines: z.array(orderLineDtoSchema),
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
