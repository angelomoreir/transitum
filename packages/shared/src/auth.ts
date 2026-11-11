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

// ── MFA / TOTP ──────────────────────────────────────────────────────────────

const totpCode = z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos");

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(10).max(2048),
  code: totpCode,
});
export const mfaEnableSchema = z.object({ code: totpCode });
export const mfaDisableSchema = z.object({ code: totpCode });

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

// ── SSO / OpenID Connect ────────────────────────────────────────────────────

/** Descoberta de SSO pelo domínio do email (página de login). */
export const ssoLookupSchema = z.object({ email: emailSchema });
export type SsoLookupInput = z.infer<typeof ssoLookupSchema>;

export const ssoLookupResponseSchema = z.object({
  sso: z.boolean(),
  providerId: z.string().optional(),
  providerName: z.string().optional(),
  /** URL da API para iniciar o fluxo (redirect para o IdP) */
  startUrl: z.string().optional(),
});
export type SsoLookupResponse = z.infer<typeof ssoLookupResponseSchema>;

/** Roles permitidas no auto-provisionamento SSO (nunca admin). */
export const ssoProvisionRoles = ["viewer", "operator", "manager"] as const;

export const ssoProviderCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Domínio de email que identifica este fornecedor (ex.: empresa.pt) */
  domain: z.string().trim().min(3).max(160).toLowerCase(),
  clientId: z.string().trim().min(1).max(300),
  /** Guardado cifrado; nunca devolvido */
  clientSecret: z.string().min(4).max(400),
  authorizeUrl: z.string().url().max(500),
  tokenUrl: z.string().url().max(500),
  userinfoUrl: z.string().url().max(500).optional(),
  /** Cria a conta automaticamente no primeiro login (função defaultRole) */
  autoProvision: z.boolean().default(false),
  defaultRole: z.enum(ssoProvisionRoles).default("viewer"),
});
export type SsoProviderCreateInput = z.infer<typeof ssoProviderCreateSchema>;

export const ssoProviderUpdateSchema = ssoProviderCreateSchema.partial().extend({
  enabled: z.boolean().optional(),
});
export type SsoProviderUpdateInput = z.infer<typeof ssoProviderUpdateSchema>;

export const ssoProviderDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  clientId: z.string(),
  authorizeUrl: z.string(),
  tokenUrl: z.string(),
  userinfoUrl: z.string().nullable(),
  enabled: z.boolean(),
  autoProvision: z.boolean(),
  defaultRole: z.string(),
  /** URL de redirect a configurar no IdP */
  redirectUri: z.string(),
  createdAt: z.string(),
});
export type SsoProviderDto = z.infer<typeof ssoProviderDtoSchema>;
