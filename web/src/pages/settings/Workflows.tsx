import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ws } from "../../api";
import { useSlug } from "../../hooks";
import type { StatusCategory, Workflow } from "../../types";
import { useToast } from "../../components/ui";

export function WorkflowsPage() {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["workflows", slug];
  const { data: workflows = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ workflows: Workflow[] }>(ws(slug, "/workflows")).then((r) => r.workflows),
  });
  const [newName, setNewName] = useState("");
  const create = useMutation({
    mutationFn: () => api.post(ws(slug, "/workflows"), { name: newName }),
    onSuccess: () => {
      setNewName("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  return (
    <div className="page narrow">
      <h1>Workflows</h1>
      <p className="muted">
        Each project uses one workflow. Columns on the board are the workflow's statuses. Turn on enforcement to restrict which moves are allowed.
      </p>
      {workflows.map((w) => (
        <WorkflowEditor key={w.id} workflow={w} />
      ))}
      <form
        className="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3>New workflow</h3>
        <div className="row gap-s">
          <input required placeholder="e.g. Bug triage" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn btn-primary">Create</button>
        </div>
      </form>
    </div>
  );
}

function WorkflowEditor({ workflow: w }: { workflow: Workflow }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StatusCategory>("IN_PROGRESS");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["workflows", slug] });
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["project"] });
  };
  const onErr = (e: ApiError) => toast(e.message, "error");
  const base = ws(slug, `/workflows/${w.id}`);

  const patch = useMutation({ mutationFn: (b: object) => api.patch(base, b), onSuccess: refresh, onError: onErr });
  const addStatus = useMutation({
    mutationFn: () => api.post(`${base}/statuses`, { name, category }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: onErr,
  });
  const delStatus = useMutation({
    mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) => api.delete(`${base}/statuses/${id}${moveTo ? `?moveIssuesTo=${moveTo}` : ""}`),
    onSuccess: refresh,
    onError: onErr,
  });
  const reorder = useMutation({ mutationFn: (statusIds: string[]) => api.put(`${base}/statuses/order`, { statusIds }), onSuccess: refresh, onError: onErr });
  const setTransitions = useMutation({
    mutationFn: (transitions: { fromStatusId: string; toStatusId: string }[]) => api.put(`${base}/transitions`, { transitions }),
    onSuccess: refresh,
    onError: onErr,
  });

  const has = (f: string, t: string) => w.transitions.some((x) => x.fromStatusId === f && x.toStatusId === t);
  const toggle = (f: string, t: string) => {
    const current = w.transitions.map(({ fromStatusId, toStatusId }) => ({ fromStatusId, toStatusId }));
    setTransitions.mutate(has(f, t) ? current.filter((x) => !(x.fromStatusId === f && x.toStatusId === t)) : [...current, { fromStatusId: f, toStatusId: t }]);
  };
  const move = (idx: number, dir: -1 | 1) => {
    const ids = w.statuses.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    reorder.mutate(ids);
  };

  return (
    <section className="panel pad mt">
      <div className="row">
        <h3>{w.name}</h3>
        <span className="grow" />
        <label className="toggle">
          <input type="checkbox" checked={w.enforceTransitions} onChange={(e) => patch.mutate({ enforceTransitions: e.target.checked })} />
          Enforce transitions
        </label>
      </div>
      <h4>Statuses</h4>
      <div className="stack-s">
        {w.statuses.map((s, i) => (
          <div key={s.id} className="status-row">
            <span className={`dot dot-${s.category.toLowerCase()}`} />
            <strong>{s.name}</strong>
            <span className="muted small">{s.category.replace("_", " ").toLowerCase()}</span>
            <span className="grow" />
            <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>
              ↑
            </button>
            <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === w.statuses.length - 1}>
              ↓
            </button>
            <button
              className="link small"
              onClick={() => {
                const other = w.statuses.find((x) => x.id !== s.id);
                if (confirm(`Delete "${s.name}"? Issues in it will move to "${other?.name}".`)) delStatus.mutate({ id: s.id, moveTo: other?.id });
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <form
        className="row gap-s mt-s"
        onSubmit={(e) => {
          e.preventDefault();
          addStatus.mutate();
        }}
      >
        <input required placeholder="New status" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value as StatusCategory)}>
          <option value="TODO">To do</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="DONE">Done</option>
        </select>
        <button className="btn">Add status</button>
      </form>

      <h4 className="mt">Allowed transitions {!w.enforceTransitions && <span className="muted small">(not enforced, any move is allowed)</span>}</h4>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>From ↓ / To →</th>
              {w.statuses.map((s) => (
                <th key={s.id}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {w.statuses.map((f) => (
              <tr key={f.id}>
                <th>{f.name}</th>
                {w.statuses.map((t) => (
                  <td key={t.id}>
                    {f.id === t.id ? (
                      <span className="muted">–</span>
                    ) : (
                      <input type="checkbox" checked={has(f.id, t.id)} onChange={() => toggle(f.id, t.id)} aria-label={`${f.name} to ${t.name}`} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
