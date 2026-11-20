import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { param, parse } from "../lib/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { createWorkflow, getWorkflowDetail } from "../services/workflow.js";

export const workflowsRouter = Router({ mergeParams: true });

const category = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
const statusInput = z.object({ name: z.string().min(1).max(40), category });

workflowsRouter.get("/", async (req, res) => {
  const wfs = await req.db!.workflow.findMany({ orderBy: { createdAt: "asc" } });
  const detailed = await Promise.all(wfs.map((w) => getWorkflowDetail(req.db!, w.id)));
  res.json({ workflows: detailed });
});

workflowsRouter.post("/", requirePermission("workflow:manage"), async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().min(1).max(80),
      statuses: z.array(statusInput).min(1).max(20).optional(),
      enforceTransitions: z.boolean().optional(),
    }),
    req.body,
  );
  const wf = await createWorkflow(req.db!, body.name, body.statuses, body.enforceTransitions ?? false);
  await audit(req.db!, { actorId: req.user!.id, action: "workflow.created", entityType: "Workflow", entityId: wf.id });
  res.status(201).json({ workflow: await getWorkflowDetail(req.db!, wf.id) });
});

async function loadWorkflow(req: any) {
  const wf = await req.db!.workflow.findUnique({ where: { id: param(req.params.workflowId) } });
  if (!wf) throw notFound("Workflow");
  return wf;
}

workflowsRouter.get("/:workflowId", async (req, res) => {
  const wf = await loadWorkflow(req);
  res.json({ workflow: await getWorkflowDetail(req.db!, wf.id) });
});

workflowsRouter.patch("/:workflowId", requirePermission("workflow:manage"), async (req, res) => {
  const wf = await loadWorkflow(req);
  const body = parse(z.object({ name: z.string().min(1).max(80).optional(), enforceTransitions: z.boolean().optional() }), req.body);
  await req.db!.workflow.update({ where: { id: wf.id }, data: body });
  await audit(req.db!, { actorId: req.user!.id, action: "workflow.updated", entityType: "Workflow", entityId: wf.id, metadata: body });
  res.json({ workflow: await getWorkflowDetail(req.db!, wf.id) });
});

workflowsRouter.post("/:workflowId/statuses", requirePermission("workflow:manage"), async (req, res) => {
  const wf = await loadWorkflow(req);
  const body = parse(statusInput, req.body);
  const last = await req.db!.workflowStatus.findFirst({ where: { workflowId: wf.id }, orderBy: { position: "desc" } });
  const status = await req.db!.workflowStatus.create({
    data: { workflowId: wf.id, name: body.name, category: body.category, position: (last?.position ?? -1) + 1 } as any,
  });
  await audit(req.db!, { actorId: req.user!.id, action: "workflow.status_added", entityType: "Workflow", entityId: wf.id, metadata: { status: body.name } });
  res.status(201).json({ status });
});

workflowsRouter.patch("/:workflowId/statuses/:statusId", requirePermission("workflow:manage"), async (req, res) => {
  const wf = await loadWorkflow(req);
  const body = parse(z.object({ name: z.string().min(1).max(40).optional(), category: category.optional() }), req.body);
  const status = await req.db!.workflowStatus.findFirst({ where: { id: param(req.params.statusId), workflowId: wf.id } });
  if (!status) throw notFound("Status");
  const updated = await req.db!.workflowStatus.update({ where: { id: status.id }, data: body });
  await audit(req.db!, { actorId: req.user!.id, action: "workflow.status_updated", entityType: "Workflow", entityId: wf.id, metadata: { statusId: status.id, ...body } });
  res.json({ status: updated });
});

workflowsRouter.put("/:workflowId/statuses/order", requirePermission("workflow:manage"), async (req, res) => {
  const wf = await loadWorkflow(req);
  const body = parse(z.object({ statusIds: z.array(z.string()).min(1) }), req.body);
  const existing = await req.db!.workflowStatus.findMany({ where: { workflowId: wf.id } });
  const ids = new Set(existing.map((s) => s.id));
  if (body.statusIds.length !== ids.size || !body.statusIds.every((id) => ids.has(id))) {
    throw badRequest("statusIds must contain every status of this workflow exactly once");
  }
  await req.db!.$transaction(
    body.statusIds.map((id, position) => req.db!.workflowStatus.update({ where: { id }, data: { position } })),
  );
  res.json({ workflow: await getWorkflowDetail(req.db!, wf.id) });
});

workflowsRouter.delete("/:workflowId/statuses/:statusId", requirePermission("workflow:manage"), async (req, res) => {
  const wf = await loadWorkflow(req);
  const statusId = param(req.params.statusId);
  const status = await req.db!.workflowStatus.findFirst({ where: { id: statusId, workflowId: wf.id } });
  if (!status) throw notFound("Status");
  if ((await req.db!.workflowStatus.count({ where: { workflowId: wf.id } })) <= 1) throw badRequest("A workflow needs at least one status");
  const moveTo = typeof req.query.moveIssuesTo === "string" ? req.query.moveIssuesTo : undefined;
  const inUse = await req.db!.issue.count({ where: { statusId } });
  if (inUse > 0) {
    if (!moveTo) throw badRequest(`${inUse} issues use this status. Pass ?moveIssuesTo=<statusId>.`);
    const target = await req.db!.workflowStatus.findFirst({ where: { id: moveTo, workflowId: wf.id } });
    if (!target || target.id === statusId) throw badRequest("moveIssuesTo must be another status in this workflow");
    await req.db!.issue.updateMany({ where: { statusId }, data: { statusId: target.id } });
  }
  await req.db!.workflowStatus.delete({ where: { id: statusId } });
  await audit(req.db!, { actorId: req.user!.id, action: "workflow.status_deleted", entityType: "Workflow", entityId: wf.id, metadata: { status: status.name, movedTo: moveTo ?? null } });
  res.status(204).end();
});

/** Replace the full set of allowed transitions for a workflow. */
workflowsRouter.put("/:workflowId/transitions", requirePermission("workflow:manage"), async (req, res) => {
  const wf = await loadWorkflow(req);
  const body = parse(
    z.object({ transitions: z.array(z.object({ fromStatusId: z.string(), toStatusId: z.string() })).max(400) }),
    req.body,
  );
  const statuses = await req.db!.workflowStatus.findMany({ where: { workflowId: wf.id }, select: { id: true } });
  const ids = new Set(statuses.map((s) => s.id));
  for (const t of body.transitions) {
    if (!ids.has(t.fromStatusId) || !ids.has(t.toStatusId)) throw badRequest("Transitions must reference statuses in this workflow");
    if (t.fromStatusId === t.toStatusId) throw badRequest("A transition cannot loop to the same status");
  }
  const unique = [...new Map(body.transitions.map((t) => [`${t.fromStatusId}:${t.toStatusId}`, t])).values()];
  await req.db!.$transaction([
    req.db!.workflowTransition.deleteMany({ where: { workflowId: wf.id } }),
    req.db!.workflowTransition.createMany({ data: unique.map((t) => ({ ...t, workflowId: wf.id })) as any }),
  ]);
  await audit(req.db!, { actorId: req.user!.id, action: "workflow.transitions_updated", entityType: "Workflow", entityId: wf.id, metadata: { count: unique.length } });
  res.json({ workflow: await getWorkflowDetail(req.db!, wf.id) });
});
