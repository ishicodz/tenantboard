import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, download, ws } from "../api";
import { useSlug, useSprints, useWorkspace } from "../hooks";
import { Empty, Spinner, atLeast, fmtDateTime, useToast } from "../components/ui";

interface ReportSummary {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  sprint: { name: string } | null;
  project: { key: string };
}

interface ReportData {
  totals: { issues: number; todo: number; inProgress: number; done: number; completionRate: number };
  points: { committed: number; completed: number };
  avgCycleTimeHours: number | null;
  last7Days: { created: number; resolved: number };
  byStatus: { status: string; count: number }[];
  byAssignee: { assignee: string; total: number; done: number; points: number }[];
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="bar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage() {
  const slug = useSlug();
  const { projectId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: wsd } = useWorkspace();
  const { data: sprints = [] } = useSprints(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [sprintId, setSprintId] = useState("");

  const listQ = useQuery({
    queryKey: ["reports", slug, projectId],
    queryFn: () => api.get<{ reports: ReportSummary[] }>(ws(slug, `/reports?projectId=${projectId}`)).then((r) => r.reports),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "PENDING") ? 2000 : false),
  });
  const reportId = selected ?? listQ.data?.find((r) => r.status === "COMPLETED")?.id ?? null;
  const detailQ = useQuery({
    queryKey: ["report", slug, reportId],
    enabled: !!reportId,
    queryFn: () => api.get<{ report: { id: string; status: string; data: ReportData | null } }>(ws(slug, `/reports/${reportId}`)).then((r) => r.report),
  });
  const generate = useMutation({
    mutationFn: () => api.post(ws(slug, "/reports"), { projectId, sprintId: sprintId || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports", slug, projectId] });
      toast("Report queued. It runs as a background job.", "success");
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });

  const d = detailQ.data?.data;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        <span className="grow" />
        {atLeast(wsd?.role, "MEMBER") && (
          <div className="row gap-s">
            <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} aria-label="Report scope">
              <option value="">Whole project</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => generate.mutate()} disabled={generate.isPending}>
              Generate report
            </button>
          </div>
        )}
      </div>
      <div className="split">
        <div className="panel list-panel">
          {listQ.isLoading && <Spinner />}
          {listQ.data?.map((r) => (
            <button key={r.id} className={`list-item ${r.id === reportId ? "active" : ""}`} onClick={() => setSelected(r.id)}>
              <div>
                {r.sprint?.name ?? (r.type === "weekly" ? "Weekly summary" : "Project report")}
                <span className={`pill ${r.status === "COMPLETED" ? "pill-green" : r.status === "FAILED" ? "pill-red" : ""}`}>{r.status.toLowerCase()}</span>
              </div>
              <div className="muted small">{fmtDateTime(r.createdAt)}</div>
            </button>
          ))}
          {listQ.data?.length === 0 && <Empty title="No reports yet">Completing a sprint generates one automatically.</Empty>}
        </div>
        <div className="grow">
          {d ? (
            <div className="stack">
              <div className="stats">
                <div className="stat">
                  <div className="stat-value">{d.totals.issues}</div>
                  <div className="muted small">Issues</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{d.totals.completionRate}%</div>
                  <div className="muted small">Done</div>
                </div>
                <div className="stat">
                  <div className="stat-value">
                    {d.points.completed}/{d.points.committed}
                  </div>
                  <div className="muted small">Points completed</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{d.avgCycleTimeHours === null ? "–" : `${Math.round(d.avgCycleTimeHours / 24 * 10) / 10}d`}</div>
                  <div className="muted small">Avg cycle time</div>
                </div>
                <div className="stat">
                  <div className="stat-value">
                    +{d.last7Days.created} / ✓{d.last7Days.resolved}
                  </div>
                  <div className="muted small">Created / resolved (7d)</div>
                </div>
              </div>
              <div className="panel pad">
                <h4>By status</h4>
                <Bars rows={d.byStatus.map((s) => ({ label: s.status, value: s.count }))} />
              </div>
              <div className="panel pad">
                <h4>By assignee (done / total)</h4>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Assignee</th>
                      <th>Done</th>
                      <th>Total</th>
                      <th>Points done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byAssignee.map((a) => (
                      <tr key={a.assignee}>
                        <td>{a.assignee}</td>
                        <td>{a.done}</td>
                        <td>{a.total}</td>
                        <td>{a.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <button className="btn" onClick={() => download(ws(slug, `/reports/${reportId}/csv`), `report-${reportId}.csv`)}>
                  Download CSV
                </button>
              </div>
            </div>
          ) : (
            <Empty title={detailQ.isLoading ? "Loading…" : "Select a report"} />
          )}
        </div>
      </div>
    </div>
  );
}
