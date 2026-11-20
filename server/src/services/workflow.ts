import type { StatusCategory } from "@prisma/client";
import type { TenantDb } from "../db/tenant.js";
import { badRequest } from "../lib/errors.js";

type Db = Pick<TenantDb, "workflow" | "workflowStatus" | "workflowTransition">;

export const DEFAULT_STATUSES: { name: string; category: StatusCategory }[] = [
  { name: "To Do", category: "TODO" },
  { name: "In Progress", category: "IN_PROGRESS" },
  { name: "In Review", category: "IN_PROGRESS" },
  { name: "Done", category: "DONE" },
];

export async function createWorkflow(
  db: Db,
  name: string,
  statuses = DEFAULT_STATUSES,
  enforceTransitions = false,
) {
  const wf = await db.workflow.create({ data: { name, enforceTransitions } as any });
  for (const [position, s] of statuses.entries()) {
    await db.workflowStatus.create({ data: { workflowId: wf.id, name: s.name, category: s.category, position } as any });
  }
  return wf;
}

/**
 * Throws if moving from `fromStatusId` to `toStatusId` is not allowed.
 * When a workflow has `enforceTransitions` off, any move is allowed.
 */
export async function assertTransition(db: Db, workflowId: string, fromStatusId: string, toStatusId: string) {
  if (fromStatusId === toStatusId) return;
  const wf = await db.workflow.findUnique({ where: { id: workflowId } });
  if (!wf?.enforceTransitions) return;
  const edge = await db.workflowTransition.findFirst({ where: { workflowId, fromStatusId, toStatusId } });
  if (!edge) throw badRequest("This status transition is not allowed by the project workflow");
}

export async function getWorkflowDetail(db: Db, workflowId: string) {
  const wf = await db.workflow.findUnique({ where: { id: workflowId } });
  if (!wf) return null;
  const statuses = await db.workflowStatus.findMany({ where: { workflowId }, orderBy: { position: "asc" } });
  const transitions = await db.workflowTransition.findMany({
    where: { workflowId },
    select: { id: true, fromStatusId: true, toStatusId: true },
  });
  return { ...wf, statuses, transitions };
}
