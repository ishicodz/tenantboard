import { beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "../src/db/tenant.js";
import { api, createIssue, createProject, createWorkspace, signup, type TestUser } from "./helpers.js";

/**
 * The core multi-tenancy guarantee: nothing created in workspace A is
 * readable or writable from workspace B, through the API or the data layer.
 */
describe("tenant isolation", () => {
  let alice: TestUser, bob: TestUser;
  let wsA: { id: string; slug: string }, wsB: { id: string; slug: string };
  let projectA: Awaited<ReturnType<typeof createProject>>;
  let issueA: Awaited<ReturnType<typeof createIssue>>;

  beforeAll(async () => {
    alice = await signup("Alice");
    bob = await signup("Bob");
    wsA = await createWorkspace(alice, "Alpha");
    wsB = await createWorkspace(bob, "Beta");
    projectA = await createProject(alice, wsA.slug, "ALP");
    await createProject(bob, wsB.slug, "BET");
    issueA = await createIssue(alice, wsA.slug, projectA.project.id, { title: "Secret roadmap" });
  });

  it("each user only lists their own workspaces", async () => {
    const res = await api(bob).get("/workspaces");
    expect(res.body.workspaces.map((w: any) => w.slug)).toEqual([wsB.slug]);
  });

  it("non-members get 404 for another workspace (no slug enumeration)", async () => {
    expect((await api(bob).get(`/workspaces/${wsA.slug}`)).status).toBe(404);
    expect((await api(bob).get(`/workspaces/${wsA.slug}/issues`)).status).toBe(404);
  });

  it("cannot read another tenant's issue by id or key through your own workspace", async () => {
    expect((await api(bob).get(`/workspaces/${wsB.slug}/issues/${issueA.id}`)).status).toBe(404);
    expect((await api(bob).get(`/workspaces/${wsB.slug}/issues/ALP-1`)).status).toBe(404);
  });

  it("cannot modify, move, comment on or delete another tenant's issue", async () => {
    const b = api(bob);
    expect((await b.patch(`/workspaces/${wsB.slug}/issues/${issueA.id}`, { title: "pwned" })).status).toBe(404);
    expect((await b.post(`/workspaces/${wsB.slug}/issues/${issueA.id}/move`, { statusId: issueA.statusId })).status).toBe(404);
    expect((await b.post(`/workspaces/${wsB.slug}/issues/${issueA.id}/comments`, { body: "hi" })).status).toBe(404);
    expect((await b.delete(`/workspaces/${wsB.slug}/issues/${issueA.id}`)).status).toBe(404);
    const still = await api(alice).get(`/workspaces/${wsA.slug}/issues/${issueA.id}`);
    expect(still.body.issue.title).toBe("Secret roadmap");
  });

  it("cannot create issues in another tenant's project or with another tenant's status", async () => {
    const res = await api(bob).post(`/workspaces/${wsB.slug}/issues`, { projectId: projectA.project.id, title: "x" });
    expect(res.status).toBe(400);
    const bProjects = await api(bob).get(`/workspaces/${wsB.slug}/projects`);
    const bProjectId = bProjects.body.projects[0].id;
    const res2 = await api(bob).post(`/workspaces/${wsB.slug}/issues`, { projectId: bProjectId, title: "x", statusId: issueA.statusId });
    expect(res2.status).toBe(400);
  });

  it("cannot assign issues to users outside the workspace", async () => {
    const bProjects = await api(bob).get(`/workspaces/${wsB.slug}/projects`);
    const res = await api(bob).post(`/workspaces/${wsB.slug}/issues`, { projectId: bProjects.body.projects[0].id, title: "x", assigneeId: alice.id });
    expect(res.status).toBe(400);
  });

  it("data layer: tenantDb filters reads and writes by workspace", async () => {
    const dbB = tenantDb(wsB.id);
    expect(await dbB.issue.findUnique({ where: { id: issueA.id } })).toBeNull();
    expect(await dbB.issue.findMany({ where: { title: "Secret roadmap" } })).toHaveLength(0);
    await expect(dbB.issue.update({ where: { id: issueA.id }, data: { title: "pwned" } })).rejects.toThrow();
    const res = await dbB.issue.updateMany({ where: { id: issueA.id }, data: { title: "pwned" } });
    expect(res.count).toBe(0);
    const del = await dbB.issue.deleteMany({});
    expect(del.count).toBe(0);
    expect(await tenantDb(wsA.id).issue.count()).toBe(1);
  });

  it("data layer: a spoofed workspaceId on create is overwritten", async () => {
    const dbB = tenantDb(wsB.id);
    const wf = await dbB.workflow.create({ data: { name: "spoof", workspaceId: wsA.id } as any });
    expect(wf.workspaceId).toBe(wsB.id);
  });
});
