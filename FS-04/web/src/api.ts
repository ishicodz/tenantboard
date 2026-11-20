const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
const TOKEN_KEY = "tb_token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const err = (data as any)?.error ?? {};
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>("PATCH", p, b),
  put: <T = any>(p: string, b?: unknown) => request<T>("PUT", p, b),
  delete: <T = any>(p: string) => request<T>("DELETE", p),
};

/** Downloads an authenticated file (attachments, CSV) via a blob URL. */
export async function download(path: string, filename: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD_FAILED", "Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Workspace-scoped path helper: ws("acme", "/issues") -> "/workspaces/acme/issues" */
export const ws = (slug: string, path = "") => `/workspaces/${slug}${path}`;
