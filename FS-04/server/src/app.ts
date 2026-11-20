import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { prisma } from "./db/client.js";
import { authRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { stripeWebhookHandler } from "./routes/billing.js";
import { errorHandler } from "./middleware/error.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(","), credentials: true }));

  // Stripe needs the raw body for signature verification, so this route is
  // registered before the JSON parser.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhookHandler);

  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, jobsMode: config.jobsMode });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/workspaces", workspacesRouter);

  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}
