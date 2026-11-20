import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PageRole, User } from "../types";
import { Avatar, Modal, ROLE_LABEL, colorFor, useToast } from "./ui";

interface Perms {
  memberRole: PageRole;
  canManage: boolean;
  shares: (User & { role: PageRole; isMember: boolean })[];
  members: (User & { workspaceRole: string })[];
}

const ROLES: PageRole[] = ["VIEW", "COMMENT", "EDIT"];

export function ShareModal({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PageRole>("EDIT");
  const key = ["perms", pageId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<Perms>(`/pages/${pageId}/permissions`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["page", pageId] });
  };
  const onErr = (e: ApiError) => toast(e.message, "error");

  const share = useMutation({
    mutationFn: (v: { email: string; role: PageRole }) => api.put(`/pages/${pageId}/permissions`, v),
    onSuccess: () => {
      setEmail("");
      refresh();
    },
    onError: onErr,
  });
  const unshare = useMutation({ mutationFn: (id: string) => api.delete(`/pages/${pageId}/permissions/${id}`), onSuccess: refresh, onError: onErr });
  const setDefault = useMutation({ mutationFn: (r: PageRole) => api.patch(`/pages/${pageId}`, { memberRole: r }), onSuccess: refresh, onError: onErr });

  if (!data) return null;
  const manage = data.canManage;

  return (
    <Modal title="Share" onClose={onClose}>
      <div className="stack">
        {manage && (
          <form
            className="row gap-s"
            onSubmit={(e) => {
              e.preventDefault();
              share.mutate({ email, role });
            }}
          >
            <input type="email" required placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value as PageRole)} aria-label="Access level">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button className="btn btn-primary">Invite</button>
          </form>
        )}

        <div className="share-row">
          <span className="ws-icon">W</span>
          <div className="grow">
            <div>Everyone in the workspace</div>
            <div className="muted xsmall">{data.members.length} members (owners can always edit)</div>
          </div>
          {manage ? (
            <select value={data.memberRole} onChange={(e) => setDefault.mutate(e.target.value as PageRole)} aria-label="Workspace member access">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          ) : (
            <span className="pill">{ROLE_LABEL[data.memberRole]}</span>
          )}
        </div>

        {data.shares.map((s) => (
          <div key={s.id} className="share-row">
            <Avatar name={s.name} color={colorFor(s.id)} />
            <div className="grow">
              <div>
                {s.name} {!s.isMember && <span className="pill">guest</span>}
              </div>
              <div className="muted xsmall">{s.email}</div>
            </div>
            {manage ? (
              <>
                <select value={s.role} onChange={(e) => share.mutate({ email: s.email, role: e.target.value as PageRole })} aria-label={`Access for ${s.name}`}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button className="link small" onClick={() => unshare.mutate(s.id)}>
                  Remove
                </button>
              </>
            ) : (
              <span className="pill">{ROLE_LABEL[s.role]}</span>
            )}
          </div>
        ))}

        <p className="muted xsmall">
          Changes apply instantly: anyone currently on the page is moved to their new access level, or disconnected if access was removed.
          {!manage && " Only the page creator or a workspace owner can change sharing."}
        </p>
        <button
          className="btn btn-small"
          onClick={() => {
            navigator.clipboard?.writeText(location.href);
            toast("Link copied", "success");
          }}
        >
          Copy link
        </button>
      </div>
    </Modal>
  );
}
