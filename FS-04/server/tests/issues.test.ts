import { beforeAll, describe, expect, it } from "vitest";
import { addMember, api, createIssue, createProject, createWorkspace, signup, type TestUser } from "./helpers.js";

describe("issues, kanban, workflows, comments, attachments", () => {
  let owner: TestUser, dev: TestUser;
  let slug: string;
  let p: Awaited<ReturnType<typeof createProject>>;
  const status = (name: string) => p.workflow.statuses.find((s) => s.name === name)!.id;

  beforeAll(async () => {
    owner = await signup("Owner");
    dev = await signup("Dev");
    slug = (await createWorkspace(owner)).slug;
    await addMember(owner, slug, dev, "MEMBER");
    p = await createProject(owner, slug, "WEB");
  });

  it("numbers issues per project and resolves them by key", async () => {
    const a = await createIssue(owner, slug, p.project.id, { title: "First" });
    const b = await createIssue(owner, slug, p.project.id, { title: "Second" });
    expect([a.key, b.key]).toEqual(["WEB-1", "WEB-2"]);
    expect(a.statusId).toBe(status("To Do"));
    const byKey = await api(owner).get(`/workspaces/${slug}/issues/web-2`);
    expect(byKey.body.issue.title).toBe("Second");
  });

  it("validates input", async () => {
    const res = await api(owner).post(`/workspaces/${slug}/issues`, { projectId: p.project.id, title: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("filters and searches issues", async () => {
    await createIssue(owner, slug, p.project.id, { title: "Fix login bug", type: "BUG", priority: "URGENT" });
    const res = await api(owner).get(`/workspaces/${slug}/issues?q=login&type=BUG`);
    expect(res.body.total).toBe(1);
    expect(res.body.issues[0].priority).toBe("URGENT");
  });

  it("records field-level diffs in the audit log and notifies new assignees", async () => {
    const issue = await createIssue(owner, slug, p.project.id, { title: "Old" });
    const res = await api(owner).patch(`/workspaces/${slug}/issues/${issue.id}`, { title: "New", assigneeId: dev.id, storyPoints: 5 });
    expect(res.status).toBe(200);
    const activity = await api(owner).get(`/workspaces/${slug}/issues/${issue.id}/activity`);
    const upd = activity.body.activity.find((a: any) => a.action === "issue.updated");
    expect(upd.metadata.changes.title).toEqual({ from: "Old", to: "New" });
    expect(upd.metadata.changes.assigneeId.to).toBe(dev.id);

    const notes = await api(dev).get(`/workspaces/${slug}/notifications`);
    expect(notes.body.unread).toBeGreaterThan(0);
    expect(notes.body.notifications[0].title).toContain(issue.key);
    await api(dev).post(`/workspaces/${slug}/notifications/read-all`);
    expect((await api(dev).get(`/workspaces/${slug}/notifications`)).body.unread).toBe(0);
  });

  it("drag-and-drop: moves between columns and reorders within a column", async () => {
    const inProg = status("In Progress");
    const [x, y, z] = [
      await createIssue(owner, slug, p.project.id, { title: "x", statusId: inProg }),
      await createIssue(owner, slug, p.project.id, { title: "y", statusId: inProg }),
      await createIssue(owner, slug, p.project.id, { title: "z" }),
    ];
    // drop z between x and y
    const moved = await api(dev).post(`/workspaces/${slug}/issues/${z.id}/move`, { statusId: inProg, beforeId: x.id, afterId: y.id });
    expect(moved.status).toBe(200);
    const board = await api(dev).get(`/workspaces/${slug}/projects/${p.project.id}/boards/${p.boards[0].id}`);
    const col = board.body.columns.find((c: any) => c.status.id === inProg);
    expect(col.issues.map((i: any) => i.title)).toEqual(["x", "z", "y"]);
    // drop y on top
    await api(dev).post(`/workspaces/${slug}/issues/${y.id}/move`, { statusId: inProg, afterId: x.id });
    const board2 = await api(dev).get(`/workspaces/${slug}/projects/${p.project.id}/boards/${p.boards[0].id}`);
    expect(board2.body.columns.find((c: any) => c.status.id === inProg).issues.map((i: any) => i.title)).toEqual(["y", "x", "z"]);
  });

  it("rebalances ranks when the gap between two cards is exhausted", async () => {
    const col = status("In Review");
    const a = await createIssue(owner, slug, p.project.id, { title: "a", statusId: col });
    const b = await createIssue(owner, slug, p.project.id, { title: "b", statusId: col });
    const c = await createIssue(owner, slug, p.project.id, { title: "c", statusId: col });
    // Repeatedly drop c then b between a and its neighbour to burn through float precision.
    for (let i = 0; i < 60; i++) {
      const mover = i % 2 === 0 ? c : b;
      const other = i % 2 === 0 ? b : c;
      const res = await api(owner).post(`/workspaces/${slug}/issues/${mover.id}/move`, { statusId: col, beforeId: a.id, afterId: other.id });
      expect(res.status).toBe(200);
    }
    const board = await api(owner).get(`/workspaces/${slug}/projects/${p.project.id}/boards/${p.boards[0].id}`);
    const titles = board.body.columns.find((x: any) => x.status.id === col).issues.map((i: any) => i.title);
    expect(titles[0]).toBe("a");
    expect(titles).toHaveLength(3);
  });

  it("sets resolvedAt when an issue enters a DONE status and clears it when reopened", async () => {
    const issue = await createIssue(owner, slug, p.project.id);
    const done = await api(owner).post(`/workspaces/${slug}/issues/${issue.id}/move`, { statusId: status("Done") });
    expect(done.body.issue.resolvedAt).toBeTruthy();
    const reopened = await api(owner).patch(`/workspaces/${slug}/issues/${issue.id}`, { statusId: status("To Do") });
    expect(reopened.body.issue.resolvedAt).toBeNull();
  });

  it("custom workflows: add a status and enforce allowed transitions", async () => {
    const wf = p.workflow.id;
    const qa = await api(owner).post(`/workspaces/${slug}/workflows/${wf}/statuses`, { name: "QA", category: "IN_PROGRESS" });
    expect(qa.status).toBe(201);
    const todo = status("To Do");
    await api(owner).put(`/workspaces/${slug}/workflows/${wf}/transitions`, {
      transitions: [{ fromStatusId: todo, toStatusId: qa.body.status.id }],
    });
    await api(owner).patch(`/workspaces/${slug}/workflows/${wf}`, { enforceTransitions: true });

    const issue = await createIssue(owner, slug, p.project.id);
    const blocked = await api(owner).post(`/workspaces/${slug}/issues/${issue.id}/move`, { statusId: status("Done") });
    expect(blocked.status).toBe(400);
    const ok = await api(owner).post(`/workspaces/${slug}/issues/${issue.id}/move`, { statusId: qa.body.status.id });
    expect(ok.status).toBe(200);

    // Deleting an in-use status requires a destination.
    expect((await api(owner).delete(`/workspaces/${slug}/workflows/${wf}/statuses/${qa.body.status.id}`)).status).toBe(400);
    expect((await api(owner).delete(`/workspaces/${slug}/workflows/${wf}/statuses/${qa.body.status.id}?moveIssuesTo=${todo}`)).status).toBe(204);
    await api(owner).patch(`/workspaces/${slug}/workflows/${wf}`, { enforceTransitions: false });
  });

  it("reorders workflow statuses", async () => {
    const wf = (await api(owner).get(`/workspaces/${slug}/workflows/${p.workflow.id}`)).body.workflow;
    const reversed = [...wf.statuses].reverse().map((s: any) => s.id);
    const res = await api(owner).put(`/workspaces/${slug}/workflows/${wf.id}/statuses/order`, { statusIds: reversed });
    expect(res.body.workflow.statuses.map((s: any) => s.id)).toEqual(reversed);
    await api(owner).put(`/workspaces/${slug}/workflows/${wf.id}/statuses/order`, { statusIds: wf.statuses.map((s: any) => s.id) });
  });

  it("comments notify the assignee and reporter", async () => {
    const issue = await createIssue(owner, slug, p.project.id, { assigneeId: dev.id });
    const res = await api(dev).post(`/workspaces/${slug}/issues/${issue.id}/comments`, { body: "On it" });
    expect(res.status).toBe(201);
    const list = await api(owner).get(`/workspaces/${slug}/issues/${issue.id}/comments`);
    expect(list.body.comments[0].author.id).toBe(dev.id);
    const notes = await api(owner).get(`/workspaces/${slug}/notifications?unread=true`);
    expect(notes.body.notifications.some((n: any) => n.type === "comment.created")).toBe(true);
  });

  it("uploads, lists, downloads and deletes attachments", async () => {
    const issue = await createIssue(owner, slug, p.project.id);
    const up = await api(dev).upload(`/workspaces/${slug}/issues/${issue.id}/attachments`, "file", Buffer.from("hello world"), "notes.txt");
    expect(up.status).toBe(201);
    expect(up.body.attachment.size).toBe(11);
    const list = await api(owner).get(`/workspaces/${slug}/issues/${issue.id}/attachments`);
    expect(list.body.attachments).toHaveLength(1);
    const dl = await api(owner).get(`/workspaces/${slug}/issues/${issue.id}/attachments/${up.body.attachment.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("notes.txt");
    expect(dl.text).toBe("hello world");
    expect((await api(dev).delete(`/workspaces/${slug}/issues/${issue.id}/attachments/${up.body.attachment.id}`)).status).toBe(204);
  });

  it("enforces the plan's attachment size limit", async () => {
    const issue = await createIssue(owner, slug, p.project.id);
    const big = Buffer.alloc(6 * 1024 * 1024, 1); // FREE allows 5 MB
    const res = await api(owner).upload(`/workspaces/${slug}/issues/${issue.id}/attachments`, "file", big, "big.bin");
    expect(res.status).toBe(413);
  });

  it("board filters: backlog vs sprint and assignee", async () => {
    const res = await api(owner).get(`/workspaces/${slug}/projects/${p.project.id}/boards/${p.boards[0].id}?assigneeId=${dev.id}`);
    const all = res.body.columns.flatMap((c: any) => c.issues);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((i: any) => i.assigneeId === dev.id)).toBe(true);
  });
});
