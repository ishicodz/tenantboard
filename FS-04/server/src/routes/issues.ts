import { Router, type Request } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { config } from "../config.js";
import { audit, diff } from "../lib/audit.js";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import { RANK_STEP, rankBetween } from "../lib/rank.js";
import { param, parse } from "../lib/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { assertWithinPlan } from "../services/billing.js";
import { assertTransition } from "../services/workflow.js";
import { ISSUE_AUDIT_FIELDS, issueInclude, serializeIssue } from "../services/issues.js";
import { dispatchEvent } from "../jobs/webhooks.js";
import { enqueue } from "../jobs/queue.js";
import type { TenantDb } from "../db/tenant.js";

export const issuesRouter = Router({ mergeParams: true });

const issueType = z.enum(["TASK", "BUG", "STORY", "EPIC"]);
const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

const createSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(250),
  description: z.string().max(20_000).optional(),
  type: issueType.optional(),
  priority: priority.optional(),
  statusId: z.string().optional(),
  sprintId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

const updateSchema = createSchema.omit({ projectId: true }).partial();

// ---------- helpers ----------

async function assertAssignee(db: TenantDb, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const m = await db.membership.findFirst({ where: { userId: assigneeId } });
  if (!m) throw badRequest("Assignee must be a member of this workspace");
}

async function assertSprint(db: TenantDb, projectId: string, sprintId: string | null | undefined) {
  if (!sprintId) return;
  const s = await db.sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!s) throw badRequest("Sprint not found in this project");
  if (s.state === "COMPLETED") throw badRequest("Cannot add issues to a completed sprint");
}

async function assertStatus(db: TenantDb, workflowId: string, statusId: string) {
  const s = await db.workflowStatus.findFirst({ where: { id: statusId, workflowId } });
  if (!s) throw badRequest("Status does not belong to this project's workflow");
  return s;
}

async function loadIssue(req: Request) {
  const ref = param(req.params.issueId);
  const keyMatch = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(ref);
  let issue;
  if (keyMatch) {
    const project = await req.db!.project.findFirst({ where: { key: keyMatch[1].toUpperCase() } });
    issue = project
      ? await req.db!.issue.findFirst({ where: { projectId: project.id, number: Number(keyMatch[2]) }, include: issueInclude })
      : null;
  } else {
    issue = await req.db!.issue.findUnique({ where: { id: ref }, include: issueInclude });
  }
  if (!issue) throw notFound("Issue");
  return issue;
}

async function rebalanceColumn(db: TenantDb, projectId: string, statusId: string, excludeId: string) {
  const col = await db.issue.findMany({
    where: { projectId, statusId, NOT: { id: excludeId } },
    orderBy: [{ rank: "asc" }, { number: "asc" }],
    select: { id: true },
  });
  await db.$transaction(col.map((c, idx) => db.issue.update({ where: { id: c.id }, data: { rank: (idx + 1) * RANK_STEP } })));
}

// ---------- list / create ----------

