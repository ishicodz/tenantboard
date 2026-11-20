import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pm:pm@localhost:5432/collab_test?schema=public",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
      JWT_SECRET: "test-secret",
      ROOM_GRACE_MS: "100",
      PERSIST_DEBOUNCE_MS: "1500",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      reporter: ["text", "json-summary"],
    },
  },
});
