import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, ws } from "../../api";
import { useSlug } from "../../hooks";
import type { AuditEntry } from "../../types";
import { fmtDateTime } from "../../components/ui";

const PREFIXES = ["", "issue", "comment", "attachment", "member", "project", "workflow", "sprint", "webhook", "billing", "workspace"];

export function AuditPage() {
  const slug = useSlug();
  const [action, setAction] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["audit", slug, action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<{ entries: AuditEntry[]; nextCursor: string | null }>(
        ws(slug, `/audit-logs?limit=50${action ? `&action=${action}` : ""}${pageParam ? `&cursor=${pageParam}` : ""}`),
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Audit log</h1>
        <span className="grow" />
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
          {PREFIXES.map((p) => (
            <option key={p} value={p}>
              {p ? `${p}.*` : "All actions"}
            </option>
          ))}
        </select>
      </div>
      <p className="muted">Every change in this workspace, who made it and when. Append-only.</p>
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="muted small nowrap">{fmtDateTime(e.createdAt)}</td>
              <td>{e.actor?.name ?? "System"}</td>
              <td>
                <code>{e.action}</code>
              </td>
              <td className="small">
                {e.entityType} {e.metadata?.key ?? ""}
              </td>
              <td className="small muted mono clamp-2">{Object.keys(e.metadata ?? {}).length ? JSON.stringify(e.metadata) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.hasNextPage && (
        <button className="btn mt" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Load more
        </button>
      )}
    </div>
  );
}
