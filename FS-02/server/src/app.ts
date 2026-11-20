import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { prisma } from "./db/client.js";
import { authRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { pagesRouter } from "./routes/pages.js";
import { errorHandler } from "./middleware/error.js";
import type { CollabServer } from "./collab/server.js";

export function createApp(collab: CollabServer) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(",") }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, instance: config.instanceName, redis: collab.bus.enabled, rooms: await collab.stats() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/pages", pagesRouter(collab));
  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}
