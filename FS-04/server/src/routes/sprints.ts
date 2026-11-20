import { Router, type Request } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { param, parse } from "../lib/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { dispatchEvent } from "../jobs/webhooks.js";
import { enqueue } from "../jobs/queue.js";

export const sprintsRouter = Router({ mergeParams: true });

const dates = {
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
};

sprintsRouter.get("/", async (req, res) => {
  const q = parse(z.object({ projectId: z.string().optional(), state: z.enum(["PLANNED", "ACTIVE", "COMPLETED"]).optional() }), req.query);
  const sprints = await req.db!.sprint.findMany({
    where: { ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.state ? { state: q.state } : {}) },
    include: { issues: { select: { storyPoints: true, status: { select: { category: true } } } } },
    orderBy: [{ createdAt: "asc" }],
  });
  res.json({
    sprints: sprints.map(({ issues, ...s }) => ({
      ...s,
      issueCount: issues.length,
      doneCount: issues.filter((i) => i.status.category === "DONE").length,
      points: issues.reduce((a, i) => a + (i.storyPoints ?? 0), 0),
    })),
  });
});

sprintsRouter.post("/", requirePermission("sprint:manage"), async (req, res) => {
  const body = parse(z.object({ projectId: z.string(), name: z.string().min(1).max(80), goal: z.string().max(500).optional(), ...dates }), req.body);
  const project = await req.db!.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw badRequest("Project not found");
  if (body.startDate && body.endDate && body.endDate <= body.startDate) throw badRequest("endDate must be after startDate");
  const sprint = await req.db!.sprint.create({ data: body as any });
  await audit(req.db!, { actorId: req.user!.id, action: "sprint.created", entityType: "Sprint", entityId: sprint.id, metadata: { name: sprint.name } });
  res.status(201).json({ sprint });
});

async function loadSprint(req: Request) {
  const s = await req.db!.sprint.findUnique({ where: { id: param(req.params.sprintId) } });
  if (!s) throw notFound("Sprint");
  return s;
}

sprintsRouter.patch("/:sprintId", requirePermission("sprint:manage"), async (req, res) => {
  const sprint = await loadSprint(req);
  const body = parse(z.object({ name: z.string().min(1).max(80).optional(), goal: z.string().max(500).nullable().optional(), ...dates }), req.body);
  const updated = await req.db!.sprint.update({ where: { id: sprint.id }, data: body });
  await audit(req.db!, { actorId: req.user!.id, action: "sprint.updated", entityType: "Sprint", entityId: sprint.id, metadata: body });
  res.json({ sprint: updated });
});

sprintsRouter.post("/:sprintId/issues", requirePermission("sprint:manage"), async (req, res) => {
  const sprint = await loadSprint(req);
  if (sprint.state === "COMPLETED") throw badRequest("Sprint is completed");
  const body = parse(z.object({ issueIds: z.array(z.string()).min(1).max(500) }), req.body);
  const result = await req.db!.issue.updateMany({
    where: { id: { in: body.issueIds }, projectId: sprint.projectId },
    data: { sprintId: sprint.id },
  });
  await audit(req.db!, { actorId: req.user!.id, action: "sprint.issues_added", entityType: "Sprint", entityId: sprint.id, metadata: { count: result.count } });
  res.json({ updated: result.count });
});

sprintsRouter.post("/:sprintId/start", requirePermission("sprint:manage"), async (req, res) => {
  const sprint = await loadSprint(req);
  if (sprint.state !== "PLANNED") throw badRequest("Only planned sprints can be started");
  const active = await req.db!.sprint.findFirst({ where: { projectId: sprint.projectId, state: "ACTIVE" } });
  if (active) throw badRequest(`Sprint "${active.name}" is already active in this project`);
  const startDate = sprint.startDate ?? new Date();
  const endDate = sprint.endDate ?? new Date(startDate.getTime() + 14 * 24 * 3600 * 1000);
  const updated = await req.db!.sprint.update({ where: { id: sprint.id }, data: { state: "ACTIVE", startDate, endDate } });
  await audit(req.db!, { actorId: req.user!.id, action: "sprint.started", entityType: "Sprint", entityId: sprint.id, metadata: { name: sprint.name } });
  await dispatchEvent(req.workspace!.id, "sprint.started", { sprint: updated });
  res.json({ sprint: updated });
});

/**
 * Completes the sprint. Unfinished issues go to the backlog, or to
 * `moveOpenIssuesTo` (another planned sprint). A sprint report is generated
 * in the background.
 */
sprintsRouter.post("/:sprintId/complete", requirePermission("sprint:manage"), async (req, res) => {
  const sprint = await loadSprint(req);
  if (sprint.state !== "ACTIVE") throw badRequest("Only the active sprint can be completed");
  const body = parse(z.object({ moveOpenIssuesTo: z.string().nullable().optional() }), req.body ?? {});
  if (body.moveOpenIssuesTo) {
    const target = await req.db!.sprint.findFirst({ where: { id: body.moveOpenIssuesTo, projectId: sprint.projectId, state: "PLANNED" } });
    if (!target) throw badRequest("moveOpenIssuesTo must be a planned sprint in the same project");
  }
  const open = await req.db!.issue.updateMany({
    where: { sprintId: sprint.id, status: { category: { not: "DONE" } } },
    data: { sprintId: body.moveOpenIssuesTo ?? null },
  });
  const updated = await req.db!.sprint.update({ where: { id: sprint.id }, data: { state: "COMPLETED", completedAt: new Date() } });
  const report = await req.db!.report.create({
    data: { projectId: sprint.projectId, sprintId: sprint.id, type: "sprint", requestedById: req.user!.id } as any,
  });
  await audit(req.db!, { actorId: req.user!.id, action: "sprint.completed", entityType: "Sprint", entityId: sprint.id, metadata: { name: sprint.name, movedOpenIssues: open.count } });
  await dispatchEvent(req.workspace!.id, "sprint.completed", { sprint: updated, movedOpenIssues: open.count });
  await enqueue("report.generate", { reportId: report.id });
  res.json({ sprint: updated, movedOpenIssues: open.count, reportId: report.id });
});

sprintsRouter.delete("/:sprintId", requirePermission("sprint:manage"), async (req, res) => {
  const sprint = await loadSprint(req);
  if (sprint.state === "ACTIVE") throw badRequest("Complete the sprint before deleting it");
  await req.db!.sprint.delete({ where: { id: sprint.id } });
  await audit(req.db!, { actorId: req.user!.id, action: "sprint.deleted", entityType: "Sprint", entityId: sprint.id, metadata: { name: sprint.name } });
  res.status(204).end();
});
