import crypto from "node:crypto";
import { prisma } from "../db/client.js";
import { tenantDb } from "../db/tenant.js";
import { config } from "../config.js";
import { enqueue, type JobContext } from "./queue.js";

export const WEBHOOK_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.moved",
  "issue.deleted",
  "comment.created",
  "sprint.started",
  "sprint.completed",
  "member.added",
  "webhook.test",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function signPayload(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Consumer-side helper (also used in tests): verifies `t=...,v1=...` header. */
export function verifySignature(secret: string, header: string, body: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = signPayload(secret, t, body);
  if (expected.length !== parts.v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

const PRIVATE_HOST = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
];

export function isAllowedWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  if (config.webhookAllowPrivate) return true;
  if (u.protocol !== "https:") return false;
  return !PRIVATE_HOST.some((re) => re.test(u.hostname));
}

/**
 * Fan an event out to every active webhook in the workspace subscribed to it.
 * Creates one delivery row per webhook and enqueues a delivery job for each.
 */
export async function dispatchEvent(workspaceId: string, event: WebhookEvent, data: unknown, onlyWebhookId?: string) {
  const db = tenantDb(workspaceId);
  const hooks = await db.webhook.findMany({
    where: onlyWebhookId ? { id: onlyWebhookId } : { active: true, OR: [{ events: { has: event } }, { events: { has: "*" } }] },
  });
  for (const hook of hooks) {
    const delivery = await db.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        event,
        payload: { event, workspaceId, occurredAt: new Date().toISOString(), data } as object,
      } as any,
    });
    await enqueue("webhook.deliver", { deliveryId: delivery.id });
  }
  return hooks.length;
}

export async function deliverWebhook({ deliveryId }: { deliveryId: string }, ctx: JobContext) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!delivery || delivery.status === "SUCCESS") return;

  const body = JSON.stringify({ id: delivery.id, ...(delivery.payload as object) });
  const ts = Math.floor(Date.now() / 1000);
  const signature = signPayload(delivery.webhook.secret, ts, body);
  let responseCode: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(delivery.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "TenantBoard-Webhooks/1.0",
        "x-tenantboard-event": delivery.event,
        "x-tenantboard-delivery": delivery.id,
        "x-tenantboard-signature": `t=${ts},v1=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(config.webhookTimeoutMs),
    });
    responseCode = res.status;
    if (!res.ok) error = `Non-2xx response: ${res.status}`;
  } catch (e: any) {
    error = e?.name === "TimeoutError" ? "Timed out" : (e?.message ?? "Request failed");
  }

  const isFinal = !error || ctx.attempt >= ctx.maxAttempts;
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts: { increment: 1 },
      responseCode,
      lastError: error,
      status: !error ? "SUCCESS" : isFinal ? "FAILED" : "PENDING",
      deliveredAt: !error ? new Date() : null,
    },
  });

  // Throwing lets BullMQ schedule the next retry with exponential backoff.
  if (error && !isFinal) throw new Error(error);
}
