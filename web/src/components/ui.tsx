import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { IssueType, Priority, Role } from "../types";

// ---------- Toasts ----------

type Toast = { id: number; message: string; tone: "info" | "error" | "success" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------- Modal ----------

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Small pieces ----------

const COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#dc2626", "#2563eb"];
export function Avatar({ name, size = 24 }: { name?: string | null; size?: number }) {
  if (!name) return <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned" />;
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className="avatar" title={name} style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}>
      {initials}
    </span>
  );
}

const TYPE_ICON: Record<IssueType, { label: string; cls: string }> = {
  TASK: { label: "✓", cls: "t-task" },
  BUG: { label: "●", cls: "t-bug" },
  STORY: { label: "◆", cls: "t-story" },
  EPIC: { label: "⚡", cls: "t-epic" },
};
export function TypeIcon({ type }: { type: IssueType }) {
  const t = TYPE_ICON[type];
  return (
    <span className={`type-icon ${t.cls}`} title={type.toLowerCase()} aria-label={type.toLowerCase()}>
      {t.label}
    </span>
  );
}

const PRIORITY_ICON: Record<Priority, string> = { LOW: "↓", MEDIUM: "=", HIGH: "↑", URGENT: "⇈" };
export function PriorityIcon({ priority }: { priority: Priority }) {
  return (
    <span className={`prio prio-${priority.toLowerCase()}`} title={`${priority.toLowerCase()} priority`}>
      {PRIORITY_ICON[priority]}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />;
}

export function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  return (
    <div className="usage">
      <div className="usage-head">
        <span>{label}</span>
        <span className="muted">
          {used} / {limit === null ? "∞" : limit}
        </span>
      </div>
      <div className="usage-track">
        <div className={`usage-fill ${pct >= 90 ? "usage-hot" : ""}`} style={{ width: `${limit === null ? 4 : pct}%` }} />
      </div>
    </div>
  );
}

// Mirrors the server permission matrix for UI affordances. The server is the source of truth.
const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };
export const atLeast = (role: Role | undefined, min: Role) => !!role && RANK[role] >= RANK[min];

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
export const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
