import { useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { PageSummary, User, WorkspaceRole, WorkspaceSummary } from "../types";
import { Avatar, Modal, colorFor, useToast } from "../components/ui";

interface WorkspaceDetail {
  workspace: { id: string; name: string };
  role: WorkspaceRole;
  members: (User & { role: WorkspaceRole })[];
}

export function Layout() {
  const { workspaceId, pageId } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [members, setMembers] = useState(false);

  const wsQ = useQuery({ queryKey: ["ws", workspaceId], queryFn: () => api.get<WorkspaceDetail>(`/workspaces/${workspaceId}`), retry: false });
  const pagesQ = useQuery({
    queryKey: ["pages", workspaceId],
    queryFn: () => api.get<{ pages: PageSummary[] }>(`/workspaces/${workspaceId}/pages`).then((r) => r.pages),
    refetchInterval: 4000, // titles are edited live by others
  });
  const mineQ = useQuery({ queryKey: ["workspaces"], queryFn: () => api.get<{ workspaces: WorkspaceSummary[] }>("/workspaces").then((r) => r.workspaces) });
  const sharedQ = useQuery({ queryKey: ["shared"], queryFn: () => api.get<{ pages: PageSummary[] }>("/pages/shared").then((r) => r.pages) });

  const create = useMutation({
    mutationFn: () => api.post<{ page: PageSummary }>(`/workspaces/${workspaceId}/pages`, {}),
    onSuccess: ({ page }) => {
      qc.invalidateQueries({ queryKey: ["pages", workspaceId] });
      navigate(`/w/${workspaceId}/p/${page.id}`);
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/pages/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["pages", workspaceId] });
      if (id === pageId) navigate(`/w/${workspaceId}`);
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  if (wsQ.isError) return <div className="center-msg">Workspace not found.</div>;
  const pages = pagesQ.data ?? [];
  if (!pageId && pages.length) return <Navigate to={`/w/${workspaceId}/p/${pages[0].id}`} replace />;

  return (
    <div className="app">
      <nav className="sidebar">
        <select className="ws-switch" value={workspaceId} onChange={(e) => navigate(e.target.value === "__all" ? "/" : `/w/${e.target.value}`)} aria-label="Workspace">
          {mineQ.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
          <option value="__all">All workspaces…</option>
        </select>

        <div className="nav-label">
          Pages
          <button className="icon-btn small" title="New page" aria-label="New page" onClick={() => create.mutate()}>
            +
          </button>
        </div>
        {pages.map((p) => (
          <NavLink key={p.id} to={`/w/${workspaceId}/p/${p.id}`} className="nav-item">
            <span className="nav-icon">{p.icon ?? "📄"}</span>
            <span className="grow clamp">{p.title || "Untitled"}</span>
            {p.myRole !== "EDIT" && <span className="role-dot" title={p.myRole.toLowerCase()}>{p.myRole === "VIEW" ? "👁" : "💬"}</span>}
            <button
              className="nav-del"
              aria-label={`Delete ${p.title}`}
              onClick={(e) => {
                e.preventDefault();
                if (confirm(`Delete "${p.title}"?`)) del.mutate(p.id);
              }}
            >
              ✕
            </button>
          </NavLink>
        ))}
        <button className="nav-item muted" onClick={() => create.mutate()}>
          + New page
        </button>

        {!!sharedQ.data?.length && (
          <>
            <div className="nav-label">Shared with me</div>
            {sharedQ.data.map((p) => (
              <NavLink key={p.id} to={`/p/${p.id}`} className="nav-item">
                <span className="nav-icon">{p.icon ?? "📄"}</span>
                <span className="grow clamp">{p.title}</span>
              </NavLink>
            ))}
          </>
        )}

        <div className="grow" />
        <button className="nav-item" onClick={() => setMembers(true)}>
          👥 Members ({wsQ.data?.members.length ?? "…"})
        </button>
        <div className="me">
          <Avatar name={user?.name ?? "?"} color={colorFor(user?.id ?? "")} />
          <div className="me-text">
            <div className="clamp">{user?.name}</div>
            <div className="muted xsmall clamp">{user?.email}</div>
          </div>
          <button className="link xsmall" onClick={logout}>
            Log out
          </button>
        </div>
      </nav>
      <main className="main">
        {pages.length === 0 && pagesQ.isSuccess && !pageId ? <div className="center-msg">No pages yet. Create one from the sidebar.</div> : <Outlet />}
      </main>
      {members && wsQ.data && <MembersModal ws={wsQ.data} onClose={() => setMembers(false)} />}
    </div>
  );
}

function MembersModal({ ws, onClose }: { ws: WorkspaceDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const add = useMutation({
    mutationFn: () => api.post(`/workspaces/${ws.workspace.id}/members`, { email }),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["ws", ws.workspace.id] });
      toast("Member added", "success");
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Modal title={`${ws.workspace.name} members`} onClose={onClose}>
      <div className="stack">
        {ws.members.map((m) => (
          <div key={m.id} className="share-row">
            <Avatar name={m.name} color={colorFor(m.id)} />
            <div className="grow">
              <div>{m.name}</div>
              <div className="muted xsmall">{m.email}</div>
            </div>
            <span className="pill">{m.role.toLowerCase()}</span>
          </div>
        ))}
        {ws.role === "OWNER" ? (
          <form
            className="row gap-s"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <input type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-primary">Add</button>
          </form>
        ) : (
          <p className="muted small">Only workspace owners can add members.</p>
        )}
        <p className="muted xsmall">People need an account first. To share a single page with someone outside the workspace, use Share on that page.</p>
      </div>
    </Modal>
  );
}
