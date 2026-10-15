import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePgLite } from "drizzle-orm/pglite";
import pg from "pg";
import { env } from "../env.js";
import * as schema from "./schema.js";

export type DB = NodePgDatabase<typeof schema>;
export type DbDriver = "pg" | "pglite";

export interface DbHandle {
  db: DB;
  driver: DbDriver;
  close: () => Promise<void>;
}

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export async function createDb(): Promise<DbHandle> {
  if (env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    return {
      db: drizzleNodePg(pool, { schema }),
      driver: "pg",
      close: () => pool.end(),
    };
  }

  // Fallback local: PGlite = PostgreSQL compilado para WASM.
  // Em testes corre em memória; em dev persiste em PGLITE_DIR.
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = env.NODE_ENV === "test" ? undefined : env.PGLITE_DIR;
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir);
  return {
    db: drizzlePgLite(client, { schema }) as unknown as DB,
    driver: "pglite",
    close: () => client.close(),
  };
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  if (handle.driver === "pg") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder });
  }
}
