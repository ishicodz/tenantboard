import { useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ws } from "../api";
import { useAuth } from "../auth";
import { useProjects, useSlug, useWorkspace } from "../hooks";
import type { WorkspaceSummary } from "../types";
import { Avatar, atLeast, fmtDateTime } from "./ui";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

function Notifications() {
  const slug = useSlug();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["notifications", slug],
    queryFn: () => api.get<{ notifications: Notification[]; unread: number }>(ws(slug, "/notifications")),
    refetchInterval: 30_000,
  });
  const readAll = useMutation({
    mutationFn: () => api.post(ws(slug, "/notifications/read-all")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", slug] }),
  });
  return (
    <div className="notif">
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        🔔{data?.unread ? <span className="badge">{data.unread}</span> : null}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="row">
            <strong>Notifications</strong>
            <span className="grow" />
            {!!data?.unread && (
              <button className="link small" onClick={() => readAll.mutate()}>
                Mark all read
              </button>
            )}
          </div>
          {data?.notifications.length ? (
            data.notifications.map((n) => (
              <div key={n.id} className={`notif-item ${n.readAt ? "" : "unread"}`}>
                <div>{n.title}</div>
                {n.body && <div className="muted small clamp">{n.body}</div>}
                <div className="muted small">{fmtDateTime(n.createdAt)}</div>
              </div>
            ))
          ) : (
            <div className="muted pad-s">You're all caught up.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const slug = useSlug();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { data: wsd, isError } = useWorkspace();
  const { data: projects = [] } = useProjects();
  const { data: mine } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.get<{ workspaces: WorkspaceSummary[] }>("/workspaces").then((r) => r.workspaces),
  });
  const role = wsd?.role;

  if (isError) {
    return (
      <div className="center-page">
        <h2>Workspace not found</h2>
        <p className="muted">It doesn't exist or you're not a member.</p>
        <button className="btn" onClick={() => navigate("/")}>
          Back to workspaces
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▥
          </span>
          TenantBoard
        </div>
        <select className="ws-switch" value={slug} onChange={(e) => (e.target.value === "__new" ? navigate("/") : navigate(`/w/${e.target.value}`))} aria-label="Switch workspace">
          {mine?.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name}
            </option>
          ))}
          <option value="__new">+ Other workspaces…</option>
        </select>
        {wsd && <div className="plan-pill">{wsd.workspace.plan} plan · {wsd.role.toLowerCase()}</div>}

        <div className="nav-label">Projects</div>
        {projects.map((p) => (
          <div key={p.id}>
            <NavLink to={`/w/${slug}/p/${p.id}/board`} className={() => `nav-item ${p.id === projectId ? "active" : ""}`}>
              <span className="proj-key">{p.key}</span> {p.name}
            </NavLink>
            {p.id === projectId && (
              <div className="subnav">
                <NavLink to={`/w/${slug}/p/${p.id}/board`} className="nav-sub">
                  Board
                </NavLink>
                <NavLink to={`/w/${slug}/p/${p.id}/backlog`} className="nav-sub">
                  Backlog &amp; sprints
                </NavLink>
                <NavLink to={`/w/${slug}/p/${p.id}/reports`} className="nav-sub">
                  Reports
                </NavLink>
              </div>
            )}
          </div>
        ))}
        <NavLink to={`/w/${slug}/projects`} end className="nav-item muted">
          {atLeast(role, "ADMIN") ? "+ Manage projects" : "All projects"}
        </NavLink>

        <div className="nav-label">Workspace</div>
        <NavLink to={`/w/${slug}/settings/members`} className="nav-item">
          Members
        </NavLink>
        {atLeast(role, "ADMIN") && (
          <>
            <NavLink to={`/w/${slug}/settings/workflows`} className="nav-item">
              Workflows
            </NavLink>
            <NavLink to={`/w/${slug}/settings/webhooks`} className="nav-item">
              Webhooks
            </NavLink>
            <NavLink to={`/w/${slug}/settings/audit`} className="nav-item">
              Audit log
            </NavLink>
          </>
        )}
        <NavLink to={`/w/${slug}/settings/billing`} className="nav-item">
          Billing
        </NavLink>

        <div className="grow" />
        <div className="me">
          <Avatar name={user?.name} size={28} />
          <div className="me-text">
            <div>{user?.name}</div>
            <div className="muted small">{user?.email}</div>
          </div>
          <button className="link small" onClick={logout}>
            Log out
          </button>
        </div>
      </nav>
      <main className="main">
        <div className="topbar">
          <span className="muted">{wsd?.workspace.name}</span>
          <span className="grow" />
          <Notifications />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
