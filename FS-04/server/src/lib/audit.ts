import type { TenantDb } from "../db/tenant.js";

export interface AuditEntry {
  actorId: string | null;
  action: string; // e.g. "issue.updated"
  entityType: string; // e.g. "Issue"
  entityId: string;
  metadata?: Record<string, unknown>;
}

type AuditWriter = Pick<TenantDb, "auditLog">;

export async function audit(db: AuditWriter, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: (entry.metadata ?? {}) as object,
    } as any,
  });
}

/** Field-level diff for audit metadata: { field: { from, to } } */
export function diff(before: Record<string, any>, after: Record<string, any>, fields: string[]) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = before[f] instanceof Date ? before[f].toISOString() : before[f];
    const b = after[f] instanceof Date ? after[f].toISOString() : after[f];
    if (a !== b) changes[f] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}
