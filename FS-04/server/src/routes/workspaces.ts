import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { tenantDb } from "../db/tenant.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { canManageRole } from "../lib/permissions.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import { param, parse } from "../lib/validate.js";
import { loadWorkspace, requireAuth, requirePermission } from "../middleware/auth.js";
import { assertWithinPlan, getUsage } from "../services/billing.js";
import { createWorkflow } from "../services/workflow.js";
import { dispatchEvent } from "../jobs/webhooks.js";
import { projectsRouter } from "./projects.js";
import { workflowsRouter } from "./workflows.js";
import { issuesRouter } from "./issues.js";
import { sprintsRouter } from "./sprints.js";
import { adminRouter } from "./admin.js";
import { billingRouter } from "./billing.js";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "workspace";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3-40 chars: lowercase letters, numbers, dashes")
    .optional(),
});

workspacesRouter.get("/", async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.user!.id },
    include: { workspace: { select: { id: true, name: true, slug: true, plan: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })) });
});

workspacesRouter.post("/", async (req, res) => {
  const body = parse(createSchema, req.body);
  let slug = body.slug ?? slugify(body.name);
  if (await prisma.workspace.findUnique({ where: { slug } })) {
    if (body.slug) throw conflict("That workspace URL is taken");
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({ data: { name: body.name, slug } });
    await tx.membership.create({ data: { workspaceId: ws.id, userId: req.user!.id, role: "OWNER" } });
    return ws;
  });
  try {
    const db = tenantDb(workspace.id);
    await createWorkflow(db, "Default workflow");
    await audit(db, { actorId: req.user!.id, action: "workspace.created", entityType: "Workspace", entityId: workspace.id });
  } catch (err) {
    await prisma.workspace.delete({ where: { id: workspace.id } });
    throw err;
  }
  res.status(201).json({ workspace: { ...workspace, role: "OWNER" } });
});

// ---------- Everything below is scoped to one workspace ----------

const ws = Router({ mergeParams: true });
workspacesRouter.use("/:slug", loadWorkspace, ws);

ws.get("/", async (req, res) => {
  const usage = await getUsage(req.db!);
  res.json({
    workspace: req.workspace,
    role: req.membership!.role,
    usage,
    limits: PLAN_LIMITS[req.workspace!.plan],
  });
});

ws.patch("/", requirePermission("workspace:update"), async (req, res) => {
  const body = parse(z.object({ name: z.string().min(2).max(80) }), req.body);
  const updated = await prisma.workspace.update({ where: { id: req.workspace!.id }, data: { name: body.name } });
  await audit(req.db!, { actorId: req.user!.id, action: "workspace.updated", entityType: "Workspace", entityId: updated.id, metadata: { name: body.name } });
  res.json({ workspace: updated });
});

ws.delete("/", requirePermission("workspace:delete"), async (req, res) => {
  await prisma.workspace.delete({ where: { id: req.workspace!.id } });
  res.status(204).end();
});

// ---------- Members ----------

const roleEnum = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);

ws.get("/members", async (req, res) => {
  const members = await req.db!.membership.findMany({
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ members: members.map((m) => ({ ...m.user, role: m.role, joinedAt: m.createdAt })) });
});

ws.post("/members", requirePermission("member:manage"), async (req, res) => {
  const body = parse(z.object({ email: z.string().email().transform((e) => e.toLowerCase()), role: roleEnum.default("MEMBER") }), req.body);
  if (!canManageRole(req.membership!.role, "VIEWER", body.role)) throw forbidden("You cannot grant that role");
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) throw notFound("User with that email (they need to sign up first)");
  const existing = await req.db!.membership.findFirst({ where: { userId: user.id } });
  if (existing) throw conflict("That user is already a member");
  await assertWithinPlan(req.workspace!, req.db!, "members");
  await req.db!.membership.create({ data: { userId: user.id, role: body.role } as any });
  await audit(req.db!, { actorId: req.user!.id, action: "member.added", entityType: "User", entityId: user.id, metadata: { role: body.role } });
  await dispatchEvent(req.workspace!.id, "member.added", { userId: user.id, email: user.email, role: body.role });
  res.status(201).json({ member: { id: user.id, name: user.name, email: user.email, role: body.role } });
});

ws.patch("/members/:userId", requirePermission("member:manage"), async (req, res) => {
  const body = parse(z.object({ role: roleEnum }), req.body);
  const target = await req.db!.membership.findFirst({ where: { userId: param(req.params.userId) } });
  if (!target) throw notFound("Member");
  if (!canManageRole(req.membership!.role, target.role, body.role)) throw forbidden("You cannot change this member's role");
  if (target.role === "OWNER" && body.role !== "OWNER") {
    const owners = await req.db!.membership.count({ where: { role: "OWNER" } });
    if (owners <= 1) throw badRequest("A workspace needs at least one owner");
  }
  await req.db!.membership.update({ where: { id: target.id }, data: { role: body.role } });
  await audit(req.db!, {
    actorId: req.user!.id,
    action: "member.role_changed",
    entityType: "User",
    entityId: target.userId,
    metadata: { from: target.role, to: body.role },
  });
  res.json({ ok: true });
});

ws.delete("/members/:userId", async (req, res) => {
  const targetId = param(req.params.userId);
  const target = await req.db!.membership.findFirst({ where: { userId: targetId } });
  if (!target) throw notFound("Member");
  const self = targetId === req.user!.id;
  if (!self && !canManageRole(req.membership!.role, target.role)) throw forbidden();
  if (target.role === "OWNER") {
    const owners = await req.db!.membership.count({ where: { role: "OWNER" } });
    if (owners <= 1) throw badRequest("A workspace needs at least one owner");
  }
  await req.db!.membership.delete({ where: { id: target.id } });
  await req.db!.issue.updateMany({ where: { assigneeId: targetId }, data: { assigneeId: null } });
  await audit(req.db!, { actorId: req.user!.id, action: self ? "member.left" : "member.removed", entityType: "User", entityId: targetId });
  res.status(204).end();
});

ws.use("/projects", projectsRouter);
ws.use("/workflows", workflowsRouter);
ws.use("/issues", issuesRouter);
ws.use("/sprints", sprintsRouter);
ws.use("/billing", billingRouter);
ws.use("/", adminRouter);
