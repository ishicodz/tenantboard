import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ws } from "../api";
import { useMembers, useSlug, useSprints } from "../hooks";
import type { Issue, Workflow } from "../types";
import { Modal, useToast } from "./ui";

export function CreateIssueModal({
  projectId,
  workflow,
  defaultSprintId,
  onClose,
}: {
  projectId: string;
  workflow?: Workflow;
  defaultSprintId?: string | null;
  onClose: () => void;
}) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: members = [] } = useMembers();
  const { data: sprints = [] } = useSprints(projectId);
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "TASK",
    priority: "MEDIUM",
    statusId: workflow?.statuses[0]?.id ?? "",
    assigneeId: "",
    sprintId: defaultSprintId ?? "",
    storyPoints: "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api.post<{ issue: Issue }>(ws(slug, "/issues"), {
        projectId,
        title: form.title,
        description: form.description || undefined,
        type: form.type,
        priority: form.priority,
        statusId: form.statusId || undefined,
        assigneeId: form.assigneeId || null,
        sprintId: form.sprintId || null,
        storyPoints: form.storyPoints === "" ? null : Number(form.storyPoints),
      }),
    onSuccess: ({ issue }) => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["backlog"] });
      qc.invalidateQueries({ queryKey: ["ws", slug] });
      toast(`Created ${issue.key}`, "success");
      onClose();
    },
    onError: (e: ApiError) => toast(e.code === "PLAN_LIMIT" ? `${e.message}` : e.message, "error"),
  });

  return (
    <Modal title="Create issue" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label>
          Title
          <input autoFocus required maxLength={250} value={form.title} onChange={set("title")} placeholder="What needs to be done?" />
        </label>
        <div className="grid-2">
          <label>
            Type
            <select value={form.type} onChange={set("type")}>
              {["TASK", "STORY", "BUG", "EPIC"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={set("priority")}>
              {["LOW", "MEDIUM", "HIGH", "URGENT"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={form.statusId} onChange={set("statusId")}>
              {workflow?.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select value={form.assigneeId} onChange={set("assigneeId")}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sprint
            <select value={form.sprintId} onChange={set("sprintId")}>
              <option value="">Backlog</option>
              {sprints
                .filter((s) => s.state !== "COMPLETED")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Story points
            <input type="number" min={0} max={100} value={form.storyPoints} onChange={set("storyPoints")} />
          </label>
        </div>
        <label>
          Description
          <textarea rows={4} value={form.description} onChange={set("description")} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending || !form.title.trim()}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
