import { describe, expect, it } from "vitest";
import { scopeArgs } from "../src/db/tenant.js";
import { can, canManageRole, PERMISSIONS } from "../src/lib/permissions.js";
import { rankBetween, RANK_STEP } from "../src/lib/rank.js";
import { PLAN_LIMITS, planForPriceId, withinLimit } from "../src/lib/plans.js";
import { diff } from "../src/lib/audit.js";
import { isAllowedWebhookUrl, signPayload, verifySignature } from "../src/jobs/webhooks.js";
import { reportToCsv } from "../src/jobs/reports.js";

describe("tenant scoping (scopeArgs)", () => {
  it("adds workspaceId to reads on tenant models", () => {
    expect(scopeArgs("Issue", "findMany", { where: { title: "x" } }, "ws1")).toEqual({ where: { title: "x", workspaceId: "ws1" } });
    expect(scopeArgs("Issue", "findUnique", { where: { id: "i1" } }, "ws1").where).toEqual({ id: "i1", workspaceId: "ws1" });
    expect(scopeArgs("Issue", "count", undefined, "ws1")).toEqual({ where: { workspaceId: "ws1" } });
  });

  it("forces workspaceId on create, overriding a spoofed value", () => {
    expect(scopeArgs("Issue", "create", { data: { title: "x", workspaceId: "evil" } }, "ws1").data.workspaceId).toBe("ws1");
    const many = scopeArgs("Comment", "createMany", { data: [{ body: "a" }, { body: "b", workspaceId: "evil" }] }, "ws1");
    expect(many.data.every((r: any) => r.workspaceId === "ws1")).toBe(true);
  });

  it("strips workspaceId from update payloads so rows cannot change tenant", () => {
    const a = scopeArgs("Issue", "update", { where: { id: "i1" }, data: { title: "y", workspaceId: "evil" } }, "ws1");
    expect(a.data).toEqual({ title: "y" });
    expect(a.where).toEqual({ id: "i1", workspaceId: "ws1" });
  });

  it("scopes upserts on both branches", () => {
    const a = scopeArgs("Issue", "upsert", { where: { id: "i" }, create: { title: "a" }, update: { workspaceId: "evil" } }, "ws1");
    expect(a.where.workspaceId).toBe("ws1");
    expect(a.create.workspaceId).toBe("ws1");
    expect(a.update).toEqual({});
  });

  it("leaves global models untouched", () => {
    expect(scopeArgs("User", "findMany", { where: { email: "a" } }, "ws1")).toEqual({ where: { email: "a" } });
    expect(scopeArgs("Workspace", "findUnique", { where: { id: "w" } }, "ws1")).toEqual({ where: { id: "w" } });
  });
});

describe("permissions", () => {
  it("viewer is read-only", () => {
    const viewerPerms = Object.keys(PERMISSIONS).filter((p) => can("VIEWER", p as any));
    expect(viewerPerms).toEqual(["workspace:read"]);
  });
  it("only owners manage billing and delete workspaces", () => {
    expect(can("OWNER", "billing:manage")).toBe(true);
    expect(can("ADMIN", "billing:manage")).toBe(false);
    expect(can("ADMIN", "workspace:delete")).toBe(false);
  });
  it("members write issues but cannot manage projects", () => {
    expect(can("MEMBER", "issue:write")).toBe(true);
    expect(can("MEMBER", "project:manage")).toBe(false);
  });
  it("admins cannot touch owners or promote to owner", () => {
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "MEMBER", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "MEMBER", "ADMIN")).toBe(true);
    expect(canManageRole("OWNER", "OWNER", "MEMBER")).toBe(true);
    expect(canManageRole("MEMBER", "VIEWER")).toBe(false);
  });
});

describe("rankBetween", () => {
  it("handles empty, top, bottom and middle", () => {
    expect(rankBetween(null, null)).toBe(RANK_STEP);
    expect(rankBetween(null, 100)).toBe(100 - RANK_STEP);
    expect(rankBetween(100, null)).toBe(100 + RANK_STEP);
    expect(rankBetween(100, 200)).toBe(150);
  });
  it("signals rebalance when the gap is exhausted", () => {
    expect(rankBetween(1, 1 + 1e-9)).toBeNull();
  });
});

describe("plans", () => {
  it("maps Stripe price ids to plans", () => {
    expect(planForPriceId("price_pro_test")).toBe("PRO");
    expect(planForPriceId("price_business_test")).toBe("BUSINESS");
    expect(planForPriceId("price_unknown")).toBeNull();
  });
  it("treats null limits as unlimited", () => {
    expect(withinLimit(PLAN_LIMITS.BUSINESS.projects, 10_000)).toBe(true);
    expect(withinLimit(PLAN_LIMITS.FREE.projects, 2)).toBe(false);
  });
});

describe("webhook signing", () => {
  it("round-trips a signature", () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload("s3cret", ts, '{"a":1}');
    expect(verifySignature("s3cret", `t=${ts},v1=${sig}`, '{"a":1}')).toBe(true);
    expect(verifySignature("wrong", `t=${ts},v1=${sig}`, '{"a":1}')).toBe(false);
    expect(verifySignature("s3cret", `t=${ts},v1=${sig}`, '{"a":2}')).toBe(false);
  });
  it("rejects stale timestamps", () => {
    const ts = Math.floor(Date.now() / 1000) - 3600;
    expect(verifySignature("s", `t=${ts},v1=${signPayload("s", ts, "x")}`, "x")).toBe(false);
  });
  it("validates URLs", () => {
    expect(isAllowedWebhookUrl("ftp://x.com")).toBe(false);
    expect(isAllowedWebhookUrl("not a url")).toBe(false);
    expect(isAllowedWebhookUrl("https://hooks.example.com/x")).toBe(true);
  });
});

describe("misc", () => {
  it("diff reports only changed fields", () => {
    expect(diff({ a: 1, b: 2 }, { a: 1, b: 3 }, ["a", "b"])).toEqual({ b: { from: 2, to: 3 } });
  });
  it("CSV escapes commas and quotes", () => {
    const csv = reportToCsv({ issues: [{ key: "A-1", title: 'Say "hi", ok', status: "Done", category: "DONE", assignee: null, points: 3, resolvedAt: null }] } as any);
    expect(csv.split("\n")[1]).toBe('A-1,"Say ""hi"", ok",Done,DONE,,3,');
  });
});
