import { afterAll, beforeAll } from "vitest";
import { prisma } from "../src/db/client.js";

beforeAll(async () => {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
