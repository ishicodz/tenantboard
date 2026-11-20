import request from "supertest";
import { createApp } from "../src/app.js";

export const app = createApp();

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
}

export async function signup(name = "User"): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${uid()}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ email, name, password: "password123" });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body.user, token: res.body.token };
}

/** Tiny authenticated client: api(user).get("/path") */
export function api(user: TestUser) {
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${user.token}`);
  return {
    get: (p: string) => auth(request(app).get(`/api${p}`)),
    post: (p: string, body?: object) => auth(request(app).post(`/api${p}`)).send(body ?? {}),
    patch: (p: string, body?: object) => auth(request(app).patch(`/api${p}`)).send(body ?? {}),
    put: (p: string, body?: object) => auth(request(app).put(`/api${p}`)).send(body ?? {}),
    delete: (p: string) => auth(request(app).delete(`/api${p}`)),
    upload: (p: string, field: string, buf: Buffer, filename: string) =>
      auth(request(app).post(`/api${p}`)).attach(field, buf, filename),
  };
}

export async function createWorkspace(owner: TestUser, name = "Acme") {
  const res = await api(owner).post("/workspaces", { name: `${name} ${uid()}` });
  if (res.status !== 201) throw new Error(`workspace failed: ${JSON.stringify(res.body)}`);
  return res.body.workspace as { id: string; slug: string; name: string };
}

export async function createProject(owner: TestUser, slug: string, key = "WEB") {
  const res = await api(owner).post(`/workspaces/${slug}/projects`, { key, name: `${key} project` });
  if (res.status !== 201) throw new Error(`project failed: ${JSON.stringify(res.body)}`);
  const detail = await api(owner).get(`/workspaces/${slug}/projects/${res.body.project.id}`);
  return detail.body as {
    project: { id: string; key: string; workflowId: string };
    workflow: { id: string; statuses: { id: string; name: string; category: string }[] };
    boards: { id: string }[];
  };
}

export async function addMember(owner: TestUser, slug: string, user: TestUser, role: string) {
  const res = await api(owner).post(`/workspaces/${slug}/members`, { email: user.email, role });
  if (res.status !== 201) throw new Error(`addMember failed: ${JSON.stringify(res.body)}`);
}

export async function createIssue(user: TestUser, slug: string, projectId: string, extra: object = {}) {
  const res = await api(user).post(`/workspaces/${slug}/issues`, { projectId, title: `Issue ${uid()}`, ...extra });
  if (res.status !== 201) throw new Error(`issue failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.issue as { id: string; key: string; statusId: string; rank: number; number: number };
}
