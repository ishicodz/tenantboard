import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { Comment, PageRole } from "../types";
import { Avatar, colorFor, timeAgo, useToast } from "./ui";

function selectedText(editor: Editor | null) {
  if (!editor) return "";
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, " ").trim().slice(0, 500);
}

export function CommentsPanel({ pageId, role, canManage, editor }: { pageId: string; role: PageRole; canManage: boolean; editor: Editor | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [quote, setQuote] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const canComment = role !== "VIEW";
  const key = ["comments", pageId];

  const { data: comments = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ comments: Comment[] }>(`/pages/${pageId}/comments`).then((r) => r.comments),
    refetchInterval: 4000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onErr = (e: ApiError) => toast(e.message, "error");

  const add = useMutation({
    mutationFn: (v: { body: string; quote?: string; parentId?: string }) => api.post(`/pages/${pageId}/comments`, v),
    onSuccess: () => {
      setBody("");
      setQuote("");
      refresh();
    },
    onError: onErr,
  });
  const resolve = useMutation({
    mutationFn: (c: Comment) => api.patch(`/pages/${pageId}/comments/${c.id}`, { resolved: !c.resolved }),
    onSuccess: refresh,
    onError: onErr,
  });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/pages/${pageId}/comments/${id}`), onSuccess: refresh, onError: onErr });

  const visible = comments.filter((c) => c.resolved === showResolved);
  const openCount = comments.filter((c) => !c.resolved).length;

  return (
    <div className="panel-body">
      <div className="seg">
        <button className={!showResolved ? "on" : ""} onClick={() => setShowResolved(false)}>
          Open ({openCount})
        </button>
        <button className={showResolved ? "on" : ""} onClick={() => setShowResolved(true)}>
          Resolved ({comments.length - openCount})
        </button>
      </div>

      {canComment && !showResolved && (
        <form
          className="comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate({ body, quote: quote || undefined });
          }}
        >
          {quote ? (
            <div className="quote">
              “{quote}” <button type="button" className="link small" onClick={() => setQuote("")}>remove</button>
            </div>
          ) : (
            <button type="button" className="link small" onClick={() => setQuote(selectedText(editor))} title="Select text in the page first">
              + Quote selected text
            </button>
          )}
          <textarea rows={3} placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn btn-primary btn-small" disabled={!body.trim() || add.isPending}>
            Comment
          </button>
        </form>
      )}
      {!canComment && <p className="muted small">You have view-only access, so you can read comments but not add them.</p>}

      {visible.map((c) => (
        <Thread
          key={c.id}
          c={c}
          canComment={canComment}
          canDelete={(id: string) => id === user?.id || canManage}
          onReply={(text) => add.mutate({ body: text, parentId: c.id })}
          onResolve={() => resolve.mutate(c)}
          onDelete={(id) => del.mutate(id)}
        />
      ))}
      {visible.length === 0 && <p className="muted small center">{showResolved ? "No resolved threads." : "No open comments."}</p>}
    </div>
  );
}

function Thread({
  c,
  canComment,
  canDelete,
  onReply,
  onResolve,
  onDelete,
}: {
  c: Comment;
  canComment: boolean;
  canDelete: (authorId: string) => boolean;
  onReply: (t: string) => void;
  onResolve: () => void;
  onDelete: (id: string) => void;
}) {
  const [reply, setReply] = useState("");
  const Item = ({ x }: { x: Comment }) => (
    <div className="comment">
      <Avatar name={x.author.name} color={colorFor(x.author.id)} size={24} />
      <div className="grow">
        <div className="row gap-s">
          <strong className="small">{x.author.name}</strong>
          <span className="muted xsmall">{timeAgo(x.createdAt)}</span>
          <span className="grow" />
          {canDelete(x.author.id) && (
            <button className="link xsmall" onClick={() => onDelete(x.id)}>
              Delete
            </button>
          )}
        </div>
        <div className="comment-text">{x.body}</div>
      </div>
    </div>
  );
  return (
    <div className={`thread ${c.resolved ? "resolved" : ""}`}>
      {c.quote && <div className="quote">“{c.quote}”</div>}
      <Item x={c} />
      {c.replies?.map((r) => <Item key={r.id} x={r} />)}
      {canComment && (
        <div className="row gap-s mt-s">
          {!c.resolved && (
            <input
              placeholder="Reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && reply.trim()) {
                  onReply(reply);
                  setReply("");
                }
              }}
            />
          )}
          <button className="btn btn-small" onClick={onResolve}>
            {c.resolved ? "Reopen" : "Resolve"}
          </button>
        </div>
      )}
    </div>
  );
}
