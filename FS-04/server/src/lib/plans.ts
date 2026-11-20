import type { Plan } from "@prisma/client";
import { config } from "../config.js";

export interface PlanLimits {
  projects: number | null; // null = unlimited
  members: number | null;
  issues: number | null;
  webhooks: number | null;
  maxAttachmentMb: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { projects: 2, members: 5, issues: 250, webhooks: 0, maxAttachmentMb: 5 },
  PRO: { projects: 20, members: 25, issues: 10_000, webhooks: 5, maxAttachmentMb: 25 },
  BUSINESS: { projects: null, members: null, issues: null, webhooks: 50, maxAttachmentMb: 100 },
};

export const PLAN_CATALOG: { plan: Plan; name: string; priceMonthly: number; blurb: string }[] = [
  { plan: "FREE", name: "Free", priceMonthly: 0, blurb: "For small teams trying things out" },
  { plan: "PRO", name: "Pro", priceMonthly: 12, blurb: "Webhooks, bigger limits" },
  { plan: "BUSINESS", name: "Business", priceMonthly: 29, blurb: "Unlimited projects and members" },
];

export function priceIdForPlan(plan: Plan): string | null {
  if (plan === "PRO") return config.stripe.pricePro || null;
  if (plan === "BUSINESS") return config.stripe.priceBusiness || null;
  return null;
}

export function planForPriceId(priceId: string | undefined | null): Plan | null {
  if (!priceId) return null;
  if (priceId === config.stripe.pricePro) return "PRO";
  if (priceId === config.stripe.priceBusiness) return "BUSINESS";
  return null;
}

export function withinLimit(limit: number | null, current: number): boolean {
  return limit === null || current < limit;
}
