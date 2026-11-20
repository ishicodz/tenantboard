import { useEffect } from "react";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import type { CollabSession } from "../collab";
import type { User } from "../types";
import { colorFor } from "./ui";

export function useCollabEditor(session: CollabSession, user: User, editable: boolean) {
  const editor = useEditor(
    {
      editable,
      shouldRerenderOnTransaction: true, // keep toolbar active-states in sync
      immediatelyRender: true,
      extensions: [
        StarterKit.configure({ undoRedo: false }), // Yjs provides collaborative undo
        Collaboration.configure({ document: session.doc, field: "default" }),
        CollaborationCaret.configure({
          provider: session.provider,
          user: { name: user.name, color: colorFor(user.id), userId: user.id },
        }),
        Placeholder.configure({ placeholder: editable ? "Start writing…" : "" }),
      ],
      editorProps: { attributes: { class: "prose", spellcheck: "true" } },
    },
    [session],
  );
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  return editor;
}

function Btn({ on, label, title, run, disabled }: { on?: boolean; label: string; title: string; run: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`tb-btn ${on ? "on" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
}

export function Toolbar({ editor }: { editor: TiptapEditor }) {
  const c = () => editor.chain().focus();
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="↶" title="Undo (Ctrl+Z)" run={() => c().undo().run()} />
      <Btn label="↷" title="Redo (Ctrl+Shift+Z)" run={() => c().redo().run()} />
      <span className="tb-sep" />
      <Btn label="H1" title="Heading 1" on={editor.isActive("heading", { level: 1 })} run={() => c().toggleHeading({ level: 1 }).run()} />
      <Btn label="H2" title="Heading 2" on={editor.isActive("heading", { level: 2 })} run={() => c().toggleHeading({ level: 2 }).run()} />
      <Btn label="H3" title="Heading 3" on={editor.isActive("heading", { level: 3 })} run={() => c().toggleHeading({ level: 3 }).run()} />
      <span className="tb-sep" />
      <Btn label="B" title="Bold (Ctrl+B)" on={editor.isActive("bold")} run={() => c().toggleBold().run()} />
      <Btn label="I" title="Italic (Ctrl+I)" on={editor.isActive("italic")} run={() => c().toggleItalic().run()} />
      <Btn label="S" title="Strikethrough" on={editor.isActive("strike")} run={() => c().toggleStrike().run()} />
      <Btn label="</>" title="Inline code" on={editor.isActive("code")} run={() => c().toggleCode().run()} />
      <span className="tb-sep" />
      <Btn label="• List" title="Bullet list" on={editor.isActive("bulletList")} run={() => c().toggleBulletList().run()} />
      <Btn label="1. List" title="Numbered list" on={editor.isActive("orderedList")} run={() => c().toggleOrderedList().run()} />
      <Btn label="❝" title="Quote" on={editor.isActive("blockquote")} run={() => c().toggleBlockquote().run()} />
      <Btn label="{ }" title="Code block" on={editor.isActive("codeBlock")} run={() => c().toggleCodeBlock().run()} />
      <Btn label="—" title="Divider" run={() => c().setHorizontalRule().run()} />
    </div>
  );
}

export { EditorContent };
