function bool(v: string | undefined, fallback = false) {
  if (v === undefined) return fallback;
  return ["1", "true", "yes"].includes(v.toLowerCase());
}

const env = process.env;
const isTest = env.NODE_ENV === "test";

export const config = {
  env: env.NODE_ENV ?? "development",
  isTest,
  isProd: env.NODE_ENV === "production",
  port: Number(env.PORT ?? 4000),
  jwtSecret: env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5173",
  appUrl: env.APP_URL ?? "http://localhost:5173",
  uploadDir: env.UPLOAD_DIR ?? "./uploads",
  // "inline" runs jobs in-process (tests, simple dev). "bullmq" uses Redis + worker.
  jobsMode: (env.JOBS_MODE ?? (env.REDIS_URL ? "bullmq" : "inline")) as "inline" | "bullmq",
  redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
  webhookAllowPrivate: bool(env.WEBHOOK_ALLOW_PRIVATE, !(env.NODE_ENV === "production")),
  webhookTimeoutMs: Number(env.WEBHOOK_TIMEOUT_MS ?? 10_000),
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
    pricePro: env.STRIPE_PRICE_PRO ?? "",
    priceBusiness: env.STRIPE_PRICE_BUSINESS ?? "",
  },
  // Lets you flip plans without Stripe in local demos. Never enable in production.
  allowDevBilling: bool(env.ALLOW_DEV_BILLING, false),
};

if (config.isProd && config.jwtSecret === "dev-only-secret-change-me") {
  throw new Error("JWT_SECRET must be set in production");
}
