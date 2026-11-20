import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { WorkspaceSummary } from "../types";
import { Spinner, useToast } from "../components/ui";

export function Workspaces() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.get<{ workspaces: WorkspaceSummary[] }>("/workspaces").then((r) => r.workspaces),
  });
  const create = useMutation({
    mutationFn: () => api.post<{ workspace: WorkspaceSummary }>("/workspaces", { name }),
    onSuccess: ({ workspace }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/w/${workspace.slug}/projects`);
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div className="center-page wide">
      <div className="row">
        <div className="brand brand-lg">
          <span className="logo">▥</span> TenantBoard
        </div>
        <span className="grow" />
        <span className="muted">{user?.email}</span>
        <button className="link" onClick={logout}>
          Log out
        </button>
      </div>
      <h1>Your workspaces</h1>
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="ws-grid">
          {data?.map((w) => (
            <Link key={w.id} to={`/w/${w.slug}`} className="ws-card">
              <div className="ws-initial">{w.name[0]}</div>
              <div>
                <strong>{w.name}</strong>
                <div className="muted small">
                  /{w.slug} · {w.plan} · {w.role.toLowerCase()}
                </div>
              </div>
            </Link>
          ))}
          {data?.length === 0 && <p className="muted">You're not in any workspace yet. Create one, or ask an admin to add your email.</p>}
        </div>
      )}
      <form
        className="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3>Create a workspace</h3>
        <p className="muted small">Each workspace is an isolated tenant with its own projects, members, workflows and billing.</p>
        <div className="row gap-s">
          <input placeholder="Company or team name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
          <button className="btn btn-primary" disabled={create.isPending}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
