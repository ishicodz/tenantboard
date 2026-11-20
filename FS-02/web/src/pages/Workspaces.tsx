import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { PageSummary, WorkspaceSummary } from "../types";
import { useToast } from "../components/ui";

export function Workspaces() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const { data } = useQuery({ queryKey: ["workspaces"], queryFn: () => api.get<{ workspaces: WorkspaceSummary[] }>("/workspaces").then((r) => r.workspaces) });
  const { data: shared } = useQuery({ queryKey: ["shared"], queryFn: () => api.get<{ pages: PageSummary[] }>("/pages/shared").then((r) => r.pages) });
  const create = useMutation({
    mutationFn: () => api.post<{ workspace: WorkspaceSummary }>("/workspaces", { name }),
    onSuccess: ({ workspace }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/w/${workspace.id}`);
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div className="center-page">
      <div className="row">
        <div className="brand">
          <span className="logo">A</span> Inkwell
        </div>
        <span className="grow" />
        <span className="muted small">{user?.email}</span>
        <button className="link small" onClick={logout}>
          Log out
        </button>
      </div>
      <h1>Your workspaces</h1>
      <div className="ws-grid">
        {data?.map((w) => (
          <Link key={w.id} to={`/w/${w.id}`} className="ws-card">
            <div className="ws-initial">{w.name[0]?.toUpperCase()}</div>
            <div>
              <strong>{w.name}</strong>
              <div className="muted xsmall">
                {w.pageCount} pages · {w.memberCount} members · {w.role.toLowerCase()}
              </div>
            </div>
          </Link>
        ))}
        {data?.length === 0 && <p className="muted">No workspaces yet.</p>}
      </div>
      {!!shared?.length && (
        <>
          <h3 className="mt">Shared with me</h3>
          <div className="stack-s">
            {shared.map((p) => (
              <Link key={p.id} to={`/p/${p.id}`} className="shared-row">
                {p.icon ?? "📄"} {p.title} <span className="muted xsmall">in {p.workspace?.name} · {p.myRole.toLowerCase()}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <form
        className="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3>New workspace</h3>
        <div className="row gap-s">
          <input placeholder="Team or project name" value={name} onChange={(e) => setName(e.target.value)} required />
          <button className="btn btn-primary" disabled={create.isPending}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
