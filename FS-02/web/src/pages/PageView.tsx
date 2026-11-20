import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { applyTextDiff, useCollabSession, useConnectionStatus, usePresence, useYText, type CollabSession } from "../collab";
import { EditorContent, Toolbar, useCollabEditor } from "../components/Editor";
import { CommentsPanel } from "../components/CommentsPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { ShareModal } from "../components/ShareModal";
import { Avatar, ROLE_LABEL } from "../components/ui";
import type { PageMeta, PageRole, User } from "../types";

interface PageResponse {
  page: PageMeta;
  myRole: PageRole;
  canManage: boolean;
}

export function PageView() {
  const { pageId } = useParams();
  const { user } = useAuth();
  const metaQ = useQuery({
    queryKey: ["page", pageId],
    queryFn: () => api.get<PageResponse>(`/pages/${pageId}`),
    refetchInterval: 5000, // picks up permission changes made by others
    retry: false,
  });
  const session = useCollabSession(pageId!, user);

  // Only a real 403/404 means "no access". A failed background refresh (server
  // restarting, network blip) keeps the last good data so the editor stays open.
  const status = (metaQ.error as { status?: number } | null)?.status;
  if (metaQ.isError && (!metaQ.data || status === 403 || status === 404)) {
    return <div className="center-msg">{status === 403 || status === 404 || !status ? "This page doesn't exist or you don't have access." : "Can't reach the server. Retrying…"}</div>;
  }
  if (!metaQ.data || !session || !user) return <div className="center-msg muted">Loading…</div>;
  return <Loaded key={pageId} meta={metaQ.data} session={session} user={user} />;
}

function Loaded({ meta, session, user }: { meta: PageResponse; session: CollabSession; user: User }) {
  const { myRole, canManage, page } = meta;
  const canEdit = myRole === "EDIT";
  const editor = useCollabEditor(session, user, canEdit);
  const { status, synced, closeCode } = useConnectionStatus(session.provider);
  const presence = usePresence(session.provider);
  const title = useYText(session.doc.getText("title"));
  const [panel, setPanel] = useState<"comments" | "history" | null>("comments");
  const [sharing, setSharing] = useState(false);

  if (closeCode === 4403 || closeCode === 4404) {
    return <div className="center-msg">{closeCode === 4403 ? "Your access to this page was removed." : "This page was deleted."}</div>;
  }

  return (
    <div className="page-layout">
      <div className="page-main">
        <header className="page-bar">
          <span className="crumb">{page.icon ?? "📄"} {title || "Untitled"}</span>
          <span className={`conn conn-${status}`} title={`Connection: ${status}`}>
            <span className="conn-dot" />
            {status === "connected" ? (synced ? "Live" : "Syncing…") : status === "connecting" ? "Connecting…" : "Offline, edits saved locally"}
          </span>
          <span className="grow" />
          <div className="presence" aria-label="People on this page">
            {presence.map((p) => (
              <Avatar key={p.userId} name={p.name} color={p.color} size={28} title={`${p.name}${p.userId === user.id ? " (you)" : ""}`} />
            ))}
          </div>
          <span className="pill">{ROLE_LABEL[myRole]}</span>
          <button className="btn btn-small" onClick={() => setSharing(true)}>
            Share
          </button>
          <button className={`btn btn-small ${panel === "comments" ? "btn-on" : ""}`} onClick={() => setPanel(panel === "comments" ? null : "comments")}>
            Comments
          </button>
          <button className={`btn btn-small ${panel === "history" ? "btn-on" : ""}`} onClick={() => setPanel(panel === "history" ? null : "history")}>
            History
          </button>
        </header>
        {canEdit && editor && <Toolbar editor={editor} />}
        <div className="doc-scroll">
          <article className="doc">
            <input
              className="doc-title"
              value={title}
              placeholder="Untitled"
              readOnly={!canEdit}
              aria-label="Page title"
              onChange={(e) => applyTextDiff(session.doc.getText("title"), e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && editor?.commands.focus("start")}
            />
            {!canEdit && <div className="readonly-note">You have {ROLE_LABEL[myRole].toLowerCase().replace("can ", "")} access. Changes from others appear live.</div>}
            <EditorContent editor={editor} />
          </article>
        </div>
      </div>
      {panel && (
        <aside className="side-panel">
          <div className="side-head">
            <strong>{panel === "comments" ? "Comments" : "Version history"}</strong>
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close panel">
              ✕
            </button>
          </div>
          {panel === "comments" ? (
            <CommentsPanel pageId={page.id} role={myRole} canManage={canManage} editor={editor} />
          ) : (
            <HistoryPanel pageId={page.id} role={myRole} editor={editor} session={session} />
          )}
        </aside>
      )}
      {sharing && <ShareModal pageId={page.id} onClose={() => setSharing(false)} />}
    </div>
  );
}
