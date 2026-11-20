import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ws } from "../api";
import { useProjects, useSlug, useWorkspace } from "../hooks";
import type { Project, Workflow } from "../types";
import { Empty, UsageBar, atLeast, useToast } from "../components/ui";

export function ProjectsPage() {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: wsd } = useWorkspace();
  const { data: projects = [] } = useProjects();
  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows", slug],
    queryFn: () => api.get<{ workflows: Workflow[] }>(ws(slug, "/workflows")).then((r) => r.workflows),
  });
  const [form, setForm] = useState({ key: "", name: "", description: "", workflowId: "" });
  const isAdmin = atLeast(wsd?.role, "ADMIN");

  const create = useMutation({
    mutationFn: () => api.post<{ project: Project }>(ws(slug, "/projects"), { ...form, workflowId: form.workflowId || undefined, description: form.description || undefined }),
    onSuccess: ({ project }) => {
      qc.invalidateQueries({ queryKey: ["projects", slug] });
      qc.invalidateQueries({ queryKey: ["ws", slug] });
      navigate(`/w/${slug}/p/${project.id}/board`);
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div className="page narrow">
      <h1>Projects</h1>
      {wsd && <UsageBar label="Projects on your plan" used={wsd.usage.projects} limit={wsd.limits.projects} />}
      <div className="stack mt">
        {projects.map((p) => (
          <Link key={p.id} to={`/w/${slug}/p/${p.id}/board`} className="panel project-row">
            <span className="proj-key big">{p.key}</span>
            <div className="grow">
              <strong>{p.name}</strong>
              <div className="muted small">{p.description ?? "No description"}</div>
            </div>
            <span className="muted small">{p.issueCount} issues</span>
          </Link>
        ))}
        {projects.length === 0 && <Empty title="No projects yet">{isAdmin ? "Create the first one below." : "Ask an admin to create one."}</Empty>}
      </div>
      {isAdmin && (
        <form
          className="card-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h3>New project</h3>
          <div className="grid-2">
            <label>
              Key
              <input
                required
                placeholder="WEB"
                maxLength={10}
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
              />
            </label>
            <label>
              Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          </div>
          <label>
            Description
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label>
            Workflow
            <select value={form.workflowId} onChange={(e) => setForm({ ...form, workflowId: e.target.value })}>
              <option value="">Default</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button className="btn btn-primary" disabled={create.isPending}>
              Create project
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
