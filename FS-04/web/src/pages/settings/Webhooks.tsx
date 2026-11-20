import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, ApiError, ws } from "../../api";
import { useSlug, useWorkspace } from "../../hooks";
import { Empty, UsageBar, fmtDateTime, useToast } from "../../components/ui";

interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
}
interface Delivery {
  id: string;
  event: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
}

export function WebhooksPage() {
  const slug = useSlug();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: wsd } = useWorkspace();
  const key = ["webhooks", slug];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ webhooks: Webhook[]; availableEvents: string[] }>(ws(slug, "/webhooks")),
  });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["*"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [openHook, setOpenHook] = useState<string | null>(null);
  const onErr = (e: ApiError) => toast(e.message, "error");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["ws", slug] });
  };

  const create = useMutation({
    mutationFn: () => api.post<{ webhook: Webhook }>(ws(slug, "/webhooks"), { url, events }),
    onSuccess: ({ webhook }) => {
      setSecret(webhook.secret);
      setUrl("");
      refresh();
    },
    onError: onErr,
  });
  const patch = useMutation({ mutationFn: ({ id, ...b }: { id: string; active: boolean }) => api.patch(ws(slug, `/webhooks/${id}`), b), onSuccess: refresh, onError: onErr });
  const del = useMutation({ mutationFn: (id: string) => api.delete(ws(slug, `/webhooks/${id}`)), onSuccess: refresh, onError: onErr });
  const test = useMutation({
    mutationFn: (id: string) => api.post(ws(slug, `/webhooks/${id}/test`)),
    onSuccess: (_d, id) => {
      toast("Test event queued", "success");
      setOpenHook(id);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["deliveries", slug, id] }), 1500);
    },
    onError: onErr,
  });

  const limit = wsd?.limits.webhooks ?? 0;
  const toggleEvent = (e: string) =>
    setEvents((cur) => (e === "*" ? ["*"] : cur.includes(e) ? cur.filter((x) => x !== e) : [...cur.filter((x) => x !== "*"), e]));

  return (
    <div className="page narrow">
      <h1>Webhooks</h1>
      <p className="muted">
        We POST JSON to your URL when things happen. Each request is signed with HMAC-SHA256 in the <code>X-TenantBoard-Signature</code> header (
        <code>t=timestamp,v1=hex</code>, signed over <code>{"{t}.{body}"}</code>). Failed deliveries retry with exponential backoff.
      </p>
      {wsd && <UsageBar label="Webhooks on your plan" used={wsd.usage.webhooks} limit={limit} />}
      {limit === 0 && (
        <div className="callout">
          Webhooks are available on Pro and Business. <Link to={`/w/${slug}/settings/billing`}>Upgrade</Link>
        </div>
      )}
      {secret && (
        <div className="callout callout-green">
          Signing secret (shown once): <code className="break">{secret}</code>
          <button className="link small" onClick={() => setSecret(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="stack mt">
        {data?.webhooks.map((h) => (
          <div key={h.id} className="panel">
            <div className="panel-head">
              <code className="clamp grow">{h.url}</code>
              <span className={`pill ${h.active ? "pill-green" : ""}`}>{h.active ? "active" : "paused"}</span>
              <button className="btn btn-small" onClick={() => test.mutate(h.id)}>
                Send test
              </button>
              <button className="btn btn-small" onClick={() => patch.mutate({ id: h.id, active: !h.active })}>
                {h.active ? "Pause" : "Resume"}
              </button>
              <button className="btn btn-small" onClick={() => setOpenHook(openHook === h.id ? null : h.id)}>
                Deliveries
              </button>
              <button className="link small" onClick={() => confirm("Delete webhook?") && del.mutate(h.id)}>
                Delete
              </button>
            </div>
            <div className="pad-s muted small">Events: {h.events.join(", ")}</div>
            {openHook === h.id && <Deliveries hookId={h.id} />}
          </div>
        ))}
        {data?.webhooks.length === 0 && <Empty title="No webhooks yet" />}
      </div>

      {limit > 0 && (
        <form
          className="card-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h3>Add endpoint</h3>
          <input type="url" required placeholder="https://example.com/hooks/tenantboard" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="chips">
            {["*", ...(data?.availableEvents ?? []).filter((e) => e !== "webhook.test")].map((e) => (
              <label key={e} className={`chip ${events.includes(e) ? "chip-on" : ""}`}>
                <input type="checkbox" checked={events.includes(e)} onChange={() => toggleEvent(e)} hidden />
                {e === "*" ? "All events" : e}
              </label>
            ))}
          </div>
          <div>
            <button className="btn btn-primary" disabled={create.isPending || events.length === 0}>
              Add webhook
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Deliveries({ hookId }: { hookId: string }) {
  const slug = useSlug();
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["deliveries", slug, hookId],
    queryFn: () => api.get<{ deliveries: Delivery[] }>(ws(slug, `/webhooks/${hookId}/deliveries`)).then((r) => r.deliveries),
    refetchInterval: 5000,
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => api.post(ws(slug, `/webhooks/${hookId}/deliveries/${id}/redeliver`)),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["deliveries", slug, hookId] }), 1000),
  });
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Status</th>
          <th>Code</th>
          <th>Attempts</th>
          <th>When</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.id}>
            <td>{d.event}</td>
            <td>
              <span className={`pill ${d.status === "SUCCESS" ? "pill-green" : d.status === "FAILED" ? "pill-red" : ""}`}>{d.status.toLowerCase()}</span>
            </td>
            <td title={d.lastError ?? ""}>{d.responseCode ?? "–"}</td>
            <td>{d.attempts}</td>
            <td className="muted small">{fmtDateTime(d.createdAt)}</td>
            <td>
              {d.status === "FAILED" && (
                <button className="link small" onClick={() => redeliver.mutate(d.id)}>
                  Redeliver
                </button>
              )}
            </td>
          </tr>
        ))}
        {data.length === 0 && (
          <tr>
            <td colSpan={6} className="muted">
              No deliveries yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
