import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { config } from "../config.js";

export const QUEUE_NAME = "tenantboard";

export interface JobPayloads {
  "webhook.deliver": { deliveryId: string };
  "notification.send": {
    workspaceId: string;
    userIds: string[];
    type: string;
    title: string;
    body?: string;
    issueId?: string;
  };
  "report.generate": { reportId: string };
  "report.weekly": Record<string, never>;
}
export type JobName = keyof JobPayloads;

export interface JobContext {
  attempt: number;
  maxAttempts: number;
}

const DEFAULT_OPTS: Record<JobName, JobsOptions> = {
  "webhook.deliver": { attempts: 6, backoff: { type: "exponential", delay: 10_000 } },
  "notification.send": { attempts: 3, backoff: { type: "exponential", delay: 5_000 } },
  "report.generate": { attempts: 2, backoff: { type: "fixed", delay: 30_000 } },
  "report.weekly": { attempts: 1 },
};

export function redisConnection(): ConnectionOptions {
  const u = new URL(config.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

let queue: Queue | null = null;
export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
    });
  }
  return queue;
}

/**
 * Enqueue a background job. In "inline" mode the job runs in-process
 * (awaited in tests for determinism, fire-and-forget otherwise), with a
 * single attempt. In "bullmq" mode it goes to Redis and the worker picks it up.
 */
export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: JobsOptions = {}) {
  if (config.jobsMode === "bullmq") {
    await getQueue().add(name, data, { ...DEFAULT_OPTS[name], ...opts });
    return;
  }
  const { runJob } = await import("./handlers.js");
  const run = runJob(name, data, { attempt: 1, maxAttempts: 1 }).catch((err) => {
    if (!config.isTest) console.error(`[jobs] inline job ${name} failed:`, err?.message ?? err);
  });
  if (config.isTest) await run;
}

export async function closeQueue() {
  if (queue) await queue.close();
  queue = null;
}
