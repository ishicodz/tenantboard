import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, connect, signup, startInstance, stopInstance, waitFor, workspaceWithPage, type Instance, type TestUser } from "./helpers.js";

describe("REST API: auth, workspaces, pages, permissions, comments, history", () => {
  let s: Instance;
  let owner: TestUser, member: TestUser, guest: TestUser, stranger: TestUser;
  let workspaceId: string, pageId: string;

  beforeAll(async () => {
    s = await startInstance();
    [owner, member, guest, stranger] = await Promise.all(["Owner", "Member", "Guest", "Stranger"].map((n) => signup(s, n)));
    ({ workspaceId, pageId } = await workspaceWithPage(s, owner));
    await api(s, owner).post(`/workspaces/${workspaceId}/members`, { email: member.email });
  });
  afterAll(() => stopInstance(s));

  describe("auth", () => {
    it("registers, logs in, rejects bad credentials", async () => {
      const login = await api(s).post("/auth/login", { email: owner.email, password: "password123" });
      expect(login.status).toBe(200);
      expect((await api(s).post("/auth/login", { email: owner.email, password: "wrong-pass" })).status).toBe(401);
      expect((await api(s).post("/auth/register", { email: owner.email, name: "x", password: "password123" })).status).toBe(409);
      expect((await api(s).get("/workspaces")).status).toBe(401);
      expect((await api(s).get("/health")).body.ok).toBe(true);
    });
  });

  describe("workspaces", () => {
    it("creates a workspace with a welcome page and lists only my workspaces", async () => {
      const res = await api(s, owner).post("/workspaces", { name: "Fresh" });
      expect(res.status).toBe(201);
      const pages = await api(s, owner).get(`/workspaces/${res.body.workspace.id}/pages`);
      expect(pages.body.pages[0].title).toBe("Welcome");
      const theirs = await api(s, stranger).get("/workspaces");
      expect(theirs.body.workspaces).toHaveLength(0);
      expect((await api(s, stranger).get(`/workspaces/${workspaceId}`)).status).toBe(404);
    });

    it("only owners add members; members can leave; last owner cannot", async () => {
      expect((await api(s, member).post(`/workspaces/${workspaceId}/members`, { email: stranger.email })).status).toBe(403);
      expect((await api(s, owner).delete(`/workspaces/${workspaceId}/members/${owner.id}`)).status).toBe(400);
      const detail = await api(s, member).get(`/workspaces/${workspaceId}`);
      expect(detail.body.members.map((m: any) => m.email)).toEqual(expect.arrayContaining([owner.email, member.email]));
    });
  });

  describe("page permissions", () => {
    it("members get the page default; explicit shares override it", async () => {
      expect((await api(s, member).get(`/pages/${pageId}`)).body.myRole).toBe("EDIT");
      await api(s, owner).patch(`/pages/${pageId}`, { memberRole: "COMMENT" });
      expect((await api(s, member).get(`/pages/${pageId}`)).body.myRole).toBe("COMMENT");
      await api(s, owner).put(`/pages/${pageId}/permissions`, { email: member.email, role: "VIEW" });
      expect((await api(s, member).get(`/pages/${pageId}`)).body.myRole).toBe("VIEW");
      await api(s, owner).delete(`/pages/${pageId}/permissions/${member.id}`);
      await api(s, owner).patch(`/pages/${pageId}`, { memberRole: "EDIT" });
    });

    it("non-members have no access unless the page is shared with them (guest)", async () => {
      expect((await api(s, guest).get(`/pages/${pageId}`)).status).toBe(404);
      await api(s, owner).put(`/pages/${pageId}/permissions`, { email: guest.email, role: "COMMENT" });
      expect((await api(s, guest).get(`/pages/${pageId}`)).body.myRole).toBe("COMMENT");
      const shared = await api(s, guest).get("/pages/shared");
      expect(shared.body.pages.map((p: any) => p.id)).toContain(pageId);
      // Guests can't see the rest of the workspace.
      expect((await api(s, guest).get(`/workspaces/${workspaceId}/pages`)).status).toBe(404);
    });

    it("only managers (page creator / workspace owner) can share, change defaults or delete", async () => {
      expect((await api(s, member).put(`/pages/${pageId}/permissions`, { email: stranger.email, role: "EDIT" })).status).toBe(403);
      expect((await api(s, member).patch(`/pages/${pageId}`, { memberRole: "VIEW" })).status).toBe(403);
      expect((await api(s, member).delete(`/pages/${pageId}`)).status).toBe(403);
      const perms = await api(s, member).get(`/pages/${pageId}/permissions`);
      expect(perms.body.canManage).toBe(false);
    });

    it("the page creator can manage their own page", async () => {
      const mine = (await api(s, member).post(`/workspaces/${workspaceId}/pages`, { title: "Member's page" })).body.page;
      expect((await api(s, member).get(`/pages/${mine.id}`)).body.canManage).toBe(true);
      expect((await api(s, member).delete(`/pages/${mine.id}`)).status).toBe(204);
    });
  });

  describe("comments", () => {
    it("COMMENT+ can create threads and replies; VIEW cannot", async () => {
      await api(s, owner).put(`/pages/${pageId}/permissions`, { email: stranger.email, role: "VIEW" });
      expect((await api(s, stranger).post(`/pages/${pageId}/comments`, { body: "hi" })).status).toBe(403);
      const t = await api(s, guest).post(`/pages/${pageId}/comments`, { body: "Is this right?", quote: "some text" });
      expect(t.status).toBe(201);
      const reply = await api(s, member).post(`/pages/${pageId}/comments`, { body: "Yes", parentId: t.body.comment.id });
      expect(reply.status).toBe(201);
      const list = await api(s, stranger).get(`/pages/${pageId}/comments`);
      expect(list.body.comments[0].quote).toBe("some text");
      expect(list.body.comments[0].replies[0].body).toBe("Yes");
    });

    it("resolve, author-only edit, owner moderation", async () => {
      const c = (await api(s, guest).post(`/pages/${pageId}/comments`, { body: "typo" })).body.comment;
      expect((await api(s, member).patch(`/pages/${pageId}/comments/${c.id}`, { resolved: true })).body.comment.resolved).toBe(true);
      expect((await api(s, member).patch(`/pages/${pageId}/comments/${c.id}`, { body: "edited" })).status).toBe(403);
      expect((await api(s, member).delete(`/pages/${pageId}/comments/${c.id}`)).status).toBe(403);
      expect((await api(s, owner).delete(`/pages/${pageId}/comments/${c.id}`)).status).toBe(204);
    });
  });

  describe("version history", () => {
    it("snapshots the live document, previews it, and lists auto + manual versions", async () => {
      const { pageId: p } = await workspaceWithPage(s, owner);
      const c = connect(s, p, owner);
      await c.synced;
      c.write("version one");
      await waitFor(async () => (await api(s, owner).get(`/pages/${p}/text`)).text.includes("version one"), 3000, "live text");

      const snap = await api(s, owner).post(`/pages/${p}/snapshots`, { label: "Before rewrite" });
      expect(snap.status).toBe(201);
      c.write("version two");

      const detail = await api(s, owner).get(`/pages/${p}/snapshots/${snap.body.snapshot.id}`);
      expect(detail.body.text).toContain("version one");
      expect(detail.body.text).not.toContain("version two");
      expect(detail.body.state).toBeTruthy();

      const list = await api(s, owner).get(`/pages/${p}/snapshots`);
      expect(list.body.snapshots.some((x: any) => x.label === "Before rewrite")).toBe(true);
      c.close();
    });

    it("viewers can browse history but not create snapshots", async () => {
      expect((await api(s, stranger).get(`/pages/${pageId}/snapshots`)).status).toBe(200);
      expect((await api(s, stranger).post(`/pages/${pageId}/snapshots`, {})).status).toBe(403);
    });
  });
});
