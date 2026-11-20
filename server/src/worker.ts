import { Worker } from "bullmq";
import { prisma } from "./db/client.js";
import { QUEUE_NAME, getQueue, redisConnection, type JobName } from "./jobs/queue.js";
import { runJob } from "./jobs/handlers.js";

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    await runJob(job.name as JobName, job.data, {
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
    });
  },
  { connection: redisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) },
);

worker.on("completed", (job) => console.log(`[worker] ✓ ${job.name} ${job.id}`));
worker.on("failed", (job, err) =>
  console.warn(`[worker] ✗ ${job?.name} ${job?.id} attempt ${job?.attemptsMade}/${job?.opts.attempts}: ${err.message}`),
);

// Weekly project reports, Mondays 08:00 UTC.
await getQueue().upsertJobScheduler("weekly-reports", { pattern: "0 8 * * 1", tz: "UTC" }, { name: "report.weekly", data: {} });
console.log("[worker] started");

async function shutdown() {
  await worker.close();
  await getQueue().close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
