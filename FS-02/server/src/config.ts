const env = process.env;

export const config = {
  env: env.NODE_ENV ?? "development",
  isTest: env.NODE_ENV === "test",
  isProd: env.NODE_ENV === "production",
  port: Number(env.PORT ?? 4100),
  jwtSecret: env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5174",
  /** Empty string disables Redis (single-instance mode). */
  redisUrl: env.REDIS_URL ?? "",
  /** Debounce before a live document is written to Postgres. */
  persistDebounceMs: Number(env.PERSIST_DEBOUNCE_MS ?? 1500),
  persistMaxWaitMs: Number(env.PERSIST_MAX_WAIT_MS ?? 10_000),
  /** Minimum gap between automatic version snapshots of a page. */
  autoSnapshotIntervalMs: Number(env.AUTO_SNAPSHOT_INTERVAL_MS ?? 10 * 60_000),
  /** How long an empty room stays in memory (covers page refreshes). */
  roomGraceMs: Number(env.ROOM_GRACE_MS ?? 2_000),
  instanceName: env.INSTANCE_NAME ?? `api-${process.pid}`,
};

if (config.isProd && config.jwtSecret === "dev-only-secret-change-me") {
  throw new Error("JWT_SECRET must be set in production");
}
