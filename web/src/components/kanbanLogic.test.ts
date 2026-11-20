import { describe, expect, it } from "vitest";
import { findContainer, moveItem, neighbours, transitionAllowed, type ColumnMap } from "./kanbanLogic";
import type { Issue, Workflow } from "../types";

const issue = (id: string, statusId: string) => ({ id, statusId, title: id }) as unknown as Issue;
const cols = (): ColumnMap => ({
  todo: [issue("a", "todo"), issue("b", "todo")],
  doing: [issue("c", "doing")],
  done: [],
});

describe("kanban logic", () => {
  it("finds the container for a card or a column id", () => {
    expect(findContainer(cols(), "c")).toBe("doing");
    expect(findContainer(cols(), "done")).toBe("done");
    expect(findContainer(cols(), "zzz")).toBeUndefined();
  });

  it("moves a card into another column before the hovered card", () => {
    const next = moveItem(cols(), "a", "c");
    expect(next.todo.map((i) => i.id)).toEqual(["b"]);
    expect(next.doing.map((i) => i.id)).toEqual(["a", "c"]);
    expect(next.doing[0].statusId).toBe("doing");
  });

  it("drops onto an empty column", () => {
    const next = moveItem(cols(), "b", "done");
    expect(next.done.map((i) => i.id)).toEqual(["b"]);
  });

  it("reorders within a column", () => {
    const next = moveItem(cols(), "b", "a");
    expect(next.todo.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("computes neighbours for the move API", () => {
    const list = [issue("x", "s"), issue("y", "s"), issue("z", "s")];
    expect(neighbours(list, "y")).toEqual({ beforeId: "x", afterId: "z" });
    expect(neighbours(list, "x")).toEqual({ beforeId: null, afterId: "y" });
    expect(neighbours(list, "z")).toEqual({ beforeId: "y", afterId: null });
  });

  it("respects enforced workflow transitions", () => {
    const wf = { enforceTransitions: true, transitions: [{ id: "1", fromStatusId: "todo", toStatusId: "doing" }] } as unknown as Workflow;
    expect(transitionAllowed(wf, "todo", "doing")).toBe(true);
    expect(transitionAllowed(wf, "todo", "done")).toBe(false);
    expect(transitionAllowed(wf, "todo", "todo")).toBe(true);
    expect(transitionAllowed({ ...wf, enforceTransitions: false }, "todo", "done")).toBe(true);
  });
});
