import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, download, ws } from "../api";
import { useAuth } from "../auth";
import { useMembers, useSlug, useSprints, useWorkspace } from "../hooks";
import type { Attachment, AuditEntry, Comment, Issue, Workflow } from "../types";
import { Avatar, PriorityIcon, TypeIcon, atLeast, fmtBytes, fmtDate, fmtDateTime, useToast } from "./ui";
import { transitionAllowed } from "./kanbanLogic";

const describeActivity = (a: AuditEntry, wf?: Workflow) => {
  const statusName = (id: unknown) => wf?.statuses.find((s) => s.id === id)?.name ?? "?";
  switch (a.action) {
    case "issue.created":
      return "created the issue";
    case "issue.moved":
      return `moved ${a.metadata.changes?.status?.from ?? ""} → ${a.metadata.changes?.status?.to ?? ""}`;
    case "issue.updated": {
      const parts = Object.entries(a.metadata.changes ?? {}).map(([k, v]: [string, any]) =>
        k === "statusId" ? `status → ${statusName(v.to)}` : k === "description" ? "description" : `${k} → ${v.to ?? "none"}`,
      );
      return `changed ${parts.join(", ")}`;
    }
    case "comment.created":
      return "commented";
    case "attachment.added":
      return `attached ${a.metadata.filename}`;
    case "attachment.removed":
      return `removed ${a.metadata.filename}`;
    default:
      return a.action.replace(".", " ");
  }
};

