import { sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { sequences } from "../db/schema.js";

const PREFIX: Record<string, string> = {
  order: "ENC",
  shipment: "EXP",
  route: "ROT",
  warehouse: "ARM",
  purchase_order: "PC",
  "partner:customer": "CLI",
  "partner:supplier": "FOR",
  "partner:carrier": "TRA",
};

/** Incremento atómico por tenant — gera códigos como ENC-00042. */
export async function nextNumber(db: DB, tenantId: string, key: string): Promise<string> {
  const [row] = await db
    .insert(sequences)
    .values({ tenantId, key, value: 1 })
    .onConflictDoUpdate({
      target: [sequences.tenantId, sequences.key],
      set: { value: sql`${sequences.value} + 1` },
    })
    .returning({ value: sequences.value });
  const prefix = PREFIX[key] ?? key.toUpperCase();
  return `${prefix}-${String(row.value).padStart(5, "0")}`;
}
