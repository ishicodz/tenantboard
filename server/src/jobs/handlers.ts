import type { JobContext, JobName, JobPayloads } from "./queue.js";
import { deliverWebhook } from "./webhooks.js";
import { sendNotifications } from "./notifications.js";
import { generateReport, generateWeeklyReports } from "./reports.js";

export async function runJob<N extends JobName>(name: N, data: JobPayloads[N], ctx: JobContext): Promise<void> {
  switch (name) {
    case "webhook.deliver":
      return deliverWebhook(data as JobPayloads["webhook.deliver"], ctx);
    case "notification.send":
      return sendNotifications(data as JobPayloads["notification.send"]);
    case "report.generate":
      return generateReport(data as JobPayloads["report.generate"]);
    case "report.weekly":
      return generateWeeklyReports();
    default:
      throw new Error(`Unknown job: ${String(name)}`);
  }
}
