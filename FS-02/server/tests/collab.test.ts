import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { prisma } from "../src/db/client.js";
import { api, connect, signup, sleep, startInstance, stopInstance, waitFor, workspaceWithPage, type Instance, type TestUser } from "./helpers.js";

/**
 * Real-time collaboration across TWO server instances that share only
 * Postgres and Redis, the same topology as production behind a load balancer.
 */
describe("real-time collaboration", () => {
  let a: Instance, b: Instance;
  let owner: TestUser, editor: TestUser, viewer: TestUser, outsider: TestUser;
  let workspaceId: string, pageId: string;
  const clients: ReturnType<typeof connect>[] = [];
  const client = (inst: Instance, user: TestUser, page = pageId) => {
    const c = connect(inst, page, user);
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    a = await startInstance();
    b = await startInstance();
    owner = await signup(a, "Owner");
    editor = await signup(a, "Editor");
    viewer = await signup(a, "Viewer");
    outsider = await signup(a, "Outsider");
    ({ workspaceId, pageId } = await workspaceWithPage(a, owner));
    await api(a, owner).post(`/workspaces/${workspaceId}/members`, { email: editor.email });
    await api(a, owner).post(`/workspaces/${workspaceId}/members`, { email: viewer.email });
    await api(a, owner).put(`/pages/${pageId}/permissions`, { email: viewer.email, role: "VIEW" });
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await stopInstance(a);
    await stopInstance(b);
  });

  it("syncs edits between two clients on the same instance", async () => {
    const c1 = client(a, owner);
    const c2 = client(a, editor);
    await Promise.all([c1.synced, c2.synced]);
    expect(c1.title()).toBe("Doc"); // loaded from Postgres
    c1.write("hello from c1");
    await waitFor(() => c2.text().includes("hello from c1"), 3000, "c2 to receive");
  });

  it("syncs edits ACROSS instances through Redis", async () => {
    const onA = client(a, owner);
    const onB = client(b, editor);
    await Promise.all([onA.synced, onB.synced]);
    onA.write("written on instance A");
    await waitFor(() => onB.text().includes("written on instance A"), 3000, "instance B client");
    onB.write("written on instance B");
    await waitFor(() => onA.text().includes("written on instance B"), 3000, "instance A client");
  });

  it("concurrent conflicting edits converge to the same document (CRDT)", async () => {
    const x = client(a, owner);
    const y = client(b, editor);
    await Promise.all([x.synced, y.synced]);
    // Both type into the title at position 0 "at the same time".
    x.doc.getText("title").insert(0, "[X]");
    y.doc.getText("title").insert(0, "[Y]");
    for (let i = 0; i < 20; i++) {
      x.write(`x${i}`);
      y.write(`y${i}`);
    }
    await waitFor(() => x.text() === y.text() && x.title() === y.title() && x.text().includes("x19") && x.text().includes("y19"), 5000, "convergence");
    expect(x.title()).toMatch(/\[X\]|\[Y\]/);
    expect(x.title()).toContain("[X]");
    expect(x.title()).toContain("[Y]");
  });

  it("server rejects writes from view-only users, even if they bypass the UI", async () => {
    const editorClient = client(a, editor);
    const viewerClient = client(b, viewer);
    await Promise.all([editorClient.synced, viewerClient.synced]);
    viewerClient.write("VIEWER SHOULD NOT WRITE THIS");
    await sleep(600);
    expect(editorClient.text()).not.toContain("VIEWER SHOULD NOT WRITE THIS");
    const room = await b.collab.getRoom(pageId);
    expect(room.stats.updatesRejected).toBeGreaterThan(0);
    // The viewer still receives everyone else's edits.
    editorClient.write("viewer can read this");
    await waitFor(() => viewerClient.text().includes("viewer can read this"), 3000, "viewer to receive");
  });

  it("shares presence (awareness) across instances and clears it on disconnect", async () => {
    const p1 = client(a, owner);
    const p2 = client(b, editor);
    await Promise.all([p1.synced, p2.synced]);
    p1.provider.awareness.setLocalStateField("user", { name: "Owner", color: "#f00" });
    const id = p1.doc.clientID;
    await waitFor(() => (p2.provider.awareness.getStates().get(id) as any)?.user?.name === "Owner", 3000, "presence on B");
    p1.close();
    await waitFor(() => !p2.provider.awareness.getStates().has(id), 3000, "presence removed");
  });

  it("rejects bad tokens and users without access", async () => {
    const bad = client(a, { ...owner, token: "nope" });
    const stranger = client(a, outsider);
    await waitFor(() => bad.closes.includes(4401) && stranger.closes.includes(4404), 3000, "close codes");
  });

  it("revoking access disconnects an open session immediately (on any instance)", async () => {
    const guest = await signup(a, "Guest");
    await api(a, owner).put(`/pages/${pageId}/permissions`, { email: guest.email, role: "EDIT" });
    const g = client(b, guest); // connected to the OTHER instance
    await g.synced;
    g.provider.shouldConnect = true;
    await api(a, owner).delete(`/pages/${pageId}/permissions/${guest.id}`);
    await waitFor(() => g.closes.includes(4403), 3000, "revocation close");
    g.provider.disconnect();
  });

  it("a late joiner on another instance gets edits that are not in Postgres yet", async () => {
    const { pageId: fresh } = await workspaceWithPage(a, owner);
    const w = client(a, owner, fresh);
    await w.synced;
    w.write("not persisted yet");
    // Join immediately, well inside the 1.5s persistence debounce.
    const late = client(b, owner, fresh);
    await late.synced;
    await waitFor(() => late.text().includes("not persisted yet"), 3000, "late joiner");
  });

  it("persists to Postgres and survives a full restart", async () => {
    const { pageId: p } = await workspaceWithPage(a, owner);
    const w = client(a, owner, p);
    await w.synced;
    w.doc.getText("title").delete(0, w.title().length);
    w.doc.getText("title").insert(0, "Durable page");
    w.write("this must survive a restart");
    await sleep(100);
    w.close();

    await stopInstance(a); // flushes all rooms
    a = await startInstance();

    const page = await prisma.page.findUniqueOrThrow({ where: { id: p } });
    expect(page.title).toBe("Durable page");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(page.ydoc!));
    expect(doc.getXmlFragment("default").toString()).toContain("this must survive a restart");

    const again = client(a, owner, p);
    await again.synced;
    expect(again.text()).toContain("this must survive a restart");
    const txt = await api(a, owner).get(`/pages/${p}/text`);
    expect(txt.text).toContain("Durable page");
    expect(txt.text).toContain("this must survive a restart");
  });

  it("deleting a page disconnects everyone", async () => {
    const { pageId: p } = await workspaceWithPage(a, owner);
    const c = client(b, owner, p);
    await c.synced;
    expect((await api(a, owner).delete(`/pages/${p}`)).status).toBe(204);
    await waitFor(() => c.closes.includes(4404), 3000, "delete close");
    c.provider.disconnect();
  });
});
