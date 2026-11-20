import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

/**
 * Models that belong to a tenant. Each has a non-null `workspaceId` column.
 */
export const TENANT_MODELS = new Set<string>([
  "Membership",
  "Workflow",
  "WorkflowStatus",
  "WorkflowTransition",
  "Project",
  "Board",
  "Sprint",
  "Issue",
  "Comment",
  "Attachment",
  "AuditLog",
  "Webhook",
  "WebhookDelivery",
  "Notification",
  "Report",
]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

type AnyArgs = Record<string, any>;

/**
 * Pure function that rewrites query args so they are confined to one tenant.
 * Exported separately so it can be unit tested without a database.
 */
export function scopeArgs(model: string | undefined, operation: string, args: AnyArgs | undefined, workspaceId: string): AnyArgs {
  const a: AnyArgs = { ...(args ?? {}) };
  if (!model || !TENANT_MODELS.has(model)) return a;

  if (WHERE_OPS.has(operation)) {
    a.where = { ...(a.where ?? {}), workspaceId };
  }

  if (operation === "create") {
    a.data = { ...(a.data ?? {}), workspaceId };
  }

  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(a.data) ? a.data : [a.data];
    a.data = rows.map((r: AnyArgs) => ({ ...r, workspaceId }));
  }

  if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") {
    // Never allow a row to be moved to a different tenant.
    if (a.data && "workspaceId" in a.data) {
      const { workspaceId: _ignored, ...rest } = a.data;
      a.data = rest;
    }
  }

  if (operation === "upsert") {
    a.where = { ...(a.where ?? {}), workspaceId };
    a.create = { ...(a.create ?? {}), workspaceId };
    if (a.update && "workspaceId" in a.update) {
      const { workspaceId: _ignored, ...rest } = a.update;
      a.update = rest;
    }
  }

  return a;
}

/**
 * Returns a Prisma client where every query against a tenant model is
 * automatically filtered by, and written with, the given workspaceId.
 * Unique lookups (findUnique/update/delete by id) also get the tenant
 * filter, so fetching another tenant's row by id returns null / P2025.
 */
export function tenantDb(workspaceId: string) {
  return prisma.$extends(
    Prisma.defineExtension({
      name: "tenant-scope",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            return query(scopeArgs(model, operation, args as AnyArgs, workspaceId) as any);
          },
        },
      },
    }),
  );
}

export type TenantDb = ReturnType<typeof tenantDb>;
