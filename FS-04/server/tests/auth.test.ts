import request from "supertest";
import { describe, expect, it } from "vitest";
import { app, signup } from "./helpers.js";

describe("auth", () => {
  it("registers, logs in and returns the current user", async () => {
    const email = `alice.${Date.now()}@example.com`;
    const reg = await request(app).post("/api/auth/register").send({ email, name: "Alice", password: "password123" });
    expect(reg.status).toBe(201);
    expect(reg.body.token).toBeTruthy();
    expect(reg.body.user).not.toHaveProperty("passwordHash");

    const login = await request(app).post("/api/auth/login").send({ email: email.toUpperCase(), password: "password123" });
    expect(login.status).toBe(200);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.body.user.email).toBe(email);
  });

  it("rejects duplicate emails, bad passwords, weak passwords and missing tokens", async () => {
    const u = await signup("Bob");
    expect((await request(app).post("/api/auth/register").send({ email: u.email, name: "x", password: "password123" })).status).toBe(409);
    expect((await request(app).post("/api/auth/login").send({ email: u.email, password: "nope-nope" })).status).toBe(401);
    expect((await request(app).post("/api/auth/register").send({ email: "c@example.com", name: "C", password: "short" })).status).toBe(400);
    expect((await request(app).get("/api/workspaces")).status).toBe(401);
    expect((await request(app).get("/api/workspaces").set("Authorization", "Bearer garbage")).status).toBe(401);
  });

  it("exposes a health check", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
