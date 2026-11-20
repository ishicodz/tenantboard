import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ws } from "../api";
import { useSlug, useSprints, useWorkspace } from "../hooks";
import type { Issue, Project, Sprint, Workflow } from "../types";
import { Avatar, Modal, PriorityIcon, Spinner, TypeIcon, atLeast, fmtDate, useToast } from "../components/ui";
import { IssueDrawer } from "../components/IssueDrawer";
import { CreateIssueModal } from "../components/CreateIssueModal";

function IssueRow({ issue, onOpen, selected, onSelect }: { issue: Issue; onOpen: () => void; selected?: boolean; onSelect?: (v: boolean) => void }) {
  return (
    <div className="issue-row">
      {onSelect && <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${issue.key}`} />}
      <TypeIcon type={issue.type} />
      <button className="link card-key" onClick={onOpen}>
        {issue.key}
      </button>
      <span className="grow clamp" onClick={onOpen}>
        {issue.title}
      </span>
      <span className={`status-chip chip-${issue.status.category.toLowerCase()}`}>{issue.status.name}</span>
      <PriorityIcon priority={issue.priority} />
      <span className="points">{issue.storyPoints ?? "–"}</span>
      <Avatar name={issue.assignee?.name} size={22} />
    </div>
  );
}

export function BacklogPage() {
  const slug = useSlug();
  const { projectId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: wsd } = useWorkspace();
  const canPlan = atLeast(wsd?.role, "MEMBER");
  const { data: sprints = [], isLoading } = useSprints(projectId);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creatingSprint, setCreatingSprint] = useState(false);
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [completing, setCompleting] = useState<Sprint | null>(null);

  const projectQ = useQuery({
    queryKey: ["project", slug, projectId],
    queryFn: () => api.get<{ project: Project; workflow: Workflow }>(ws(slug, `/projects/${projectId}`)),
  });
  const issuesQ = useQuery({
    queryKey: ["backlog", slug, projectId],
    queryFn: () => api.get<{ issues: Issue[] }>(ws(slug, `/issues?projectId=${projectId}&limit=200`)).then((r) => r.issues),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["sprints"] });
    qc.invalidateQueries({ queryKey: ["board"] });
  };
  const onErr = (e: ApiError) => toast(e.message, "error");

  const addToSprint = useMutation({
    mutationFn: (sprintId: string) => api.post(ws(slug, `/sprints/${sprintId}/issues`), { issueIds: [...selected] }),
    onSuccess: () => {
      setSelected(new Set());
      refresh();
    },
    onError: onErr,
  });
  const start = useMutation({ mutationFn: (id: string) => api.post(ws(slug, `/sprints/${id}/start`)), onSuccess: refresh, onError: onErr });

  if (isLoading || issuesQ.isLoading) return <Spinner />;
  const issues = issuesQ.data ?? [];
  const visible = sprints.filter((s) => s.state !== "COMPLETED");
  const completed = sprints.filter((s) => s.state === "COMPLETED");
  const backlog = issues.filter((i) => !i.sprintId);
  const planned = sprints.filter((s) => s.state === "PLANNED");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted small">{projectQ.data?.project.key}</div>
          <h1>Backlog &amp; sprints</h1>
        </div>
        <span className="grow" />
        {canPlan && (
          <>
            <button className="btn" onClick={() => setCreatingSprint(true)}>
              + Sprint
            </button>
            <button className="btn btn-primary" onClick={() => setCreatingIssue(true)}>
              + Issue
            </button>
          </>
        )}
      </div>

      {visible.map((s) => {
        const list = issues.filter((i) => i.sprintId === s.id);
        return (
          <section key={s.id} className="panel">
            <div className="panel-head">
              <strong>{s.name}</strong>
              <span className={`pill ${s.state === "ACTIVE" ? "pill-green" : ""}`}>{s.state.toLowerCase()}</span>
              <span className="muted small">
                {s.startDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : "Not scheduled"} · {list.length} issues ·{" "}
                {list.reduce((a, i) => a + (i.storyPoints ?? 0), 0)} pts
              </span>
              <span className="grow" />
              {canPlan && s.state === "PLANNED" && (
                <button className="btn btn-small" onClick={() => start.mutate(s.id)}>
                  Start sprint
                </button>
              )}
              {canPlan && s.state === "ACTIVE" && (
                <button className="btn btn-small" onClick={() => setCompleting(s)}>
                  Complete sprint
                </button>
              )}
            </div>
            {s.goal && <div className="muted small pad-s">Goal: {s.goal}</div>}
            {list.map((i) => (
              <IssueRow key={i.id} issue={i} onOpen={() => setOpen(i.id)} />
            ))}
            {list.length === 0 && <div className="muted pad-s">No issues. Select issues in the backlog and add them here.</div>}
          </section>
        );
      })}

      <section className="panel">
        <div className="panel-head">
          <strong>Backlog</strong>
          <span className="muted small">{backlog.length} issues</span>
          <span className="grow" />
          {canPlan && selected.size > 0 && (
            <>
              <span className="small">{selected.size} selected → </span>
              {visible.map((s) => (
                <button key={s.id} className="btn btn-small" onClick={() => addToSprint.mutate(s.id)}>
                  Add to {s.name}
                </button>
              ))}
            </>
          )}
        </div>
        {backlog.map((i) => (
          <IssueRow
            key={i.id}
            issue={i}
            onOpen={() => setOpen(i.id)}
            selected={selected.has(i.id)}
            onSelect={
              canPlan
                ? (v) =>
                    setSelected((prev) => {
                      const n = new Set(prev);
                      if (v) n.add(i.id);
                      else n.delete(i.id);
                      return n;
                    })
                : undefined
            }
          />
        ))}
        {backlog.length === 0 && <div className="muted pad-s">Backlog is empty.</div>}
      </section>

      {completed.length > 0 && (
        <details className="panel">
          <summary className="panel-head">
            <strong>Completed sprints ({completed.length})</strong>
          </summary>
          {completed.map((s) => (
            <div key={s.id} className="issue-row">
              <span className="grow">{s.name}</span>
              <span className="muted small">
                {s.doneCount}/{s.issueCount} done · {s.points} pts
              </span>
            </div>
          ))}
        </details>
      )}

      {open && <IssueDrawer issueId={open} workflow={projectQ.data?.workflow} onClose={() => setOpen(null)} />}
      {creatingIssue && projectId && <CreateIssueModal projectId={projectId} workflow={projectQ.data?.workflow} onClose={() => setCreatingIssue(false)} />}
      {creatingSprint && projectId && <CreateSprintModal projectId={projectId} onClose={() => setCreatingSprint(false)} onDone={refresh} />}
      {completing && <CompleteSprintModal sprint={completing} planned={planned} onClose={() => setCompleting(null)} onDone={refresh} />}
    </div>
  );
}

function CreateSprintModal({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const slug = useSlug();
  const toast = useToast();
  const { data: existing = [] } = useSprints(projectId);
  const [name, setName] = useState(`Sprint ${existing.length + 1}`);
  const [goal, setGoal] = useState("");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.post(ws(slug, "/sprints"), {
        projectId,
        name,
        goal: goal || undefined,
        startDate: startDate || null,
        endDate: endDate || null,
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Modal title="New sprint" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Goal
          <input value={goal} onChange={(e) => setGoal(e.target.value)} />
        </label>
        <div className="grid-2">
          <label>
            Start
            <input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            End
            <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary">Create sprint</button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteSprintModal({ sprint, planned, onClose, onDone }: { sprint: Sprint; planned: Sprint[]; onClose: () => void; onDone: () => void }) {
  const slug = useSlug();
  const toast = useToast();
  const [target, setTarget] = useState("");
  const complete = useMutation({
    mutationFn: () => api.post<{ movedOpenIssues: number }>(ws(slug, `/sprints/${sprint.id}/complete`), { moveOpenIssuesTo: target || null }),
    onSuccess: (r) => {
      toast(`Sprint completed. ${r.movedOpenIssues} open issues moved. Report is being generated.`, "success");
      onDone();
      onClose();
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Modal title={`Complete ${sprint.name}`} onClose={onClose}>
      <div className="form">
        <p>Issues not in a Done status will move to:</p>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Backlog</option>
          {planned.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => complete.mutate()} disabled={complete.isPending}>
            Complete sprint
          </button>
        </div>
      </div>
    </Modal>
  );
}
