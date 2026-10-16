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
  STORAGE_DIR: z.string().default(".data/storage"),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  // Storage S3/MinIO — se S3_BUCKET definido, substitui o driver local
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("eu-west-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === "production") {
  if (env.JWT_SECRET === "dev-only-secret-change-me-0123456789") {
    throw new Error("JWT_SECRET tem de ser definido em produção");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL é obrigatório em produção");
  }
}
