import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db/client.js";
import { closeQueue } from "./jobs/queue.js";

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[api] listening on :${config.port} (jobs: ${config.jobsMode})`);
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close();
  await closeQueue();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
