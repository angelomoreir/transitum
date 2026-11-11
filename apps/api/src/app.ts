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
import { ensurePlans } from "./lib/billing.js";
import { AppError } from "./lib/errors.js";
import { startScheduler } from "./lib/scheduler.js";
import { createConsoleMailer, type Mailer } from "./lib/mailer.js";
import { authPlugin } from "./plugins/auth.js";
import { createStorage, type StorageDriver } from "./lib/storage.js";
import { createAtClient, type AtClient } from "./lib/at.js";
import { createGeocoder, type Geocoder } from "./lib/geo.js";
import { createSmtpMailer, createSms, type SmsSender } from "./lib/messaging.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { automationRoutes } from "./routes/automations.js";
import { billingRoutes } from "./routes/billing.js";
import { carrierRoutes } from "./routes/carriers.js";
import { customsRoutes } from "./routes/customs.js";
import { createDocumentRoutes } from "./routes/documents.js";
import { driverRoutes } from "./routes/driver.js";
import { freightInvoiceRoutes } from "./routes/freight-invoices.js";
import { salesInvoiceRoutes } from "./routes/sales-invoices.js";
import { healthRoutes } from "./routes/health.js";
import { integrationRoutes } from "./routes/integrations.js";
import { inventoryCountRoutes } from "./routes/inventory-counts.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { miscRoutes } from "./routes/misc.js";
import { notificationRoutes } from "./routes/notifications.js";
import { orderRoutes } from "./routes/orders.js";
import { partnerRoutes } from "./routes/partners.js";
import { pickWaveRoutes } from "./routes/pick-waves.js";
import { purchaseRoutes } from "./routes/purchases.js";
import { rateRoutes } from "./routes/rates.js";
import { reportRoutes } from "./routes/reports.js";
import { returnRoutes } from "./routes/returns.js";
import { routeRoutes } from "./routes/routes.js";
import { shipmentRoutes } from "./routes/shipments.js";
import { shipmentOpsRoutes } from "./routes/shipment-ops.js";
import { ssoProviderRoutes } from "./routes/sso-providers.js";
import { tenantRoutes } from "./routes/tenant.js";
import { inboundRoutes } from "./routes/inbound.js";
import { trackingRoutes } from "./routes/tracking.js";
import { portalRoutes } from "./routes/portal.js";
import { publicApiRoutes } from "./routes/v1.js";
import { userRoutes } from "./routes/users.js";
import { vehicleRoutes } from "./routes/vehicles.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DB;
    dbDriver: DbDriver;
    mailer: Mailer;
    sms: SmsSender;
    geocoder: Geocoder;
    atClient: AtClient;
    storage: StorageDriver;
  }
}

export interface BuildAppOptions {
  logger?: boolean;
  mailer?: Mailer;
  sms?: SmsSender;
  geocoder?: Geocoder;
  atClient?: AtClient;
  storage?: StorageDriver;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const handle = await createDb();
  await runMigrations(handle);
  await ensurePlans(handle.db);

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
  app.decorate(
    "mailer",
    opts.mailer ?? (env.SMTP_URL ? await createSmtpMailer(env.SMTP_URL) : createConsoleMailer(app.log)),
  );
  app.decorate("sms", opts.sms ?? createSms(app.log));
  app.decorate("geocoder", opts.geocoder ?? createGeocoder(handle.db, app.log));
  app.decorate("atClient", opts.atClient ?? createAtClient());
  app.decorate("storage", opts.storage ?? createStorage());
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
        title: "Transitum API",
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
  await app.register(pickWaveRoutes, { prefix: "/api/pick-waves" });
  await app.register(shipmentRoutes, { prefix: "/api/shipments" });
  await app.register(shipmentOpsRoutes, { prefix: "/api/shipments" });
  await app.register(routeRoutes, { prefix: "/api/routes" });
  await app.register(vehicleRoutes, { prefix: "/api/vehicles" });
  await app.register(returnRoutes, { prefix: "/api/returns" });
  await app.register(rateRoutes, { prefix: "/api/rates" });
  await app.register(carrierRoutes, { prefix: "/api/carrier-connections" });
  await app.register(driverRoutes, { prefix: "/api/driver" });
  await app.register(reportRoutes, { prefix: "/api/reports" });
  await app.register(freightInvoiceRoutes, { prefix: "/api/freight-invoices" });
  await app.register(salesInvoiceRoutes, { prefix: "/api/sales-invoices" });
  await app.register(trackingRoutes, { prefix: "/api/track" });
  await app.register(portalRoutes, { prefix: "/api/portal" });
  await app.register(inboundRoutes, { prefix: "/api/inbound" });
  await app.register(inventoryRoutes, { prefix: "/api" });
  await app.register(inventoryCountRoutes, { prefix: "/api/inventory-counts" });
  await app.register(purchaseRoutes, { prefix: "/api/purchase-orders" });
  await app.register(createDocumentRoutes(app.storage), { prefix: "/api/documents" });
  await app.register(notificationRoutes, { prefix: "/api" });
  await app.register(automationRoutes, { prefix: "/api/automations" });
  await app.register(customsRoutes, { prefix: "/api" });
  await app.register(integrationRoutes, { prefix: "/api/integrations" });
  await app.register(ssoProviderRoutes, { prefix: "/api/sso-providers" });
  await app.register(publicApiRoutes, { prefix: "/api/v1" });
  await app.register(billingRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(miscRoutes, { prefix: "/api" });

  startScheduler(handle.db, app.log);

  return app;
}
