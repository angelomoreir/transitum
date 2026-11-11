import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().optional().default(""),
  PGLITE_DIR: z.string().default(".data/pglite"),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-0123456789"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).default(60),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  WEB_BASE_URL: z.string().url().default("http://localhost:5173"),
  /** URL pública da API (redirect_uri OIDC). Vazio → deriva do pedido. */
  API_BASE_URL: z.string().default(""),
  STORAGE_DIR: z.string().default(".data/storage"),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  // Storage S3/MinIO — se S3_BUCKET definido, substitui o driver local
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("eu-west-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  // Cifra de segredos guardados na BD (credenciais AT/transportadoras).
  // Se vazio, deriva de JWT_SECRET (obrigatório definir em produção).
  SECRETS_KEY: z.string().default(""),
  // Geocodificação: "nominatim" (OpenStreetMap) ou "none"
  GEOCODER: z.enum(["nominatim", "none"]).default("nominatim"),
  GEOCODER_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  /** Fator aplicado à distância em linha reta para estimar a distância por estrada */
  ROAD_DISTANCE_FACTOR: z.coerce.number().min(1).max(3).default(1.3),
  // Matriz de distâncias rodoviárias: "osrm" ou "none" (fallback linha reta × fator)
  ROUTER: z.enum(["osrm", "none"]).default("osrm"),
  ROUTER_URL: z.string().url().default("https://router.project-osrm.org"),
  // Email: SMTP_URL (ex.: smtps://user:pass@smtp.exemplo.pt:465); vazio → consola
  SMTP_URL: z.string().default(""),
  MAIL_FROM: z.string().default("Transitum <no-reply@transitum.local>"),
  // SMS: "console" ou "twilio"
  SMS_PROVIDER: z.enum(["console", "twilio"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_FROM: z.string().default(""),
  // Comunicação de documentos de transporte à AT
  // "mock" simula a resposta; "live" exige certificados do produtor de software
  AT_MODE: z.enum(["mock", "live"]).default("mock"),
  AT_PUBLIC_KEY_PATH: z.string().default(""),
  AT_CLIENT_PFX_PATH: z.string().default(""),
  AT_CLIENT_PFX_PASSPHRASE: z.string().default(""),
  /** Endpoint alternativo para a comunicação de faturas (defeito: AT fews/faturas) */
  AT_INVOICES_URL: z.string().default(""),
  /** Chave privada RSA (PEM) para assinatura dos documentos (Portaria 363/2010) */
  AT_SIGNING_KEY_PATH: z.string().default(""),
  AT_SIGNING_KEY_VERSION: z.string().default("1"),
  AT_SOFTWARE_CERT_NUMBER: z.string().default("0"),
  // Demo pública: protege as contas *@transitum.local (sem mudança de password,
  // MFA nem suspensão) para que visitantes não trancem a demonstração.
  DEMO_MODE: z.coerce.boolean().default(false),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === "production") {
  if (env.JWT_SECRET === "dev-only-secret-change-me-0123456789") {
    throw new Error("JWT_SECRET tem de ser definido em produção");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL é obrigatório em produção");
  }
  if (!env.SECRETS_KEY) {
    throw new Error("SECRETS_KEY é obrigatório em produção");
  }
}
