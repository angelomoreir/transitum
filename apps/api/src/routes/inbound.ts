import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { inboundOrderSchema } from "@transitum/shared";
import { z } from "zod";
import { inboundChannels, orders } from "../db/schema.js";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";
import {
  createInboundOrder,
  mapGenericOrder,
  mapShopifyOrder,
  mapWooCommerceOrder,
} from "../lib/inbound.js";
import { decryptSecret } from "../lib/secrets.js";
import { parseEdifactOrders } from "../lib/edifact.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Corpo bruto preservado pelo parser deste scope (verificação HMAC). */
    rawBody?: string;
  }
}

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/**
 * Receção de webhooks e-commerce/EDI — URL público `/api/inbound/<token>`
 * configurado no sistema de origem. Verifica a assinatura HMAC do canal e
 * mapeia o payload para uma encomenda (idempotente por `externalRef`).
 */
export const inboundRoutes: FastifyPluginAsyncZod = async (app) => {
  // Parser com corpo bruto — necessário para validar assinaturas HMAC
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      req.rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(badRequest("JSON inválido"));
      }
    },
  );
  // EDI por ficheiro: corpo EDIFACT/texto bruto (canal 'edifact')
  for (const type of ["application/edifact", "text/plain"]) {
    app.addContentTypeParser(type, { parseAs: "string" }, (req, body, done) => {
      req.rawBody = body as string;
      done(null, body as string);
    });
  }

  app.post(
    "/:token",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ token: z.string().min(20).max(64) }),
        // JSON para webhooks; texto EDIFACT para o canal 'edifact'
        body: z.union([z.record(z.unknown()), z.string()]),
      },
    },
    async (req, reply) => {
      const [channel] = await app.db
        .select()
        .from(inboundChannels)
        .where(eq(inboundChannels.token, req.params.token));
      if (!channel || !channel.active) throw notFound("Canal não encontrado");

      const secret = decryptSecret(channel.secret);
      const raw = req.rawBody ?? JSON.stringify(req.body);
      const header = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };

      // Verificação de assinatura por fonte
      if (channel.source === "shopify") {
        const sig = header("x-shopify-hmac-sha256");
        const expected = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
        if (!sig || !safeEqual(sig, expected)) throw unauthorized("Assinatura inválida");
      } else if (channel.source === "woocommerce") {
        const sig = header("x-wc-webhook-signature");
        const expected = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
        if (!sig || !safeEqual(sig, expected)) throw unauthorized("Assinatura inválida");
      } else {
        const sig = header("x-transitum-signature");
        const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
        if (!sig || !safeEqual(sig, expected)) throw unauthorized("Assinatura inválida");
      }

      // Mapeamento do payload para o formato interno
      const mapped =
        channel.source === "edifact"
          ? parseEdifactOrders(raw)
          : channel.source === "shopify"
            ? mapShopifyOrder(req.body)
            : channel.source === "woocommerce"
              ? mapWooCommerceOrder(req.body)
              : mapGenericOrder(req.body);
      const input = inboundOrderSchema.safeParse(mapped);
      if (!input.success) {
        throw badRequest(`Payload não mapeável: ${input.error.issues[0]?.message ?? "inválido"}`);
      }

      // Idempotência por externalRef
      const [existing] = await app.db
        .select()
        .from(orders)
        .where(
          and(eq(orders.tenantId, channel.tenantId), eq(orders.externalRef, input.data.externalRef)),
        );
      if (existing) {
        await app.db
          .update(inboundChannels)
          .set({ lastReceivedAt: new Date() })
          .where(eq(inboundChannels.id, channel.id));
        return {
          order: {
            id: existing.id,
            number: existing.number,
            status: existing.status,
            externalRef: existing.externalRef ?? null,
          },
          duplicate: true,
        };
      }

      const order = await createInboundOrder(app.db, channel.tenantId, input.data, null);
      await app.db
        .update(inboundChannels)
        .set({ lastReceivedAt: new Date() })
        .where(eq(inboundChannels.id, channel.id));
      return reply.code(201).send({
        order: {
          id: order.id,
          number: order.number,
          status: order.status,
          externalRef: order.externalRef ?? null,
        },
        duplicate: false,
      });
    },
  );
};
