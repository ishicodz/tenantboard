import { beforeAll, describe, expect, it } from "vitest";
import { addMember, api, createIssue, createProject, createWorkspace, signup, type TestUser } from "./helpers.js";

describe("role-based permissions", () => {
  let owner: TestUser, admin: TestUser, member: TestUser, viewer: TestUser;
  let slug: string;
  let projectId: string;

  beforeAll(async () => {
    [owner, admin, member, viewer] = await Promise.all([signup("Owner"), signup("Admin"), signup("Member"), signup("Viewer")]);
    slug = (await createWorkspace(owner)).slug;
    await addMember(owner, slug, admin, "ADMIN");
    await addMember(owner, slug, member, "MEMBER");
    await addMember(owner, slug, viewer, "VIEWER");
    projectId = (await createProject(owner, slug)).project.id;
  });

  it("viewers can read but not write", async () => {
    expect((await api(viewer).get(`/workspaces/${slug}/issues`)).status).toBe(200);
    expect((await api(viewer).post(`/workspaces/${slug}/issues`, { projectId, title: "x" })).status).toBe(403);
    const issue = await createIssue(member, slug, projectId);
    expect((await api(viewer).post(`/workspaces/${slug}/issues/${issue.id}/comments`, { body: "x" })).status).toBe(403);
  });

  it("members can create issues but not projects, workflows or webhooks", async () => {
    await createIssue(member, slug, projectId);
    expect((await api(member).post(`/workspaces/${slug}/projects`, { key: "NOPE", name: "x" })).status).toBe(403);
    expect((await api(member).post(`/workspaces/${slug}/workflows`, { name: "x" })).status).toBe(403);
    expect((await api(member).get(`/workspaces/${slug}/webhooks`)).status).toBe(403);
    expect((await api(member).get(`/workspaces/${slug}/audit-logs`)).status).toBe(403);
  });

  it("members can delete their own comments but not other people's", async () => {
    const issue = await createIssue(member, slug, projectId);
    const mine = (await api(member).post(`/workspaces/${slug}/issues/${issue.id}/comments`, { body: "mine" })).body.comment;
    const theirs = (await api(admin).post(`/workspaces/${slug}/issues/${issue.id}/comments`, { body: "theirs" })).body.comment;
    expect((await api(member).delete(`/workspaces/${slug}/issues/${issue.id}/comments/${theirs.id}`)).status).toBe(403);
    expect((await api(member).patch(`/workspaces/${slug}/issues/${issue.id}/comments/${theirs.id}`, { body: "edit" })).status).toBe(403);
    expect((await api(member).delete(`/workspaces/${slug}/issues/${issue.id}/comments/${mine.id}`)).status).toBe(204);
    expect((await api(admin).delete(`/workspaces/${slug}/issues/${issue.id}/comments/${theirs.id}`)).status).toBe(204);
  });

  it("only admins and owners delete issues", async () => {
    const issue = await createIssue(member, slug, projectId);
    expect((await api(member).delete(`/workspaces/${slug}/issues/${issue.id}`)).status).toBe(403);
    expect((await api(admin).delete(`/workspaces/${slug}/issues/${issue.id}`)).status).toBe(204);
  });

  it("admins cannot demote or remove the owner, or grant OWNER", async () => {
    expect((await api(admin).patch(`/workspaces/${slug}/members/${owner.id}`, { role: "MEMBER" })).status).toBe(403);
    expect((await api(admin).delete(`/workspaces/${slug}/members/${owner.id}`)).status).toBe(403);
    expect((await api(admin).patch(`/workspaces/${slug}/members/${member.id}`, { role: "OWNER" })).status).toBe(403);
  });

  it("the last owner cannot leave or be demoted", async () => {
    expect((await api(owner).delete(`/workspaces/${slug}/members/${owner.id}`)).status).toBe(400);
    expect((await api(owner).patch(`/workspaces/${slug}/members/${owner.id}`, { role: "ADMIN" })).status).toBe(400);
  });

  it("only owners touch billing and workspace deletion", async () => {
    expect((await api(admin).post(`/workspaces/${slug}/billing/dev-set-plan`, { plan: "PRO" })).status).toBe(403);
    expect((await api(admin).delete(`/workspaces/${slug}`)).status).toBe(403);
  });

  it("role changes are recorded in the audit log", async () => {
    await api(owner).patch(`/workspaces/${slug}/members/${viewer.id}`, { role: "MEMBER" });
    const log = await api(admin).get(`/workspaces/${slug}/audit-logs?action=member.role_changed`);
    expect(log.body.entries[0].metadata).toEqual({ from: "VIEWER", to: "MEMBER" });
  });

  it("members can leave on their own", async () => {
    const temp = await signup("Temp");
    await addMember(owner, slug, temp, "MEMBER");
    expect((await api(temp).delete(`/workspaces/${slug}/members/${temp.id}`)).status).toBe(204);
    expect((await api(temp).get(`/workspaces/${slug}`)).status).toBe(404);
  });
});
