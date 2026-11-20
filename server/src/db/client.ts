import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Raw client. Only use directly for global tables (User, Workspace, StripeEvent)
// or cross-tenant system work (Stripe webhooks, workers resolving a tenant).
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
