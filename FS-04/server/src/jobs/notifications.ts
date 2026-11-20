import { prisma } from "../db/client.js";
import { tenantDb } from "../db/tenant.js";
import type { JobPayloads } from "./queue.js";
import { config } from "../config.js";

/**
 * Email transport stub. Swap for SES/Postmark/SMTP in production; the job
 * contract stays the same. In-app notifications are always persisted.
 */
async function sendEmail(to: string, subject: string, text: string) {
  if (!config.isTest) console.log(`[email] to=${to} subject="${subject}" ${text ? `body="${text.slice(0, 80)}"` : ""}`);
}

export async function sendNotifications(p: JobPayloads["notification.send"]) {
  const userIds = [...new Set(p.userIds)];
  if (userIds.length === 0) return;
  const db = tenantDb(p.workspaceId);

  // Only notify users who are still members of this workspace.
  const members = await db.membership.findMany({ where: { userId: { in: userIds } }, select: { userId: true } });
  const allowed = members.map((m) => m.userId);
  if (allowed.length === 0) return;

  await db.notification.createMany({
    data: allowed.map((userId) => ({
      userId,
      type: p.type,
      title: p.title,
      body: p.body ?? null,
      issueId: p.issueId ?? null,
    })) as any,
  });

  const users = await prisma.user.findMany({ where: { id: { in: allowed } }, select: { email: true } });
  await Promise.all(users.map((u) => sendEmail(u.email, p.title, p.body ?? "")));
}
