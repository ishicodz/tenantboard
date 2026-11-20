import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db/client.js";
import { CollabServer } from "./collab/server.js";

/** One process serves both REST (/api) and WebSockets (/collab/:pageId). Run several behind a load balancer; Redis keeps them in sync. */
export function startServer(port = config.port, redisUrl = config.redisUrl) {
  const collab = new CollabServer(redisUrl);
  const server = http.createServer(createApp(collab));
  collab.attach(server);
  return new Promise<{ server: http.Server; collab: CollabServer; port: number }>((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      resolve({ server, collab, port: typeof addr === "object" && addr ? addr.port : port });
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  const { server, collab, port } = await startServer();
  console.log(`[${config.instanceName}] listening on :${port} (redis: ${collab.bus.enabled ? "on" : "off"})`);
  const shutdown = async () => {
    server.close();
    await collab.close(); // flushes every open document to Postgres
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}
