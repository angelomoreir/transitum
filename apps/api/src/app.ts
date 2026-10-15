import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { env } from "./env.js";
import { createDb, runMigrations, type DB, type DbDriver } from "./db/client.js";
import { AppError } from "./lib/errors.js";
import { createConsoleMailer, type Mailer } from "./lib/mailer.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { miscRoutes } from "./routes/misc.js";
import { orderRoutes } from "./routes/orders.js";
import { partnerRoutes } from "./routes/partners.js";
import { shipmentRoutes } from "./routes/shipments.js";
import { tenantRoutes } from "./routes/tenant.js";
import { userRoutes } from "./routes/users.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DB;
    dbDriver: DbDriver;
    mailer: Mailer;
  }
}

export interface BuildAppOptions {
  logger?: boolean;
  mailer?: Mailer;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const handle = await createDb();
  await runMigrations(handle);

  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: env.NODE_ENV === "production" ? "info" : "debug",
            transport:
              env.NODE_ENV === "development"
                ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
                : undefined,
          },
    trustProxy: true,
  });

  app.decorate("db", handle.db);
  app.decorate("dbDriver", handle.driver);
  app.decorate("mailer", opts.mailer ?? createConsoleMailer(app.log));
  app.addHook("onClose", async () => {
    await handle.close();
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados do pedido inválidos",
          issues: err.validation.map((v) => v.message),
        },
      });
    }
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, issues: err.issues } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code ?? "ERROR", message: err.message } });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  });

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
  });
  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(authPlugin);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Blujay API",
        description: "API da plataforma SaaS de logística e supply chain",
        version: "0.1.0",
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(userRoutes, { prefix: "/api/users" });
  await app.register(tenantRoutes, { prefix: "/api/tenant" });
  await app.register(partnerRoutes, { prefix: "/api/partners" });
  await app.register(orderRoutes, { prefix: "/api/orders" });
  await app.register(shipmentRoutes, { prefix: "/api/shipments" });
  await app.register(miscRoutes, { prefix: "/api" });

  return app;
}
