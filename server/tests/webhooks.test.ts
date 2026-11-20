import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySignature } from "../src/jobs/webhooks.js";
import { api, createIssue, createProject, createWorkspace, signup, type TestUser } from "./helpers.js";

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe("outgoing webhooks", () => {
  let owner: TestUser;
  let slug: string;
  let projectId: string;
  let server: http.Server;
  let baseUrl: string;
  const received: Received[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.statusCode = req.url === "/fail" ? 500 : 200;
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    owner = await signup("Owner");
    slug = (await createWorkspace(owner)).slug;
    projectId = (await createProject(owner, slug)).project.id;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("is not available on the FREE plan", async () => {
    const res = await api(owner).post(`/workspaces/${slug}/webhooks`, { url: `${baseUrl}/ok`, events: ["*"] });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("PLAN_LIMIT");
  });

  it("delivers signed events and records successful deliveries", async () => {
    await api(owner).post(`/workspaces/${slug}/billing/dev-set-plan`, { plan: "PRO" });
    const created = await api(owner).post(`/workspaces/${slug}/webhooks`, { url: `${baseUrl}/ok`, events: ["issue.created", "issue.moved"] });
    expect(created.status).toBe(201);
    const secret = created.body.webhook.secret;
    expect(secret).toMatch(/^whsec_/);

    received.length = 0;
    const issue = await createIssue(owner, slug, projectId, { title: "Hook me" });
    expect(received).toHaveLength(1);
    const msg = received[0];
    expect(msg.headers["x-tenantboard-event"]).toBe("issue.created");
    expect(verifySignature(secret, String(msg.headers["x-tenantboard-signature"]), msg.body)).toBe(true);
    expect(JSON.parse(msg.body).data.issue.key).toBe(issue.key);

    // not subscribed to issue.updated
    await api(owner).patch(`/workspaces/${slug}/issues/${issue.id}`, { title: "Changed" });
    expect(received).toHaveLength(1);

    const deliveries = await api(owner).get(`/workspaces/${slug}/webhooks/${created.body.webhook.id}/deliveries`);
    expect(deliveries.body.deliveries[0]).toMatchObject({ status: "SUCCESS", responseCode: 200, attempts: 1 });

    // listing hides the secret
    const list = await api(owner).get(`/workspaces/${slug}/webhooks`);
    expect(list.body.webhooks[0].secret).not.toBe(secret);
  });

  it("marks deliveries as failed on non-2xx responses and supports redelivery", async () => {
    const hook = (await api(owner).post(`/workspaces/${slug}/webhooks`, { url: `${baseUrl}/fail`, events: ["*"] })).body.webhook;
    await api(owner).post(`/workspaces/${slug}/webhooks/${hook.id}/test`);
    const d = (await api(owner).get(`/workspaces/${slug}/webhooks/${hook.id}/deliveries`)).body.deliveries[0];
    expect(d).toMatchObject({ status: "FAILED", responseCode: 500, event: "webhook.test" });
    await api(owner).post(`/workspaces/${slug}/webhooks/${hook.id}/deliveries/${d.id}/redeliver`);
    const again = (await api(owner).get(`/workspaces/${slug}/webhooks/${hook.id}/deliveries`)).body.deliveries[0];
    expect(again.attempts).toBe(2);
  });

  it("does not deliver to inactive webhooks", async () => {
    const hooks = (await api(owner).get(`/workspaces/${slug}/webhooks`)).body.webhooks;
    for (const h of hooks) await api(owner).patch(`/workspaces/${slug}/webhooks/${h.id}`, { active: false });
    received.length = 0;
    await createIssue(owner, slug, projectId);
    expect(received).toHaveLength(0);
  });

  it("rejects invalid webhook URLs", async () => {
    const res = await api(owner).post(`/workspaces/${slug}/webhooks`, { url: "ftp://example.com/x", events: ["*"] });
    expect(res.status).toBe(400);
  });
});
