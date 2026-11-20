import request from "supertest";
import WebSocket from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { startServer } from "../src/index.js";

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export type Instance = Awaited<ReturnType<typeof startServer>>;

export async function startInstance(redis = process.env.REDIS_URL!) {
  return startServer(0, redis);
}

export async function stopInstance(i: Instance) {
  await i.collab.close();
  await new Promise<void>((r) => i.server.close(() => r()));
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
}

export function api(inst: Instance, user?: TestUser) {
  const base = request(inst.server);
  const auth = (t: request.Test) => (user ? t.set("Authorization", `Bearer ${user.token}`) : t);
  return {
    get: (p: string) => auth(base.get(`/api${p}`)),
    post: (p: string, b?: object) => auth(base.post(`/api${p}`)).send(b ?? {}),
    patch: (p: string, b?: object) => auth(base.patch(`/api${p}`)).send(b ?? {}),
    put: (p: string, b?: object) => auth(base.put(`/api${p}`)).send(b ?? {}),
    delete: (p: string) => auth(base.delete(`/api${p}`)),
  };
}

export async function signup(inst: Instance, name = "User"): Promise<TestUser> {
  const email = `${name.toLowerCase()}.${uid()}@example.com`;
  const res = await api(inst).post("/auth/register", { email, name, password: "password123" });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return { ...res.body.user, token: res.body.token };
}

export async function workspaceWithPage(inst: Instance, owner: TestUser) {
  const ws = (await api(inst, owner).post("/workspaces", { name: `WS ${uid()}` })).body.workspace;
  const page = (await api(inst, owner).post(`/workspaces/${ws.id}/pages`, { title: "Doc" })).body.page;
  return { workspaceId: ws.id as string, pageId: page.id as string };
}

/** A browser-equivalent client: Y.Doc + the stock y-websocket provider. */
export function connect(inst: Instance, pageId: string, user: TestUser) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${inst.port}/collab`, pageId, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    params: { token: user.token },
    disableBc: true,
    connect: true,
  });
  const closes: number[] = [];
  provider.on("connection-close", (e: CloseEvent | null) => e && closes.push(e.code));
  const synced = new Promise<void>((resolve) => {
    if (provider.synced) resolve();
    provider.once("sync", (s: boolean) => s && resolve());
  });
  return {
    doc,
    provider,
    synced,
    closes,
    text: () => doc.getXmlFragment("default").toString(),
    title: () => doc.getText("title").toString(),
    /** Append a paragraph the way TipTap would. */
    write: (t: string) => {
      const p = new Y.XmlElement("paragraph");
      p.insert(0, [new Y.XmlText(t)]);
      const f = doc.getXmlFragment("default");
      f.insert(f.length, [p]);
    },
    close: () => {
      provider.disconnect();
      provider.destroy();
      doc.destroy();
    },
  };
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeout = 5000, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
