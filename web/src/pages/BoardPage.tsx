import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ws } from "../api";
import { useMembers, useSlug, useWorkspace } from "../hooks";
import type { Issue, Project, Sprint, Status, Workflow } from "../types";
import { Kanban } from "../components/Kanban";
import { IssueDrawer } from "../components/IssueDrawer";
import { CreateIssueModal } from "../components/CreateIssueModal";
import { Spinner, atLeast, fmtDate, useToast } from "../components/ui";

interface BoardResponse {
  board: { id: string; name: string };
  project: Project;
  activeSprint: Sprint | null;
  workflow: Workflow;
  columns: { status: Status; issues: Issue[] }[];
}

export function BoardPage() {
  const slug = useSlug();
  const { projectId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: wsd } = useWorkspace();
  const { data: members = [] } = useMembers();
  const [sprint, setSprint] = useState("active");
  const [assignee, setAssignee] = useState("");
  const [search, setSearch] = useState("");
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const projectQ = useQuery({
    queryKey: ["project", slug, projectId],
    queryFn: () => api.get<{ project: Project; boards: { id: string }[] }>(ws(slug, `/projects/${projectId}`)),
  });
  const boardId = projectQ.data?.boards[0]?.id;

  const params = new URLSearchParams();
  if (sprint !== "all") params.set("sprintId", sprint);
  if (assignee) params.set("assigneeId", assignee);
  if (search) params.set("q", search);
  const boardKey = ["board", slug, projectId, boardId, params.toString()];
  const boardQ = useQuery({
    queryKey: boardKey,
    enabled: !!boardId,
    queryFn: () => api.get<BoardResponse>(ws(slug, `/projects/${projectId}/boards/${boardId}?${params}`)),
  });

  const onMove = async (issueId: string, statusId: string, beforeId: string | null, afterId: string | null) => {
    try {
      await api.post(ws(slug, `/issues/${issueId}/move`), { statusId, beforeId, afterId });
      qc.invalidateQueries({ queryKey: ["board"] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Move failed", "error");
      throw e;
    }
  };

  if (projectQ.isLoading || boardQ.isLoading) return <Spinner />;
  if (!boardQ.data) return <div className="pad muted">Board not found.</div>;
  const { project, activeSprint, workflow, columns } = boardQ.data;
  const canEdit = atLeast(wsd?.role, "MEMBER");

  return (
    <div className="page page-board">
      <div className="page-head">
        <div>
          <div className="muted small">{project.key}</div>
          <h1>{project.name}</h1>
          {sprint === "active" && (
            <div className="muted small">
              {activeSprint
                ? `${activeSprint.name} · ${fmtDate(activeSprint.startDate)} – ${fmtDate(activeSprint.endDate)}${activeSprint.goal ? ` · Goal: ${activeSprint.goal}` : ""}`
                : "No active sprint. Showing all issues. Start one from Backlog & sprints."}
            </div>
          )}
        </div>
        <span className="grow" />
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Create issue
          </button>
        )}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search issues…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <select value={sprint} onChange={(e) => setSprint(e.target.value)} aria-label="Sprint filter">
          <option value="active">Active sprint</option>
          <option value="all">All issues</option>
          <option value="backlog">Backlog only</option>
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee filter">
          <option value="">Everyone</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {workflow.enforceTransitions && <span className="pill">Workflow transitions enforced</span>}
        {!canEdit && <span className="pill">Read-only (viewer)</span>}
      </div>
      <Kanban columns={columns} workflow={workflow} canEdit={canEdit} onMove={onMove} onOpen={(i) => setOpenIssue(i.id)} />
      {openIssue && <IssueDrawer issueId={openIssue} workflow={workflow} onClose={() => setOpenIssue(null)} />}
      {creating && (
        <CreateIssueModal
          projectId={project.id}
          workflow={workflow}
          defaultSprintId={sprint === "active" ? activeSprint?.id : null}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
