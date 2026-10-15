import type { DB } from "../db/client.js";
import { auditEvents } from "../db/schema.js";

interface AuditInput {
  tenantId: string;
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

export async function audit(db: DB, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorId: input.actorId ?? null,
    action: input.action,
    entity: input.entity ?? null,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
    ip: input.ip ?? null,
  });
}
