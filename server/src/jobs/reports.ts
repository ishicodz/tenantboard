import { prisma } from "../db/client.js";
import { tenantDb } from "../db/tenant.js";

export interface ReportData {
  scope: { projectId: string; projectKey: string; sprintId: string | null; sprintName: string | null };
  generatedAt: string;
  totals: { issues: number; todo: number; inProgress: number; done: number; completionRate: number };
  points: { committed: number; completed: number };
  avgCycleTimeHours: number | null;
  last7Days: { created: number; resolved: number };
  byStatus: { status: string; count: number }[];
  byAssignee: { assignee: string; total: number; done: number; points: number }[];
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  issues: { key: string; title: string; status: string; category: string; assignee: string | null; points: number | null; resolvedAt: string | null }[];
}

export async function buildReportData(workspaceId: string, projectId: string, sprintId: string | null): Promise<ReportData> {
  const db = tenantDb(workspaceId);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const sprint = sprintId ? await db.sprint.findUnique({ where: { id: sprintId } }) : null;
  const issues = await db.issue.findMany({
    where: { projectId, ...(sprintId ? { sprintId } : {}) },
    include: { status: true, assignee: { select: { name: true } } },
    orderBy: { number: "asc" },
  });

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const cat = (c: string) => issues.filter((i) => i.status.category === c).length;
  const done = issues.filter((i) => i.status.category === "DONE");
  const cycle = done.filter((i) => i.resolvedAt).map((i) => (i.resolvedAt!.getTime() - i.createdAt.getTime()) / 3_600_000);

  const byStatus = new Map<string, number>();
  const byAssignee = new Map<string, { total: number; done: number; points: number }>();
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const i of issues) {
    byStatus.set(i.status.name, (byStatus.get(i.status.name) ?? 0) + 1);
    const a = i.assignee?.name ?? "Unassigned";
    const entry = byAssignee.get(a) ?? { total: 0, done: 0, points: 0 };
    entry.total++;
    if (i.status.category === "DONE") {
      entry.done++;
      entry.points += i.storyPoints ?? 0;
    }
    byAssignee.set(a, entry);
    byType[i.type] = (byType[i.type] ?? 0) + 1;
    byPriority[i.priority] = (byPriority[i.priority] ?? 0) + 1;
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    scope: { projectId, projectKey: project.key, sprintId, sprintName: sprint?.name ?? null },
    generatedAt: new Date().toISOString(),
    totals: {
      issues: issues.length,
      todo: cat("TODO"),
      inProgress: cat("IN_PROGRESS"),
      done: done.length,
      completionRate: issues.length ? Math.round((done.length / issues.length) * 1000) / 10 : 0,
    },
    points: {
      committed: sum(issues.map((i) => i.storyPoints ?? 0)),
      completed: sum(done.map((i) => i.storyPoints ?? 0)),
    },
    avgCycleTimeHours: cycle.length ? Math.round((sum(cycle) / cycle.length) * 10) / 10 : null,
    last7Days: {
      created: issues.filter((i) => i.createdAt.getTime() >= weekAgo).length,
      resolved: issues.filter((i) => i.resolvedAt && i.resolvedAt.getTime() >= weekAgo).length,
    },
    byStatus: [...byStatus].map(([status, count]) => ({ status, count })),
    byAssignee: [...byAssignee].map(([assignee, v]) => ({ assignee, ...v })),
    byType,
    byPriority,
    issues: issues.slice(0, 1000).map((i) => ({
      key: `${project.key}-${i.number}`,
      title: i.title,
      status: i.status.name,
      category: i.status.category,
      assignee: i.assignee?.name ?? null,
      points: i.storyPoints,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    })),
  };
}

export async function generateReport({ reportId }: { reportId: string }) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return;
  try {
    const data = await buildReportData(report.workspaceId, report.projectId, report.sprintId);
    await prisma.report.update({ where: { id: reportId }, data: { status: "COMPLETED", data: data as object, completedAt: new Date() } });
  } catch (err) {
    await prisma.report.update({ where: { id: reportId }, data: { status: "FAILED" } });
    throw err;
  }
}

/** Cron job (Mondays 08:00 UTC in worker): weekly summary for every project. */
export async function generateWeeklyReports() {
  const projects = await prisma.project.findMany({ select: { id: true, workspaceId: true } });
  for (const p of projects) {
    const r = await prisma.report.create({ data: { workspaceId: p.workspaceId, projectId: p.id, type: "weekly" } });
    await generateReport({ reportId: r.id });
  }
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function reportToCsv(data: ReportData): string {
  const rows: unknown[][] = [["key", "title", "status", "category", "assignee", "points", "resolvedAt"]];
  for (const i of data.issues) rows.push([i.key, i.title, i.status, i.category, i.assignee, i.points, i.resolvedAt]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
