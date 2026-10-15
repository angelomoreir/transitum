import { z } from "zod";
import { roleSchema } from "./permissions.js";

export const userStatusSchema = z.enum(["invited", "active", "suspended"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  status: userStatusSchema,
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const tenantDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  createdAt: z.string(),
});
export type TenantDto = z.infer<typeof tenantDtoSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: userDtoSchema,
  tenant: tenantDtoSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const statsSchema = z.object({
  activeUsers: z.number(),
  pendingInvites: z.number(),
  suspendedUsers: z.number(),
  activeSessions: z.number(),
  partners: z.number(),
  orders: z.number(),
  openOrders: z.number(),
  activeShipments: z.number(),
  deliveredShipments: z.number(),
  activeRoutes: z.number(),
  openPurchases: z.number(),
  stockItems: z.number(),
  recentEvents: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      actorName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type Stats = z.infer<typeof statsSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
