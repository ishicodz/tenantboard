import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { param, parse } from "../lib/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { assertWithinPlan } from "../services/billing.js";
import { getWorkflowDetail } from "../services/workflow.js";
import { issueInclude, serializeIssue } from "../services/issues.js";

export const projectsRouter = Router({ mergeParams: true });

const createSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/, "2-10 letters/numbers, starting with a letter")
    .transform((k) => k.toUpperCase()),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  workflowId: z.string().optional(),
});

projectsRouter.get("/", async (req, res) => {
  const projects = await req.db!.project.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { issues: true } }, boards: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } },
  });
  res.json({ projects: projects.map(({ _count, ...p }) => ({ ...p, issueCount: _count.issues })) });
});

projectsRouter.post("/", requirePermission("project:manage"), async (req, res) => {
  const body = parse(createSchema, req.body);
  await assertWithinPlan(req.workspace!, req.db!, "projects");
  const workflow = body.workflowId
    ? await req.db!.workflow.findUnique({ where: { id: body.workflowId } })
    : await req.db!.workflow.findFirst({ orderBy: { createdAt: "asc" } });
  if (!workflow) throw badRequest("Workflow not found");
  const project = await req.db!.project.create({
    data: { key: body.key, name: body.name, description: body.description, workflowId: workflow.id } as any,
  });
  await req.db!.board.create({ data: { projectId: project.id, name: `${project.key} board` } as any });
  await audit(req.db!, { actorId: req.user!.id, action: "project.created", entityType: "Project", entityId: project.id, metadata: { key: project.key } });
  res.status(201).json({ project });
});

async function loadProject(req: any) {
  const project = await req.db!.project.findUnique({ where: { id: param(req.params.projectId) } });
  if (!project) throw notFound("Project");
  return project;
}

projectsRouter.get("/:projectId", async (req, res) => {
  const project = await loadProject(req);
  const [workflow, boards] = await Promise.all([
    getWorkflowDetail(req.db!, project.workflowId),
    req.db!.board.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
  ]);
  res.json({ project, workflow, boards });
});

projectsRouter.patch("/:projectId", requirePermission("project:manage"), async (req, res) => {
  const project = await loadProject(req);
  const body = parse(
    z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(2000).nullable().optional(), workflowId: z.string().optional() }),
    req.body,
  );
  if (body.workflowId && body.workflowId !== project.workflowId) {
    const wf = await req.db!.workflow.findUnique({ where: { id: body.workflowId } });
    if (!wf) throw badRequest("Workflow not found");
    if ((await req.db!.issue.count({ where: { projectId: project.id } })) > 0) {
      throw badRequest("Cannot switch workflow on a project that already has issues");
    }
  }
  const updated = await req.db!.project.update({ where: { id: project.id }, data: body });
  await audit(req.db!, { actorId: req.user!.id, action: "project.updated", entityType: "Project", entityId: project.id, metadata: body });
  res.json({ project: updated });
});

projectsRouter.delete("/:projectId", requirePermission("project:manage"), async (req, res) => {
  const project = await loadProject(req);
  await req.db!.project.delete({ where: { id: project.id } });
  await audit(req.db!, { actorId: req.user!.id, action: "project.deleted", entityType: "Project", entityId: project.id, metadata: { key: project.key } });
  res.status(204).end();
});

// ---------- Boards ----------

projectsRouter.get("/:projectId/boards", async (req, res) => {
  const project = await loadProject(req);
  res.json({ boards: await req.db!.board.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }) });
});

projectsRouter.post("/:projectId/boards", requirePermission("project:manage"), async (req, res) => {
  const project = await loadProject(req);
  const body = parse(z.object({ name: z.string().min(1).max(80) }), req.body);
  const board = await req.db!.board.create({ data: { projectId: project.id, name: body.name } as any });
  await audit(req.db!, { actorId: req.user!.id, action: "board.created", entityType: "Board", entityId: board.id });
  res.status(201).json({ board });
});

/**
 * Kanban view: one column per workflow status, issues ordered by rank.
 * Optional filters: sprintId ("active" resolves to the running sprint, "backlog" = no sprint), assigneeId, q.
 */
projectsRouter.get("/:projectId/boards/:boardId", async (req, res) => {
  const project = await loadProject(req);
  const board = await req.db!.board.findFirst({ where: { id: param(req.params.boardId), projectId: project.id } });
  if (!board) throw notFound("Board");
  const q = parse(
    z.object({ sprintId: z.string().optional(), assigneeId: z.string().optional(), q: z.string().max(200).optional() }),
    req.query,
  );

  let sprintFilter: { sprintId?: string | null } = {};
  let activeSprint = await req.db!.sprint.findFirst({ where: { projectId: project.id, state: "ACTIVE" } });
  if (q.sprintId === "active") sprintFilter = activeSprint ? { sprintId: activeSprint.id } : {};
  else if (q.sprintId === "backlog") sprintFilter = { sprintId: null };
  else if (q.sprintId) sprintFilter = { sprintId: q.sprintId };

  const statuses = await req.db!.workflowStatus.findMany({ where: { workflowId: project.workflowId }, orderBy: { position: "asc" } });
  const issues = await req.db!.issue.findMany({
    where: {
      projectId: project.id,
      ...sprintFilter,
      ...(q.assigneeId ? { assigneeId: q.assigneeId === "unassigned" ? null : q.assigneeId } : {}),
      ...(q.q ? { title: { contains: q.q, mode: "insensitive" as const } } : {}),
    },
    include: issueInclude,
    orderBy: [{ rank: "asc" }, { number: "asc" }],
  });
  const workflow = await getWorkflowDetail(req.db!, project.workflowId);
  res.json({
    board,
    project,
    activeSprint,
    workflow,
    columns: statuses.map((s) => ({ status: s, issues: issues.filter((i) => i.statusId === s.id).map(serializeIssue) })),
  });
});
