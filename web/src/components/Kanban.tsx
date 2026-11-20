import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue, Status, Workflow } from "../types";
import { Avatar, PriorityIcon, TypeIcon } from "./ui";
import { findContainer, moveItem, neighbours, transitionAllowed, type ColumnMap } from "./kanbanLogic";

interface Props {
  columns: { status: Status; issues: Issue[] }[];
  workflow?: Workflow;
  canEdit: boolean;
  onMove: (issueId: string, statusId: string, beforeId: string | null, afterId: string | null) => Promise<void>;
  onOpen: (issue: Issue) => void;
}

export function IssueCard({ issue, onOpen, dragging }: { issue: Issue; onOpen?: () => void; dragging?: boolean }) {
  return (
    <div
      className={`card ${dragging ? "card-dragging" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={-1}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
    >
      <div className="card-title">{issue.title}</div>
      <div className="card-meta">
        <TypeIcon type={issue.type} />
        <span className="card-key">{issue.key}</span>
        <PriorityIcon priority={issue.priority} />
        {issue.commentCount > 0 && <span className="muted small">💬 {issue.commentCount}</span>}
        <span className="grow" />
        {issue.storyPoints !== null && <span className="points">{issue.storyPoints}</span>}
        <Avatar name={issue.assignee?.name} size={22} />
      </div>
    </div>
  );
}

function SortableCard({ issue, onOpen, disabled }: { issue: Issue; onOpen: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      aria-label={`${issue.key}: ${issue.title}`}
    >
      <IssueCard issue={issue} onOpen={onOpen} />
    </div>
  );
}

function Column({
  status,
  issues,
  blocked,
  canEdit,
  onOpen,
}: {
  status: Status;
  issues: Issue[];
  blocked: boolean;
  canEdit: boolean;
  onOpen: (i: Issue) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id, disabled: blocked });
  const points = issues.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
  return (
    <section className={`column ${isOver ? "column-over" : ""} ${blocked ? "column-blocked" : ""}`} aria-label={status.name}>
      <header className="column-head">
        <span className={`dot dot-${status.category.toLowerCase()}`} />
        <span className="column-name">{status.name}</span>
        <span className="count">{issues.length}</span>
        <span className="grow" />
        {points > 0 && <span className="muted small">{points} pts</span>}
      </header>
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="column-body">
          {issues.map((i) => (
            <SortableCard key={i.id} issue={i} onOpen={() => onOpen(i)} disabled={!canEdit} />
          ))}
          {issues.length === 0 && <div className="column-empty">{blocked ? "Transition not allowed" : "Drop issues here"}</div>}
        </div>
      </SortableContext>
    </section>
  );
}

export function Kanban({ columns, workflow, canEdit, onMove, onOpen }: Props) {
  const fromProps = useMemo<ColumnMap>(() => Object.fromEntries(columns.map((c) => [c.status.id, c.issues])), [columns]);
  const [cols, setCols] = useState<ColumnMap>(fromProps);
  const [activeId, setActiveId] = useState<string | null>(null);
  const origin = useRef<{ status: string; index: number } | null>(null);

  useEffect(() => {
    if (!activeId) setCols(fromProps);
  }, [fromProps, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeIssue = activeId ? Object.values(cols).flat().find((i) => i.id === activeId) : null;

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    const status = findContainer(cols, id)!;
    origin.current = { status, index: cols[status].findIndex((i) => i.id === id) };
    setActiveId(id);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !origin.current) return;
    const to = findContainer(cols, String(over.id));
    const from = findContainer(cols, String(active.id));
    if (!to || !from || to === from) return;
    if (!transitionAllowed(workflow, origin.current.status, to)) return;
    setCols((c) => moveItem(c, String(active.id), String(over.id)));
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const start = origin.current;
    setActiveId(null);
    origin.current = null;
    if (!over || !start) return setCols(fromProps);

    let next = cols;
    const to = findContainer(next, String(over.id));
    if (to && to === findContainer(next, id) && String(over.id) !== id) next = moveItem(next, id, String(over.id));
    const status = findContainer(next, id)!;
    if (!transitionAllowed(workflow, start.status, status)) return setCols(fromProps);
    const index = next[status].findIndex((i) => i.id === id);
    setCols(next);
    if (status === start.status && index === start.index) return;

    const { beforeId, afterId } = neighbours(next[status], id);
    try {
      await onMove(id, status, beforeId, afterId);
    } catch {
      setCols(fromProps);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setCols(fromProps);
      }}
    >
      <div className="board">
        {columns.map(({ status }) => (
          <Column
            key={status.id}
            status={status}
            issues={cols[status.id] ?? []}
            canEdit={canEdit}
            blocked={!!origin.current && !transitionAllowed(workflow, origin.current.status, status.id)}
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay>{activeIssue ? <IssueCard issue={activeIssue} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
