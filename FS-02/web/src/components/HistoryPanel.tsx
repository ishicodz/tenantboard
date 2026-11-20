import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { api, ApiError } from "../api";
import { applyTextDiff, type CollabSession } from "../collab";
import type { PageRole, SnapshotSummary } from "../types";
import { Modal, fmtDateTime, timeAgo, useToast } from "./ui";

interface SnapshotDetail {
  snapshot: SnapshotSummary;
  state: string;
  title: string;
}

function decode(detail: SnapshotDetail) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(atob(detail.state), (c) => c.charCodeAt(0)));
  return { json: yDocToProsemirrorJSON(doc, "default"), title: doc.getText("title").toString() };
}

export function HistoryPanel({ pageId, role, editor, session }: { pageId: string; role: PageRole; editor: Editor | null; session: CollabSession }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState<SnapshotDetail | null>(null);
  const canEdit = role === "EDIT";
  const key = ["snapshots", pageId];
  const { data: snaps = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ snapshots: SnapshotSummary[] }>(`/pages/${pageId}/snapshots`).then((r) => r.snapshots),
    refetchInterval: 15_000,
  });

  const save = useMutation({
    mutationFn: (label: string) => api.post(`/pages/${pageId}/snapshots`, { label }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast("Version saved", "success");
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  const open = async (s: SnapshotSummary) => {
    try {
      setPreview(await api.get<SnapshotDetail>(`/pages/${pageId}/snapshots/${s.id}`));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  /**
   * Restore = replay the old content into the live document as an ordinary
   * edit. Collaborators see it instantly, it's undoable, and a "Before restore"
   * version is saved first so nothing is ever lost.
   */
  const restore = async () => {
    if (!preview || !editor) return;
    await save.mutateAsync(`Before restoring "${preview.snapshot.label}"`);
    const { json, title } = decode(preview);
    editor.commands.setContent(json);
    applyTextDiff(session.doc.getText("title"), title);
    setPreview(null);
    toast(`Restored "${preview.snapshot.label}"`, "success");
  };

  return (
    <div className="panel-body">
      {canEdit && (
        <button className="btn btn-primary btn-small btn-block" onClick={() => save.mutate(prompt("Name this version", "Manual snapshot") || "Manual snapshot")}>
          Save current version
        </button>
      )}
      <p className="muted xsmall">Versions are also saved automatically every 10 minutes while people edit.</p>
      <ul className="versions">
        {snaps.map((s) => (
          <li key={s.id}>
            <button className="version" onClick={() => open(s)}>
              <span className={`vdot ${s.auto ? "" : "manual"}`} />
              <span className="grow">
                <span className="vlabel">{s.label}</span>
                <span className="muted xsmall">
                  {timeAgo(s.createdAt)}
                  {s.createdBy ? ` · ${s.createdBy.name}` : " · automatic"}
                </span>
              </span>
            </button>
          </li>
        ))}
        {snaps.length === 0 && <li className="muted small">No versions yet.</li>}
      </ul>
      {preview && <PreviewModal detail={preview} canRestore={canEdit} onRestore={restore} onClose={() => setPreview(null)} />}
    </div>
  );
}

function PreviewModal({ detail, canRestore, onRestore, onClose }: { detail: SnapshotDetail; canRestore: boolean; onRestore: () => void; onClose: () => void }) {
  const { json, title } = decode(detail);
  const viewer = useEditor({ editable: false, extensions: [StarterKit], content: json, immediatelyRender: true }, [detail.snapshot.id]);
  return (
    <Modal title={`${detail.snapshot.label} · ${fmtDateTime(detail.snapshot.createdAt)}`} onClose={onClose}>
      <div className="preview">
        <h1 className="preview-title">{title || "Untitled"}</h1>
        <EditorContent editor={viewer} />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        {canRestore && (
          <button className="btn btn-primary" onClick={onRestore}>
            Restore this version
          </button>
        )}
      </div>
    </Modal>
  );
}
