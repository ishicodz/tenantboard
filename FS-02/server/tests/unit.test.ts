import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { atLeast, resolveRole } from "../src/lib/access.js";
import { buildDoc } from "../src/lib/welcome.js";
import { docToText } from "../src/collab/persistence.js";

const page = { memberRole: "COMMENT" as const, createdById: "creator" };

describe("resolveRole", () => {
  it("workspace owners always edit", () => expect(resolveRole(page, "u", "OWNER", "VIEW")).toBe("EDIT"));
  it("page creators who are members edit", () => expect(resolveRole(page, "creator", "MEMBER", null)).toBe("EDIT"));
  it("explicit share beats the member default (up or down)", () => {
    expect(resolveRole(page, "u", "MEMBER", "VIEW")).toBe("VIEW");
    expect(resolveRole(page, "u", "MEMBER", "EDIT")).toBe("EDIT");
  });
  it("members fall back to the page default", () => expect(resolveRole(page, "u", "MEMBER", null)).toBe("COMMENT"));
  it("guests need an explicit share", () => {
    expect(resolveRole(page, "u", null, "VIEW")).toBe("VIEW");
    expect(resolveRole(page, "u", null, null)).toBeNull();
    expect(resolveRole(page, "creator", null, null)).toBeNull(); // creator who left the workspace
  });
  it("orders roles", () => {
    expect(atLeast("EDIT", "COMMENT")).toBe(true);
    expect(atLeast("VIEW", "COMMENT")).toBe(false);
    expect(atLeast(null, "VIEW")).toBe(false);
  });
});

describe("CRDT properties the product relies on", () => {
  it("merging is order-independent and idempotent", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "hello");
    b.getText("t").insert(0, "world");
    const ua = Y.encodeStateAsUpdate(a);
    const ub = Y.encodeStateAsUpdate(b);
    const m1 = new Y.Doc();
    const m2 = new Y.Doc();
    Y.applyUpdate(m1, ua);
    Y.applyUpdate(m1, ub);
    Y.applyUpdate(m2, ub);
    Y.applyUpdate(m2, ua);
    Y.applyUpdate(m2, ua); // duplicate delivery
    expect(m1.getText("t").toString()).toBe(m2.getText("t").toString());
    expect(m1.getText("t").toString().length).toBe(10);
  });

  it("an offline client's edits merge cleanly when it reconnects", () => {
    const server = new Y.Doc();
    const offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(server));
    server.getText("t").insert(0, "online edit. ");
    offline.getText("t").insert(0, "offline edit. ");
    Y.applyUpdate(server, Y.encodeStateAsUpdate(offline, Y.encodeStateVector(server)));
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(server, Y.encodeStateVector(offline)));
    expect(server.getText("t").toString()).toBe(offline.getText("t").toString());
    expect(server.getText("t").toString()).toContain("offline edit.");
    expect(server.getText("t").toString()).toContain("online edit.");
  });
});

describe("document helpers", () => {
  it("buildDoc produces TipTap-shaped content and docToText reads it back", () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildDoc("Title", [{ type: "heading", level: 1, text: "H" }, { type: "paragraph", text: "P" }, { type: "bullet", items: ["a", "b"] }]));
    expect(doc.getText("title").toString()).toBe("Title");
    expect(docToText(doc)).toBe("H\nP\na\nb");
    expect(doc.getXmlFragment("default").toString()).toContain("<heading");
  });
});
