import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyTextDiff } from "./collab";

describe("applyTextDiff (collaborative title editing)", () => {
  it("produces the target string", () => {
    const d = new Y.Doc();
    const t = d.getText("t");
    for (const next of ["Hello", "Hello world", "Help world", "", "Done!"]) {
      applyTextDiff(t, next);
      expect(t.toString()).toBe(next);
    }
  });

  it("only touches the changed span, so concurrent edits elsewhere survive", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "Quarterly plan");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyTextDiff(a.getText("t"), "Q3 Quarterly plan"); // A edits the start
    applyTextDiff(b.getText("t"), "Quarterly plan draft"); // B edits the end at the same time
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText("t").toString()).toBe("Q3 Quarterly plan draft");
    expect(b.getText("t").toString()).toBe(a.getText("t").toString());
  });
});
