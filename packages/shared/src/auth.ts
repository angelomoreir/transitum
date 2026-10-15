import { z } from "zod";
import { roleSchema } from "./permissions.js";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(10, "A palavra-passe deve ter pelo menos 10 caracteres")
  .max(128)
  .regex(/[a-zA-Z]/, "Deve conter pelo menos uma letra")
  .regex(/[0-9]/, "Deve conter pelo menos um número");

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(2).max(120).optional(),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const inviteUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  role: roleSchema.exclude(["admin"]).default("operator"),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: roleSchema.optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  role: roleSchema.optional(),
  status: z.enum(["invited", "active", "suspended"]).optional(),
});
