import request from "supertest";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/client.js";
import { addMember, api, app, createProject, createWorkspace, signup, type TestUser } from "./helpers.js";

const stripe = new Stripe("sk_test_placeholder");
const SECRET = "whsec_test_secret";

function stripeEvent(id: string, type: string, object: object) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object }, api_version: "2025-01-01", created: Math.floor(Date.now() / 1000) });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return request(app).post("/api/stripe/webhook").set("Stripe-Signature", header).set("Content-Type", "application/json").send(payload);
}

describe("billing and plan limits", () => {
  let owner: TestUser;
  let ws: { id: string; slug: string };

  beforeAll(async () => {
    owner = await signup("Owner");
    ws = await createWorkspace(owner);
  });

  it("FREE plan caps projects at 2", async () => {
    await createProject(owner, ws.slug, "ONE");
    await createProject(owner, ws.slug, "TWO");
    const res = await api(owner).post(`/workspaces/${ws.slug}/projects`, { key: "THREE", name: "x" });
    expect(res.status).toBe(402);
    expect(res.body.error.details).toMatchObject({ kind: "projects", limit: 2, current: 2, plan: "FREE" });
  });

  it("FREE plan caps members at 5", async () => {
    for (let i = 0; i < 4; i++) await addMember(owner, ws.slug, await signup(`M${i}`), "MEMBER");
    const extra = await signup("Extra");
    const res = await api(owner).post(`/workspaces/${ws.slug}/members`, { email: extra.email });
    expect(res.status).toBe(402);
  });

  it("reports plan, usage and catalog", async () => {
    const res = await api(owner).get(`/workspaces/${ws.slug}/billing`);
    expect(res.body.plan).toBe("FREE");
    expect(res.body.usage).toMatchObject({ projects: 2, members: 5 });
    expect(res.body.catalog.map((c: any) => c.plan)).toEqual(["FREE", "PRO", "BUSINESS"]);
  });

  it("checkout returns 503 when Stripe is not configured", async () => {
    const res = await api(owner).post(`/workspaces/${ws.slug}/billing/checkout`, { plan: "PRO" });
    expect(res.status).toBe(503);
  });

  it("rejects Stripe webhooks with a bad signature", async () => {
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Stripe-Signature", "t=1,v1=bad")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_x", type: "x" }));
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed links the Stripe customer to the workspace", async () => {
    const res = await stripeEvent("evt_checkout_1", "checkout.session.completed", {
      id: "cs_1",
      object: "checkout.session",
      mode: "subscription",
      client_reference_id: ws.id,
      customer: "cus_123",
      subscription: "sub_123",
      metadata: { workspaceId: ws.id, plan: "PRO" },
    });
    expect(res.status).toBe(200);
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(w).toMatchObject({ stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_123", plan: "PRO" });
  });

  it("subscription updates set the plan from the price id, idempotently", async () => {
    const sub = {
      id: "sub_123",
      object: "subscription",
      customer: "cus_123",
      status: "active",
      metadata: { workspaceId: ws.id },
      items: { data: [{ price: { id: "price_business_test" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
    };
    const first = await stripeEvent("evt_sub_1", "customer.subscription.updated", sub);
    expect(first.body.duplicate).toBe(false);
    const dup = await stripeEvent("evt_sub_1", "customer.subscription.updated", sub);
    expect(dup.body.duplicate).toBe(true);

    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(w.plan).toBe("BUSINESS");
    expect(w.currentPeriodEnd).toBeInstanceOf(Date);

    // BUSINESS has no project limit
    expect((await api(owner).post(`/workspaces/${ws.slug}/projects`, { key: "THREE", name: "x" })).status).toBe(201);
  });

  it("payment failures notify owners", async () => {
    await stripeEvent("evt_inv_1", "invoice.payment_failed", { id: "in_1", object: "invoice", customer: "cus_123" });
    const notes = await api(owner).get(`/workspaces/${ws.slug}/notifications`);
    expect(notes.body.notifications.some((n: any) => n.type === "billing")).toBe(true);
  });

  it("subscription deletion downgrades to FREE", async () => {
    await stripeEvent("evt_sub_del", "customer.subscription.deleted", {
      id: "sub_123",
      object: "subscription",
      customer: "cus_123",
      status: "canceled",
      metadata: { workspaceId: ws.id },
      items: { data: [{ price: { id: "price_business_test" } }] },
    });
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(w.plan).toBe("FREE");
    expect(w.stripeSubscriptionId).toBeNull();
    // Over-limit workspaces keep their data but cannot create more.
    expect((await api(owner).post(`/workspaces/${ws.slug}/projects`, { key: "FOUR", name: "x" })).status).toBe(402);
  });
});
