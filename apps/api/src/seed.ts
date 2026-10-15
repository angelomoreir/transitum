/**
 * Dados de demonstração — OPCIONAL e claramente identificado.
 * Utilização: SEED_DEMO=1 npm run db:seed -w @blujay/api
 */
import { createDb, runMigrations } from "./db/client.js";
import { tenants, users } from "./db/schema.js";
import { hashPassword } from "./lib/passwords.js";
import { slugify } from "./lib/tokens.js";
import { eq } from "drizzle-orm";

if (process.env.SEED_DEMO !== "1") {
  console.error("Defina SEED_DEMO=1 para criar dados de demonstração.");
  process.exit(1);
}

const handle = await createDb();
await runMigrations(handle);

const companyName = "[DEMO] Transportes Atlântico";
const adminEmail = "demo@blujay.local";
const demoPassword = "Demo12345!";

const [existing] = await handle.db.select().from(users).where(eq(users.email, adminEmail));
if (existing) {
  console.log("Dados de demonstração já existem.");
} else {
  const [tenant] = await handle.db
    .insert(tenants)
    .values({ name: companyName, slug: slugify(companyName) })
    .returning();
  await handle.db.insert(users).values([
    {
      tenantId: tenant.id,
      email: adminEmail,
      name: "Administrador Demo",
      passwordHash: hashPassword(demoPassword),
      role: "admin",
      status: "active",
    },
    {
      tenantId: tenant.id,
      email: "operador@blujay.local",
      name: "Operador Demo",
      passwordHash: hashPassword(demoPassword),
      role: "operator",
      status: "active",
    },
  ]);
  console.log(`Tenant demo criado: ${companyName}`);
  console.log(`Login: ${adminEmail} / ${demoPassword}`);
}

await handle.close();
