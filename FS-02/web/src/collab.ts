import { useEffect, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { collabUrl, tokenStore } from "./api";
import type { Presence, User } from "./types";
import { colorFor } from "./components/ui";

export type ConnStatus = "connecting" | "connected" | "disconnected";

export interface CollabSession {
  doc: Y.Doc;
  provider: WebsocketProvider;
}

/**
 * One Y.Doc + WebSocket connection per open page. The provider reconnects
 * automatically with backoff; edits made while offline are kept in the
 * local Y.Doc and merged when the socket comes back.
 */
export function useCollabSession(pageId: string, user: User | null): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null);
  useEffect(() => {
    if (!user) return;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(collabUrl(), pageId, doc, { params: { token: tokenStore.get() ?? "" } });
    provider.awareness.setLocalStateField("user", { name: user.name, color: colorFor(user.id), userId: user.id });
    setSession({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
      setSession(null);
    };
  }, [pageId, user]);
  return session;
}

export function useConnectionStatus(provider: WebsocketProvider | undefined) {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [closeCode, setCloseCode] = useState<number | null>(null);
  useEffect(() => {
    if (!provider) return;
    const onStatus = ({ status }: { status: ConnStatus }) => setStatus(status);
    const onSync = (s: boolean) => setSynced(s);
    const onClose = (e: CloseEvent | null) => {
      if (e && e.code >= 4400) {
        setCloseCode(e.code);
        provider.shouldConnect = false; // auth/permission errors: don't hammer the server
      }
    };
    // The socket can connect before this effect runs (≈15 ms on a warm server),
    // so read the current state instead of only waiting for the next event.
    setStatus(provider.wsconnected ? "connected" : provider.wsconnecting ? "connecting" : "disconnected");
    setSynced(provider.synced);
    provider.on("status", onStatus);
    provider.on("sync", onSync);
    provider.on("connection-close", onClose);
    return () => {
      provider.off("status", onStatus);
      provider.off("sync", onSync);
      provider.off("connection-close", onClose);
    };
  }, [provider]);
  return { status, synced, closeCode };
}

/** Everyone currently on the page (one entry per user, even with several tabs open). */
export function usePresence(provider: WebsocketProvider | undefined): Presence[] {
  const subscribe = (cb: () => void) => {
    provider?.awareness.on("change", cb);
    return () => provider?.awareness.off("change", cb);
  };
  const snapshot = () => {
    if (!provider) return "[]";
    const seen = new Map<string, Presence>();
    provider.awareness.getStates().forEach((state, clientId) => {
      const u = (state as { user?: { name: string; color: string; userId: string } }).user;
      if (u && !seen.has(u.userId)) seen.set(u.userId, { clientId, ...u });
    });
    return JSON.stringify([...seen.values()]);
  };
  return JSON.parse(useSyncExternalStore(subscribe, snapshot));
}

/**
 * Apply a new string to a Y.Text as a minimal edit (common prefix/suffix kept),
 * so two people editing the title at once don't clobber each other.
 */
export function applyTextDiff(ytext: Y.Text, next: string) {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  ytext.doc!.transact(() => {
    if (endPrev > start) ytext.delete(start, endPrev - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  });
}

export function useYText(ytext: Y.Text | undefined) {
  const subscribe = (cb: () => void) => {
    ytext?.observe(cb);
    return () => ytext?.unobserve(cb);
  };
  return useSyncExternalStore(subscribe, () => ytext?.toString() ?? "");
}