export function IssueDrawer({ issueId, workflow, onClose }: { issueId: string; workflow?: Workflow; onClose: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { data: wsd } = useWorkspace();
  const { data: members = [] } = useMembers();
  const role = wsd?.role;
  const canEdit = atLeast(role, "MEMBER");
  const [tab, setTab] = useState<"comments" | "attachments" | "activity">("comments");

  const issueQ = useQuery({
    queryKey: ["issue", slug, issueId],
    queryFn: () => api.get<{ issue: Issue }>(ws(slug, `/issues/${issueId}`)).then((r) => r.issue),
  });
  const issue = issueQ.data;
  const { data: sprints = [] } = useSprints(issue?.projectId);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["issue", slug, issueId] });
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["activity", slug, issueId] });
  };

  const update = useMutation({
    mutationFn: (patch: Partial<Issue>) => api.patch(ws(slug, `/issues/${issueId}`), patch),
    onSuccess: invalidate,
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(ws(slug, `/issues/${issueId}`)),
    onSuccess: () => {
      invalidate();
      toast("Issue deleted", "success");
      onClose();
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay overlay-side" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" aria-label="Issue details">
        {!issue ? (
          <div className="pad muted">{issueQ.isError ? "Issue not found" : "Loading…"}</div>
        ) : (
          <>
            <div className="drawer-head">
              <TypeIcon type={issue.type} />
              <span className="card-key">{issue.key}</span>
              <span className="grow" />
              {atLeast(role, "ADMIN") && (
                <button className="btn btn-ghost btn-danger" onClick={() => confirm(`Delete ${issue.key}?`) && remove.mutate()}>
                  Delete
                </button>
              )}
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="drawer-body">
              <EditableTitle value={issue.title} disabled={!canEdit} onSave={(title) => update.mutate({ title })} />

              <div className="fields">
                <label>Status</label>
                <select
                  value={issue.statusId}
                  disabled={!canEdit}
                  onChange={(e) => update.mutate({ statusId: e.target.value })}
                >
                  {workflow?.statuses.map((s) => (
                    <option key={s.id} value={s.id} disabled={!transitionAllowed(workflow, issue.statusId, s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <label>Assignee</label>
                <select
                  value={issue.assigneeId ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.id === user?.id ? " (you)" : ""}
                    </option>
                  ))}
                </select>

                <label>Priority</label>
                <div className="row gap-s">
                  <PriorityIcon priority={issue.priority} />
                  <select value={issue.priority} disabled={!canEdit} onChange={(e) => update.mutate({ priority: e.target.value as Issue["priority"] })}>
                    {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <label>Type</label>
                <select value={issue.type} disabled={!canEdit} onChange={(e) => update.mutate({ type: e.target.value as Issue["type"] })}>
                  {["TASK", "STORY", "BUG", "EPIC"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>

                <label>Sprint</label>
                <select value={issue.sprintId ?? ""} disabled={!canEdit} onChange={(e) => update.mutate({ sprintId: e.target.value || null })}>
                  <option value="">Backlog</option>
                  {sprints
                    .filter((s) => s.state !== "COMPLETED" || s.id === issue.sprintId)
                    .map((s) => (
                      <option key={s.id} value={s.id} disabled={s.state === "COMPLETED"}>
                        {s.name} {s.state === "ACTIVE" ? "(active)" : ""}
                      </option>
                    ))}
                </select>

                <label>Story points</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={issue.storyPoints ?? ""}
                  key={`pts-${issue.storyPoints}`}
                  disabled={!canEdit}
                  onBlur={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    if (v !== issue.storyPoints) update.mutate({ storyPoints: v });
                  }}
                />

                <label>Due date</label>
                <input
                  type="date"
                  value={issue.dueDate ? issue.dueDate.slice(0, 10) : ""}
                  disabled={!canEdit}
                  onChange={(e) => update.mutate({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                />

                <label>Reporter</label>
                <div className="row gap-s">
                  <Avatar name={issue.reporter.name} size={20} /> {issue.reporter.name}
                </div>

                <label>Created</label>
                <div className="muted">{fmtDate(issue.createdAt)}</div>
              </div>

              <Description value={issue.description} disabled={!canEdit} onSave={(description) => update.mutate({ description })} />

              <div className="tabs">
                {(["comments", "attachments", "activity"] as const).map((t) => (
                  <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
                    {t[0].toUpperCase() + t.slice(1)}
                    {t === "comments" && issue.commentCount > 0 && <span className="count">{issue.commentCount}</span>}
                    {t === "attachments" && issue.attachmentCount > 0 && <span className="count">{issue.attachmentCount}</span>}
                  </button>
                ))}
              </div>
              {tab === "comments" && <Comments issueId={issue.id} canWrite={canEdit} canModerate={atLeast(role, "ADMIN")} onChange={invalidate} />}
              {tab === "attachments" && (
                <Attachments issueId={issue.id} canWrite={canEdit} canModerate={atLeast(role, "ADMIN")} maxMb={wsd?.limits.maxAttachmentMb ?? 5} onChange={invalidate} />
              )}
              {tab === "activity" && <Activity issueId={issue.id} workflow={workflow} />}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function EditableTitle({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="title-input"
      value={v}
      disabled={disabled}
      aria-label="Title"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Description({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <div className="section">
      <h4>Description</h4>
      {editing ? (
        <>
          <textarea rows={6} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
          <div className="row gap-s mt-s">
            <button
              className="btn btn-primary"
              onClick={() => {
                onSave(v);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className={`description ${disabled ? "" : "clickable"}`} onClick={() => !disabled && setEditing(true)}>
          {value ? value : <span className="muted">{disabled ? "No description" : "Add a description…"}</span>}
        </div>
      )}
    </div>
  );
}

function Comments({ issueId, canWrite, canModerate, onChange }: { issueId: string; canWrite: boolean; canModerate: boolean; onChange: () => void }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const key = ["comments", slug, issueId];
  const { data: comments = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ comments: Comment[] }>(ws(slug, `/issues/${issueId}/comments`)).then((r) => r.comments),
  });
  const add = useMutation({
    mutationFn: () => api.post(ws(slug, `/issues/${issueId}/comments`), { body }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: key });
      onChange();
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(ws(slug, `/issues/${issueId}/comments/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      onChange();
    },
  });
  return (
    <div className="stack">
      {comments.map((c) => (
        <div key={c.id} className="comment">
          <Avatar name={c.author.name} size={26} />
          <div className="grow">
            <div className="row gap-s">
              <strong>{c.author.name}</strong>
              <span className="muted small">{fmtDateTime(c.createdAt)}</span>
              <span className="grow" />
              {(c.author.id === user?.id || canModerate) && (
                <button className="link small" onClick={() => del.mutate(c.id)}>
                  Delete
                </button>
              )}
            </div>
            <div className="comment-body">{c.body}</div>
          </div>
        </div>
      ))}
      {comments.length === 0 && <div className="muted">No comments yet.</div>}
      {canWrite && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <textarea rows={3} placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div>
            <button className="btn btn-primary" disabled={!body.trim() || add.isPending}>
              Comment
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Attachments({
  issueId,
  canWrite,
  canModerate,
  maxMb,
  onChange,
}: {
  issueId: string;
  canWrite: boolean;
  canModerate: boolean;
  maxMb: number;
  onChange: () => void;
}) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const key = ["attachments", slug, issueId];
  const { data: files = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ attachments: Attachment[] }>(ws(slug, `/issues/${issueId}/attachments`)).then((r) => r.attachments),
  });
  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return api.post(ws(slug, `/issues/${issueId}/attachments`), fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      onChange();
      toast("File attached", "success");
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(ws(slug, `/issues/${issueId}/attachments/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      onChange();
    },
  });
  return (
    <div className="stack">
      {files.map((f) => (
        <div key={f.id} className="file-row">
          <span className="file-icon">📎</span>
          <button className="link" onClick={() => download(ws(slug, `/issues/${issueId}/attachments/${f.id}/download`), f.filename)}>
            {f.filename}
          </button>
          <span className="muted small">
            {fmtBytes(f.size)} · {f.uploader.name}
          </span>
          <span className="grow" />
          {(f.uploader.id === user?.id || canModerate) && (
            <button className="link small" onClick={() => del.mutate(f.id)}>
              Remove
            </button>
          )}
        </div>
      ))}
      {files.length === 0 && <div className="muted">No attachments.</div>}
      {canWrite && (
        <div>
          <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          <button className="btn" onClick={() => input.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? "Uploading…" : "Attach file"}
          </button>
          <span className="muted small"> Max {maxMb} MB on your plan</span>
        </div>
      )}
    </div>
  );
}

function Activity({ issueId, workflow }: { issueId: string; workflow?: Workflow }) {
  const slug = useSlug();
  const { data = [] } = useQuery({
    queryKey: ["activity", slug, issueId],
    queryFn: () => api.get<{ activity: AuditEntry[] }>(ws(slug, `/issues/${issueId}/activity`)).then((r) => r.activity),
  });
  return (
    <ul className="timeline">
      {data.map((a) => (
        <li key={a.id}>
          <strong>{a.actor?.name ?? "System"}</strong> {describeActivity(a, workflow)}
          <div className="muted small">{fmtDateTime(a.createdAt)}</div>
        </li>
      ))}
      {data.length === 0 && <li className="muted">No activity yet.</li>}
    </ul>
  );
}
