import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ws } from "../../api";
import { useAuth } from "../../auth";
import { useMembers, useSlug, useWorkspace } from "../../hooks";
import type { Role } from "../../types";
import { Avatar, UsageBar, atLeast, fmtDate, useToast } from "../../components/ui";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
const ROLE_HELP: Record<Role, string> = {
  OWNER: "Everything, including billing and deleting the workspace",
  ADMIN: "Manage members, projects, workflows, webhooks, audit log",
  MEMBER: "Create and edit issues, comment, plan sprints",
  VIEWER: "Read-only access",
};

export function MembersPage() {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: wsd } = useWorkspace();
  const { data: members = [] } = useMembers();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const myRole = wsd?.role;
  const isAdmin = atLeast(myRole, "ADMIN");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["members", slug] });
    qc.invalidateQueries({ queryKey: ["ws", slug] });
  };
  const onErr = (e: ApiError) => toast(e.message, "error");

  const add = useMutation({
    mutationFn: () => api.post(ws(slug, "/members"), { email, role }),
    onSuccess: () => {
      setEmail("");
      refresh();
      toast("Member added", "success");
    },
    onError: onErr,
  });
  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.patch(ws(slug, `/members/${id}`), { role }),
    onSuccess: refresh,
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(ws(slug, `/members/${id}`)),
    onSuccess: (_d, id) => {
      if (id === user?.id) navigate("/");
      else refresh();
    },
    onError: onErr,
  });

  return (
    <div className="page narrow">
      <h1>Members</h1>
      {wsd && <UsageBar label="Seats on your plan" used={wsd.usage.members} limit={wsd.limits.members} />}
      <table className="table mt">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                <div className="row gap-s">
                  <Avatar name={m.name} size={26} />
                  <div>
                    <div>
                      {m.name} {m.id === user?.id && <span className="muted">(you)</span>}
                    </div>
                    <div className="muted small">{m.email}</div>
                  </div>
                </div>
              </td>
              <td>
                {isAdmin && m.id !== user?.id && (myRole === "OWNER" || m.role !== "OWNER") ? (
                  <select value={m.role} onChange={(e) => change.mutate({ id: m.id, role: e.target.value as Role })} aria-label={`Role for ${m.name}`}>
                    {ROLES.filter((r) => myRole === "OWNER" || r !== "OWNER").map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                ) : (
                  <span className="pill">{m.role.toLowerCase()}</span>
                )}
              </td>
              <td className="muted small">{fmtDate(m.joinedAt)}</td>
              <td>
                {(m.id === user?.id || (isAdmin && (myRole === "OWNER" || m.role !== "OWNER"))) && (
                  <button className="link small" onClick={() => confirm(m.id === user?.id ? "Leave this workspace?" : `Remove ${m.name}?`) && remove.mutate(m.id)}>
                    {m.id === user?.id ? "Leave" : "Remove"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {isAdmin && (
        <form
          className="card-form"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <h3>Add a member</h3>
          <p className="muted small">They need a TenantBoard account first.</p>
          <div className="row gap-s">
            <input type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.filter((r) => myRole === "OWNER" || r !== "OWNER").map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={add.isPending}>
              Add
            </button>
          </div>
          <p className="muted small">{ROLE_HELP[role]}</p>
        </form>
      )}
    </div>
  );
}
