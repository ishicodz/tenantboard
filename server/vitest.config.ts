import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false, // test files share one Postgres database
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pm:pm@localhost:5432/pm_test?schema=public",
      JOBS_MODE: "inline",
      JWT_SECRET: "test-secret",
      UPLOAD_DIR: "/tmp/tenantboard-test-uploads",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
      STRIPE_PRICE_PRO: "price_pro_test",
      STRIPE_PRICE_BUSINESS: "price_business_test",
      ALLOW_DEV_BILLING: "true",
      WEBHOOK_ALLOW_PRIVATE: "true",
      WEBHOOK_TIMEOUT_MS: "2000",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/worker.ts", "src/types.d.ts"],
      reporter: ["text", "json-summary", "html"],
    },
  },
});
