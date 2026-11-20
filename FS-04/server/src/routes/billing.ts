import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { AppError, badRequest } from "../lib/errors.js";
import { PLAN_CATALOG, PLAN_LIMITS, priceIdForPlan } from "../lib/plans.js";
import { parse } from "../lib/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { getStripe, getUsage, handleStripeEvent, stripeForWebhooks } from "../services/billing.js";

/** Mounted at /api/workspaces/:slug/billing */
export const billingRouter = Router({ mergeParams: true });

billingRouter.get("/", async (req, res) => {
  const ws = req.workspace!;
  res.json({
    plan: ws.plan,
    subscriptionStatus: ws.subscriptionStatus,
    currentPeriodEnd: ws.currentPeriodEnd,
    hasStripeCustomer: !!ws.stripeCustomerId,
    usage: await getUsage(req.db!),
    limits: PLAN_LIMITS[ws.plan],
    catalog: PLAN_CATALOG.map((p) => ({ ...p, limits: PLAN_LIMITS[p.plan] })),
    stripeEnabled: !!config.stripe.secretKey,
    devBillingEnabled: config.allowDevBilling,
  });
});

billingRouter.post("/checkout", requirePermission("billing:manage"), async (req, res) => {
  const body = parse(z.object({ plan: z.enum(["PRO", "BUSINESS"]) }), req.body);
  const stripe = getStripe();
  const price = priceIdForPlan(body.plan);
  if (!price) throw new AppError(503, "BILLING_DISABLED", `No Stripe price configured for ${body.plan}`);
  const ws = req.workspace!;

  let customer = ws.stripeCustomerId;
  if (!customer) {
    const c = await stripe.customers.create({ email: req.user!.email, name: ws.name, metadata: { workspaceId: ws.id } });
    customer = c.id;
    await prisma.workspace.update({ where: { id: ws.id }, data: { stripeCustomerId: customer } });
  }
  if (ws.stripeSubscriptionId) {
    throw badRequest("This workspace already has a subscription. Use the billing portal to change plans.");
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: ws.id,
    line_items: [{ price, quantity: 1 }],
    metadata: { workspaceId: ws.id, plan: body.plan },
    subscription_data: { metadata: { workspaceId: ws.id, plan: body.plan } },
    success_url: `${config.appUrl}/w/${ws.slug}/settings/billing?checkout=success`,
    cancel_url: `${config.appUrl}/w/${ws.slug}/settings/billing?checkout=cancelled`,
  });
  await audit(req.db!, { actorId: req.user!.id, action: "billing.checkout_started", entityType: "Workspace", entityId: ws.id, metadata: { plan: body.plan } });
  res.json({ url: session.url });
});

billingRouter.post("/portal", requirePermission("billing:manage"), async (req, res) => {
  const ws = req.workspace!;
  if (!ws.stripeCustomerId) throw badRequest("No billing account yet. Start a subscription first.");
  const session = await getStripe().billingPortal.sessions.create({
    customer: ws.stripeCustomerId,
    return_url: `${config.appUrl}/w/${ws.slug}/settings/billing`,
  });
  res.json({ url: session.url });
});

/** Local demo helper: switch plans without Stripe. Disabled unless ALLOW_DEV_BILLING=true. */
billingRouter.post("/dev-set-plan", requirePermission("billing:manage"), async (req, res) => {
  if (!config.allowDevBilling) throw new AppError(404, "NOT_FOUND", "Not found");
  const body = parse(z.object({ plan: z.enum(["FREE", "PRO", "BUSINESS"]) }), req.body);
  const ws = await prisma.workspace.update({ where: { id: req.workspace!.id }, data: { plan: body.plan, subscriptionStatus: body.plan === "FREE" ? null : "dev" } });
  await audit(req.db!, { actorId: req.user!.id, action: "billing.dev_plan_set", entityType: "Workspace", entityId: ws.id, metadata: { plan: body.plan } });
  res.json({ plan: ws.plan });
});

/**
 * Stripe webhook endpoint. Mounted in app.ts with express.raw() so the
 * signature can be verified against the exact bytes Stripe sent.
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!config.stripe.webhookSecret) throw new AppError(503, "BILLING_DISABLED", "Stripe webhook secret not configured");
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") throw badRequest("Missing Stripe-Signature header");
  let event;
  try {
    event = stripeForWebhooks().webhooks.constructEvent(req.body as Buffer, sig, config.stripe.webhookSecret);
  } catch (e: any) {
    throw badRequest(`Webhook signature verification failed: ${e.message}`);
  }
  const result = await handleStripeEvent(event);
  res.json({ received: true, ...result });
}
