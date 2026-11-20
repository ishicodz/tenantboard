import type { Issue, Workflow } from "../types";

export type ColumnMap = Record<string, Issue[]>;

export function findContainer(cols: ColumnMap, id: string): string | undefined {
  if (id in cols) return id;
  return Object.keys(cols).find((k) => cols[k].some((i) => i.id === id));
}

export function transitionAllowed(workflow: Workflow | undefined, from: string, to: string) {
  if (!workflow || !workflow.enforceTransitions || from === to) return true;
  return workflow.transitions.some((t) => t.fromStatusId === from && t.toStatusId === to);
}

/** Move `activeId` so it sits where `overId` is (an item or an empty column). Pure. */
export function moveItem(cols: ColumnMap, activeId: string, overId: string): ColumnMap {
  const from = findContainer(cols, activeId);
  const to = findContainer(cols, overId);
  if (!from || !to) return cols;
  const fromItems = [...cols[from]];
  const idx = fromItems.findIndex((i) => i.id === activeId);
  if (idx < 0) return cols;
  const [item] = fromItems.splice(idx, 1);

  if (from === to) {
    const overIdx = overId === to ? fromItems.length : cols[to].findIndex((i) => i.id === overId);
    fromItems.splice(overIdx < 0 ? fromItems.length : overIdx, 0, item);
    return { ...cols, [from]: fromItems };
  }

  const toItems = [...cols[to]];
  const overIdx = overId === to ? toItems.length : toItems.findIndex((i) => i.id === overId);
  toItems.splice(overIdx < 0 ? toItems.length : overIdx, 0, { ...item, statusId: to });
  return { ...cols, [from]: fromItems, [to]: toItems };
}

/** The API wants the card above (beforeId) and below (afterId) the drop position. */
export function neighbours(items: Issue[], id: string): { beforeId: string | null; afterId: string | null } {
  const i = items.findIndex((x) => x.id === id);
  return { beforeId: i > 0 ? items[i - 1].id : null, afterId: i >= 0 && i < items.length - 1 ? items[i + 1].id : null };
}