issuesRouter.get("/", async (req, res) => {
  const q = parse(
    z.object({
      projectId: z.string().optional(),
      sprintId: z.string().optional(),
      statusId: z.string().optional(),
      assigneeId: z.string().optional(),
      type: issueType.optional(),
      priority: priority.optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query,
  );
  const where = {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.sprintId ? { sprintId: q.sprintId === "backlog" ? null : q.sprintId } : {}),
    ...(q.statusId ? { statusId: q.statusId } : {}),
    ...(q.assigneeId ? { assigneeId: q.assigneeId === "unassigned" ? null : q.assigneeId } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" as const } }, { description: { contains: q.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, issues] = await Promise.all([
    req.db!.issue.count({ where }),
    req.db!.issue.findMany({
      where,
      include: issueInclude,
      orderBy: [{ rank: "asc" }, { number: "asc" }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
  ]);
  res.json({ issues: issues.map(serializeIssue), total, page: q.page, limit: q.limit });
});

issuesRouter.post("/", requirePermission("issue:write"), async (req, res) => {
  const body = parse(createSchema, req.body);
  const db = req.db!;
  const project = await db.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw badRequest("Project not found");
  await assertWithinPlan(req.workspace!, db, "issues");

  const status = body.statusId
    ? await assertStatus(db, project.workflowId, body.statusId)
    : await db.workflowStatus.findFirst({ where: { workflowId: project.workflowId }, orderBy: { position: "asc" } });
  if (!status) throw badRequest("Project workflow has no statuses");
  await assertSprint(db, project.id, body.sprintId);
  await assertAssignee(db, body.assigneeId);

  const created = await db.$transaction(async (tx) => {
    const { issueSeq } = await tx.project.update({ where: { id: project.id }, data: { issueSeq: { increment: 1 } } });
    const last = await tx.issue.findFirst({ where: { projectId: project.id, statusId: status.id }, orderBy: { rank: "desc" } });
    return tx.issue.create({
      data: {
        projectId: project.id,
        number: issueSeq,
        title: body.title,
        description: body.description,
        type: body.type,
        priority: body.priority,
        statusId: status.id,
        sprintId: body.sprintId ?? null,
        assigneeId: body.assigneeId ?? null,
        reporterId: req.user!.id,
        storyPoints: body.storyPoints ?? null,
        dueDate: body.dueDate ?? null,
        rank: (last?.rank ?? 0) + RANK_STEP,
        resolvedAt: status.category === "DONE" ? new Date() : null,
      } as any,
      include: issueInclude,
    });
  });

  const issue = serializeIssue(created);
  await audit(db, { actorId: req.user!.id, action: "issue.created", entityType: "Issue", entityId: issue.id, metadata: { key: issue.key, title: issue.title } });
  await dispatchEvent(req.workspace!.id, "issue.created", { issue });
  if (issue.assigneeId && issue.assigneeId !== req.user!.id) {
    await enqueue("notification.send", {
      workspaceId: req.workspace!.id,
      userIds: [issue.assigneeId],
      type: "issue.assigned",
      title: `${req.user!.name} assigned you ${issue.key}`,
      body: issue.title,
      issueId: issue.id,
    });
  }
  res.status(201).json({ issue });
});

// ---------- single issue ----------

issuesRouter.get("/:issueId", async (req, res) => {
  res.json({ issue: serializeIssue(await loadIssue(req)) });
});

issuesRouter.patch("/:issueId", requirePermission("issue:write"), async (req, res) => {
  const body = parse(updateSchema, req.body);
  const db = req.db!;
  const before = await loadIssue(req);
  const project = await db.project.findUniqueOrThrow({ where: { id: before.projectId } });

  const data: Record<string, unknown> = { ...body };
  if (body.statusId && body.statusId !== before.statusId) {
    const status = await assertStatus(db, project.workflowId, body.statusId);
    await assertTransition(db, project.workflowId, before.statusId, status.id);
    const last = await db.issue.findFirst({ where: { projectId: project.id, statusId: status.id }, orderBy: { rank: "desc" } });
    data.rank = (last?.rank ?? 0) + RANK_STEP;
    data.resolvedAt = status.category === "DONE" ? new Date() : null;
  }
  if (body.sprintId !== undefined) await assertSprint(db, project.id, body.sprintId);
  if (body.assigneeId !== undefined) await assertAssignee(db, body.assigneeId);

  const updated = await db.issue.update({ where: { id: before.id }, data, include: issueInclude });
  const changes = diff(before, updated, ISSUE_AUDIT_FIELDS);
  const issue = serializeIssue(updated);
  if (Object.keys(changes).length) {
    await audit(db, { actorId: req.user!.id, action: "issue.updated", entityType: "Issue", entityId: issue.id, metadata: { key: issue.key, changes } });
    await dispatchEvent(req.workspace!.id, "issue.updated", { issue, changes });
  }
  if (changes.assigneeId && updated.assigneeId && updated.assigneeId !== req.user!.id) {
    await enqueue("notification.send", {
      workspaceId: req.workspace!.id,
      userIds: [updated.assigneeId],
      type: "issue.assigned",
      title: `${req.user!.name} assigned you ${issue.key}`,
      body: issue.title,
      issueId: issue.id,
    });
  }
  res.json({ issue });
});

/**
 * Drag-and-drop endpoint. Moves an issue to `statusId`, positioned between
 * `beforeId` (card above) and `afterId` (card below). Both are optional.
 */
issuesRouter.post("/:issueId/move", requirePermission("issue:write"), async (req, res) => {
  const body = parse(
    z.object({ statusId: z.string(), beforeId: z.string().nullable().optional(), afterId: z.string().nullable().optional() }),
    req.body,
  );
  const db = req.db!;
  const issue = await loadIssue(req);
  const project = await db.project.findUniqueOrThrow({ where: { id: issue.projectId } });
  const status = await assertStatus(db, project.workflowId, body.statusId);
  await assertTransition(db, project.workflowId, issue.statusId, status.id);

  const neighbour = async (id?: string | null) => {
    if (!id) return null;
    const n = await db.issue.findFirst({ where: { id, projectId: project.id, statusId: status.id } });
    if (!n || n.id === issue.id) throw badRequest("beforeId/afterId must be other issues in the target column");
    return n;
  };

  let [before, after] = [await neighbour(body.beforeId), await neighbour(body.afterId)];
  let rank: number | null;
  if (!before && !after) {
    const last = await db.issue.findFirst({
      where: { projectId: project.id, statusId: status.id, NOT: { id: issue.id } },
      orderBy: { rank: "desc" },
    });
    rank = (last?.rank ?? 0) + RANK_STEP;
  } else {
    rank = rankBetween(before?.rank ?? null, after?.rank ?? null);
    if (rank === null) {
      await rebalanceColumn(db, project.id, status.id, issue.id);
      [before, after] = [await neighbour(body.beforeId), await neighbour(body.afterId)];
      rank = rankBetween(before?.rank ?? null, after?.rank ?? null) ?? RANK_STEP;
    }
  }

  const statusChanged = status.id !== issue.statusId;
  const updated = await db.issue.update({
    where: { id: issue.id },
    data: {
      statusId: status.id,
      rank,
      ...(statusChanged ? { resolvedAt: status.category === "DONE" ? new Date() : null } : {}),
    },
    include: issueInclude,
  });
  const out = serializeIssue(updated);
  if (statusChanged) {
    const changes = { statusId: { from: issue.statusId, to: status.id }, status: { from: issue.status.name, to: status.name } };
    await audit(db, { actorId: req.user!.id, action: "issue.moved", entityType: "Issue", entityId: issue.id, metadata: { key: out.key, changes } });
    await dispatchEvent(req.workspace!.id, "issue.moved", { issue: out, from: issue.status, to: out.status });
  }
  res.json({ issue: out });
});

issuesRouter.delete("/:issueId", requirePermission("issue:delete"), async (req, res) => {
  const issue = serializeIssue(await loadIssue(req));
  await req.db!.issue.delete({ where: { id: issue.id } });
  await audit(req.db!, { actorId: req.user!.id, action: "issue.deleted", entityType: "Issue", entityId: issue.id, metadata: { key: issue.key, title: issue.title } });
  await dispatchEvent(req.workspace!.id, "issue.deleted", { issue: { id: issue.id, key: issue.key, title: issue.title } });
  res.status(204).end();
});

issuesRouter.get("/:issueId/activity", async (req, res) => {
  const issue = await loadIssue(req);
  const entries = await req.db!.auditLog.findMany({
    where: { entityType: "Issue", entityId: issue.id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ activity: entries });
});

// ---------- comments ----------

issuesRouter.get("/:issueId/comments", async (req, res) => {
  const issue = await loadIssue(req);
  const comments = await req.db!.comment.findMany({
    where: { issueId: issue.id },
    include: { author: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ comments });
});

issuesRouter.post("/:issueId/comments", requirePermission("comment:write"), async (req, res) => {
  const body = parse(z.object({ body: z.string().trim().min(1).max(10_000) }), req.body);
  const issue = serializeIssue(await loadIssue(req));
  const comment = await req.db!.comment.create({
    data: { issueId: issue.id, authorId: req.user!.id, body: body.body } as any,
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  await audit(req.db!, { actorId: req.user!.id, action: "comment.created", entityType: "Issue", entityId: issue.id, metadata: { key: issue.key, commentId: comment.id } });
  await dispatchEvent(req.workspace!.id, "comment.created", { issueKey: issue.key, comment });
  const watchers = [issue.assigneeId, issue.reporterId].filter((u): u is string => !!u && u !== req.user!.id);
  if (watchers.length) {
    await enqueue("notification.send", {
      workspaceId: req.workspace!.id,
      userIds: watchers,
      type: "comment.created",
      title: `${req.user!.name} commented on ${issue.key}`,
      body: body.body.slice(0, 200),
      issueId: issue.id,
    });
  }
  res.status(201).json({ comment });
});

async function loadComment(req: Request) {
  const issue = await loadIssue(req);
  const comment = await req.db!.comment.findFirst({ where: { id: param(req.params.commentId), issueId: issue.id } });
  if (!comment) throw notFound("Comment");
  return { issue, comment };
}

issuesRouter.patch("/:issueId/comments/:commentId", requirePermission("comment:write"), async (req, res) => {
  const body = parse(z.object({ body: z.string().trim().min(1).max(10_000) }), req.body);
  const { issue, comment } = await loadComment(req);
  if (comment.authorId !== req.user!.id) throw forbidden("Only the author can edit a comment");
  const updated = await req.db!.comment.update({ where: { id: comment.id }, data: { body: body.body } });
  await audit(req.db!, { actorId: req.user!.id, action: "comment.updated", entityType: "Issue", entityId: issue.id, metadata: { commentId: comment.id } });
  res.json({ comment: updated });
});

issuesRouter.delete("/:issueId/comments/:commentId", async (req, res) => {
  const { issue, comment } = await loadComment(req);
  const own = comment.authorId === req.user!.id && can(req.membership!.role, "comment:write");
  if (!own && !can(req.membership!.role, "comment:moderate")) throw forbidden();
  await req.db!.comment.delete({ where: { id: comment.id } });
  await audit(req.db!, { actorId: req.user!.id, action: "comment.deleted", entityType: "Issue", entityId: issue.id, metadata: { commentId: comment.id } });
  res.status(204).end();
});

// ---------- attachments ----------

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.resolve(config.uploadDir, (req as Request).workspace!.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

issuesRouter.get("/:issueId/attachments", async (req, res) => {
  const issue = await loadIssue(req);
  const attachments = await req.db!.attachment.findMany({
    where: { issueId: issue.id },
    include: { uploader: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ attachments });
});

issuesRouter.post("/:issueId/attachments", requirePermission("attachment:write"), upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest("Send the file in a multipart field named 'file'");
  const maxMb = PLAN_LIMITS[req.workspace!.plan].maxAttachmentMb;
  if (file.size > maxMb * 1024 * 1024) {
    fs.rmSync(file.path, { force: true });
    throw new AppError(413, "FILE_TOO_LARGE", `Your plan allows attachments up to ${maxMb} MB`);
  }
  let issue;
  try {
    issue = serializeIssue(await loadIssue(req));
  } catch (e) {
    fs.rmSync(file.path, { force: true });
    throw e;
  }
  const attachment = await req.db!.attachment.create({
    data: {
      issueId: issue.id,
      uploaderId: req.user!.id,
      filename: file.originalname.slice(0, 255),
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size,
      storageKey: path.join(req.workspace!.id, file.filename),
    } as any,
  });
  await audit(req.db!, { actorId: req.user!.id, action: "attachment.added", entityType: "Issue", entityId: issue.id, metadata: { key: issue.key, filename: attachment.filename, size: attachment.size } });
  res.status(201).json({ attachment });
});

async function loadAttachment(req: Request) {
  const issue = await loadIssue(req);
  const a = await req.db!.attachment.findFirst({ where: { id: param(req.params.attachmentId), issueId: issue.id } });
  if (!a) throw notFound("Attachment");
  return { issue, attachment: a };
}

issuesRouter.get("/:issueId/attachments/:attachmentId/download", async (req, res) => {
  const { attachment } = await loadAttachment(req);
  const full = path.resolve(config.uploadDir, attachment.storageKey);
  if (!fs.existsSync(full)) throw notFound("File");
  res.setHeader("Content-Type", attachment.mimeType);
  res.download(full, attachment.filename);
});

issuesRouter.delete("/:issueId/attachments/:attachmentId", async (req, res) => {
  const { issue, attachment } = await loadAttachment(req);
  const own = attachment.uploaderId === req.user!.id && can(req.membership!.role, "attachment:write");
  if (!own && !can(req.membership!.role, "issue:delete")) throw forbidden();
  await req.db!.attachment.delete({ where: { id: attachment.id } });
  fs.rmSync(path.resolve(config.uploadDir, attachment.storageKey), { force: true });
  await audit(req.db!, { actorId: req.user!.id, action: "attachment.removed", entityType: "Issue", entityId: issue.id, metadata: { filename: attachment.filename } });
  res.status(204).end();
});
