import { Router, type Request } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { param, parse } from "../lib/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { assertWithinPlan } from "../services/billing.js";
import { WEBHOOK_EVENTS, dispatchEvent, isAllowedWebhookUrl } from "../jobs/webhooks.js";
import { enqueue } from "../jobs/queue.js";
import { reportToCsv, type ReportData } from "../jobs/reports.js";

/** Audit log, webhooks, notifications, reports. Mounted at /api/workspaces/:slug */
export const adminRouter = Router({ mergeParams: true });

// ---------- Audit log ----------

adminRouter.get("/audit-logs", requirePermission("audit:read"), async (req, res) => {
  const q = parse(
    z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      actorId: z.string().optional(),
      action: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query,
  );
  const entries = await req.db!.auditLog.findMany({
    where: {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
    },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = entries.length > q.limit;
  const page = entries.slice(0, q.limit);
  res.json({ entries: page, nextCursor: hasMore ? page[page.length - 1].id : null });
});

// ---------- Webhooks ----------

const webhookEvents = z.array(z.enum([...WEBHOOK_EVENTS, "*"] as [string, ...string[]])).min(1);
const publicHook = <T extends { secret: string }>(h: T) => ({ ...h, secret: `${h.secret.slice(0, 10)}…` });

adminRouter.get("/webhooks", requirePermission("webhook:manage"), async (req, res) => {
  const hooks = await req.db!.webhook.findMany({ orderBy: { createdAt: "asc" } });
  res.json({ webhooks: hooks.map(publicHook), availableEvents: WEBHOOK_EVENTS });
});

adminRouter.post("/webhooks", requirePermission("webhook:manage"), async (req, res) => {
  const body = parse(z.object({ url: z.string().url(), events: webhookEvents }), req.body);
  if (!isAllowedWebhookUrl(body.url)) throw badRequest("Webhook URL must be a public https URL");
  await assertWithinPlan(req.workspace!, req.db!, "webhooks");
  const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const hook = await req.db!.webhook.create({ data: { url: body.url, events: body.events, secret } as any });
  await audit(req.db!, { actorId: req.user!.id, action: "webhook.created", entityType: "Webhook", entityId: hook.id, metadata: { url: body.url } });
  // Full secret is returned once, at creation time.
  res.status(201).json({ webhook: hook });
});

async function loadHook(req: Request) {
  const h = await req.db!.webhook.findUnique({ where: { id: param(req.params.webhookId) } });
  if (!h) throw notFound("Webhook");
  return h;
}

adminRouter.patch("/webhooks/:webhookId", requirePermission("webhook:manage"), async (req, res) => {
  const hook = await loadHook(req);
  const body = parse(z.object({ url: z.string().url().optional(), events: webhookEvents.optional(), active: z.boolean().optional() }), req.body);
  if (body.url && !isAllowedWebhookUrl(body.url)) throw badRequest("Webhook URL must be a public https URL");
  const updated = await req.db!.webhook.update({ where: { id: hook.id }, data: body });
  await audit(req.db!, { actorId: req.user!.id, action: "webhook.updated", entityType: "Webhook", entityId: hook.id, metadata: body });
  res.json({ webhook: publicHook(updated) });
});

adminRouter.delete("/webhooks/:webhookId", requirePermission("webhook:manage"), async (req, res) => {
  const hook = await loadHook(req);
  await req.db!.webhook.delete({ where: { id: hook.id } });
  await audit(req.db!, { actorId: req.user!.id, action: "webhook.deleted", entityType: "Webhook", entityId: hook.id });
  res.status(204).end();
});

adminRouter.post("/webhooks/:webhookId/test", requirePermission("webhook:manage"), async (req, res) => {
  const hook = await loadHook(req);
  await dispatchEvent(req.workspace!.id, "webhook.test", { message: "Hello from TenantBoard" }, hook.id);
  res.status(202).json({ queued: true });
});

adminRouter.get("/webhooks/:webhookId/deliveries", requirePermission("webhook:manage"), async (req, res) => {
  const hook = await loadHook(req);
  const deliveries = await req.db!.webhookDelivery.findMany({
    where: { webhookId: hook.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ deliveries });
});

adminRouter.post("/webhooks/:webhookId/deliveries/:deliveryId/redeliver", requirePermission("webhook:manage"), async (req, res) => {
  const hook = await loadHook(req);
  const d = await req.db!.webhookDelivery.findFirst({ where: { id: param(req.params.deliveryId), webhookId: hook.id } });
  if (!d) throw notFound("Delivery");
  await req.db!.webhookDelivery.update({ where: { id: d.id }, data: { status: "PENDING" } });
  await enqueue("webhook.deliver", { deliveryId: d.id });
  res.status(202).json({ queued: true });
});

// ---------- Notifications (current user) ----------

adminRouter.get("/notifications", async (req, res) => {
  const unreadOnly = req.query.unread === "true";
  const where = { userId: req.user!.id, ...(unreadOnly ? { readAt: null } : {}) };
  const [items, unread] = await Promise.all([
    req.db!.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
    req.db!.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ notifications: items, unread });
});

adminRouter.post("/notifications/read-all", async (req, res) => {
  const r = await req.db!.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});

adminRouter.post("/notifications/:notificationId/read", async (req, res) => {
  const r = await req.db!.notification.updateMany({
    where: { id: param(req.params.notificationId), userId: req.user!.id },
    data: { readAt: new Date() },
  });
  if (r.count === 0) throw notFound("Notification");
  res.json({ ok: true });
});

// ---------- Reports ----------

adminRouter.get("/reports", async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const reports = await req.db!.report.findMany({
    where: projectId ? { projectId } : {},
    select: { id: true, projectId: true, sprintId: true, type: true, status: true, createdAt: true, completedAt: true, sprint: { select: { name: true } }, project: { select: { key: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ reports });
});

adminRouter.post("/reports", requirePermission("report:manage"), async (req, res) => {
  const body = parse(z.object({ projectId: z.string(), sprintId: z.string().nullable().optional() }), req.body);
  const project = await req.db!.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw badRequest("Project not found");
  if (body.sprintId && !(await req.db!.sprint.findFirst({ where: { id: body.sprintId, projectId: project.id } }))) {
    throw badRequest("Sprint not found in project");
  }
  const report = await req.db!.report.create({
    data: { projectId: project.id, sprintId: body.sprintId ?? null, type: body.sprintId ? "sprint" : "project", requestedById: req.user!.id } as any,
  });
  await enqueue("report.generate", { reportId: report.id });
  res.status(202).json({ report: await req.db!.report.findUnique({ where: { id: report.id } }) });
});

adminRouter.get("/reports/:reportId", async (req, res) => {
  const report = await req.db!.report.findUnique({ where: { id: param(req.params.reportId) } });
  if (!report) throw notFound("Report");
  res.json({ report });
});

adminRouter.get("/reports/:reportId/csv", async (req, res) => {
  const report = await req.db!.report.findUnique({ where: { id: param(req.params.reportId) } });
  if (!report) throw notFound("Report");
  if (report.status !== "COMPLETED" || !report.data) throw badRequest("Report is not ready yet");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="report-${report.id}.csv"`);
  res.send(reportToCsv(report.data as unknown as ReportData));
});
