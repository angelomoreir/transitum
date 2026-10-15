import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", () => ({ status: "ok" }));

  app.get("/ready", async (_req, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { status: "ready", driver: app.dbDriver };
    } catch {
      return reply.code(503).send({
        error: { code: "NOT_READY", message: "Base de dados indisponível" },
      });
    }
  });
}
