import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`API em http://localhost:${env.PORT} (docs: /docs, driver: ${app.dbDriver})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
