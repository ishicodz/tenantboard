import Stripe from "stripe";
import type { Plan, Workspace } from "@prisma/client";
import { prisma } from "../db/client.js";
import { tenantDb, type TenantDb } from "../db/tenant.js";
import { config } from "../config.js";
import { AppError, planLimit } from "../lib/errors.js";
import { PLAN_LIMITS, planForPriceId, withinLimit } from "../lib/plans.js";
import { enqueue } from "../jobs/queue.js";

let stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!config.stripe.secretKey) throw new AppError(503, "BILLING_DISABLED", "Stripe is not configured on this server");
  if (!stripe) stripe = new Stripe(config.stripe.secretKey);
  return stripe;
}

/** Used for verifying webhook signatures; works with any key since it is offline. */
export function stripeForWebhooks(): Stripe {
  return stripe ?? new Stripe(config.stripe.secretKey || "sk_test_placeholder");
}

export type LimitKind = "projects" | "members" | "issues" | "webhooks";

export async function getUsage(db: TenantDb) {
  const [projects, members, issues, webhooks] = await Promise.all([
    db.project.count(),
    db.membership.count(),
    db.issue.count(),
    db.webhook.count(),
  ]);
  return { projects, members, issues, webhooks };
}

export async function assertWithinPlan(workspace: Workspace, db: TenantDb, kind: LimitKind) {
  const limits = PLAN_LIMITS[workspace.plan];
  const usage = await getUsage(db);
  if (!withinLimit(limits[kind], usage[kind])) {
    throw planLimit(`Your ${workspace.plan} plan allows ${limits[kind]} ${kind}. Upgrade to add more.`, {
      kind,
      limit: limits[kind],
      current: usage[kind],
      plan: workspace.plan,
    });
  }
}

async function notifyOwners(workspaceId: string, title: string, body: string) {
  const owners = await tenantDb(workspaceId).membership.findMany({ where: { role: "OWNER" }, select: { userId: true } });
  await enqueue("notification.send", { workspaceId, userIds: owners.map((o) => o.userId), type: "billing", title, body });
}

async function applySubscription(sub: Stripe.Subscription) {
  const workspace =
    (sub.metadata?.workspaceId && (await prisma.workspace.findUnique({ where: { id: sub.metadata.workspaceId } }))) ||
    (await prisma.workspace.findFirst({
      where: { OR: [{ stripeSubscriptionId: sub.id }, { stripeCustomerId: String(sub.customer) }] },
    }));
  if (!workspace) return;

  const item = sub.items?.data?.[0];
  const priced = planForPriceId(item?.price?.id);
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  const plan: Plan = active ? (priced ?? (sub.metadata?.plan as Plan) ?? workspace.plan) : "FREE";
  const periodEnd = (item as any)?.current_period_end ?? (sub as any).current_period_end;

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      plan,
      stripeCustomerId: String(sub.customer),
      stripeSubscriptionId: sub.status === "canceled" ? null : sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    },
  });
  await tenantDb(workspace.id).auditLog.create({
    data: { action: "billing.subscription_updated", entityType: "Workspace", entityId: workspace.id, metadata: { plan, status: sub.status } } as any,
  });
}

/**
 * Handles a verified Stripe event. Idempotent: each event id is processed once.
 */
export async function handleStripeEvent(event: Stripe.Event) {
  const seen = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (seen) return { duplicate: true };

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const workspaceId = s.client_reference_id ?? s.metadata?.workspaceId;
      if (workspaceId && s.mode === "subscription") {
        const plan = (s.metadata?.plan as Plan | undefined) ?? undefined;
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: {
            stripeCustomerId: s.customer ? String(s.customer) : undefined,
            stripeSubscriptionId: s.subscription ? String(s.subscription) : undefined,
            subscriptionStatus: "active",
            ...(plan ? { plan } : {}),
          },
        });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const ws = await prisma.workspace.findFirst({ where: { stripeCustomerId: String(inv.customer) } });
      if (ws) await notifyOwners(ws.id, "Payment failed", "We could not charge your card. Update your payment method to keep your plan.");
      break;
    }
    default:
      break;
  }

  await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  return { duplicate: false };
}
