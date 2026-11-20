import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { WebSocket } from "ws";
import type { PageRole } from "@prisma/client";
import { config } from "../config.js";
import { atLeast } from "../lib/access.js";
import { b64, type Bus, type BusMessage } from "./bus.js";
import { loadDocState, saveDocState } from "./persistence.js";

// y-websocket wire protocol message types
export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const MSG_QUERY_AWARENESS = 3;

/** Transaction origin for updates that arrived from another instance via Redis. */
export const REMOTE = Symbol("remote-instance");
/** Transaction origin for the initial load from Postgres. */
const LOADED = Symbol("loaded-from-db");

export interface Conn {
  ws: WebSocket;
  userId: string;
  role: PageRole;
  /** Awareness client ids this socket controls, removed when it disconnects. */
  clientIds: Set<number>;
}

export type RoleResolver = (userId: string, pageId: string) => Promise<PageRole | null>;

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, Conn>();
  private persistTimer: NodeJS.Timeout | null = null;
  private firstDirtyAt: number | null = null;
  private saving: Promise<void> = Promise.resolve();
  stats = { updatesIn: 0, updatesRejected: 0 };

  constructor(
    readonly pageId: string,
    private bus: Bus,
    private resolveRole: RoleResolver,
    private onEmpty: (room: Room) => void,
  ) {
    // The server is not a participant, so drop its own (empty) awareness state.
    this.awareness.setLocalState(null);

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === LOADED) return;
      const msg = encoding.createEncoder();
      encoding.writeVarUint(msg, MSG_SYNC);
      syncProtocol.writeUpdate(msg, update);
      this.broadcast(encoding.toUint8Array(msg));
      if (origin !== REMOTE) this.bus.publish(this.pageId, { t: "update", d: b64.enc(update) });
      this.schedulePersist();
    });

    this.awareness.on("update", ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (origin && typeof origin === "object" && "clientIds" in (origin as Conn)) {
        const conn = origin as Conn;
        added.forEach((id) => conn.clientIds.add(id));
        removed.forEach((id) => conn.clientIds.delete(id));
      }
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
      const msg = encoding.createEncoder();
      encoding.writeVarUint(msg, MSG_AWARENESS);
      encoding.writeVarUint8Array(msg, update);
      this.broadcast(encoding.toUint8Array(msg));
      if (origin !== REMOTE) this.bus.publish(this.pageId, { t: "awareness", d: b64.enc(update) });
    });
  }

  async init() {
    const stored = await loadDocState(this.pageId);
    if (stored) Y.applyUpdate(this.doc, stored, LOADED);
    await this.bus.subscribe(this.pageId, (m) => this.onBusMessage(m));
    // Ask other instances for edits that are not in Postgres yet.
    this.bus.publish(this.pageId, { t: "sync-request", sv: b64.enc(Y.encodeStateVector(this.doc)) });
  }

  private onBusMessage(m: BusMessage) {
    switch (m.t) {
      case "update":
        Y.applyUpdate(this.doc, b64.dec(m.d), REMOTE);
        break;
      case "awareness":
        awarenessProtocol.applyAwarenessUpdate(this.awareness, b64.dec(m.d), REMOTE);
        break;
      case "sync-request": {
        const diff = Y.encodeStateAsUpdate(this.doc, b64.dec(m.sv));
        // An empty diff is 2 bytes; only reply when there is something to send.
        if (diff.length > 2) this.bus.publish(this.pageId, { t: "update", d: b64.enc(diff) });
        break;
      }
      case "permissions":
        void this.refreshPermissions();
        break;
      case "deleted":
        this.closeAll(4404, "Page deleted");
        break;
    }
  }

  // ---------- connections ----------

  addConnection(ws: WebSocket, userId: string, role: PageRole) {
    const conn: Conn = { ws, userId, role, clientIds: new Set() };
    this.conns.set(ws, conn);

    ws.on("message", (data: Buffer) => {
      try {
        this.handleMessage(conn, new Uint8Array(data));
      } catch (err) {
        console.warn(`[collab] bad message on ${this.pageId}:`, (err as Error).message);
      }
    });
    ws.on("close", () => this.removeConnection(conn));

    // Kick off sync: send our state vector, and current presence.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.send(conn, encoding.toUint8Array(enc));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states));
      this.send(conn, encoding.toUint8Array(a));
    }
  }

  private handleMessage(conn: Conn, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);

    if (type === MSG_SYNC) {
      const subtype = decoding.readVarUint(decoder);
      if (subtype === syncProtocol.messageYjsSyncStep1) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MSG_SYNC);
        syncProtocol.readSyncStep1(decoder, reply, this.doc);
        this.send(conn, encoding.toUint8Array(reply));
        return;
      }
      // Step 2 and incremental updates are writes. Enforce permissions here,
      // server-side: a read-only client that bypasses the UI still cannot edit.
      const update = decoding.readVarUint8Array(decoder);
      if (!atLeast(conn.role, "EDIT")) {
        this.stats.updatesRejected++;
        return;
      }
      this.stats.updatesIn++;
      Y.applyUpdate(this.doc, update, conn);
      return;
    }

    if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn);
      return;
    }

    if (type === MSG_QUERY_AWARENESS) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]));
      this.send(conn, encoding.toUint8Array(a));
    }
  }

  private removeConnection(conn: Conn) {
    if (!this.conns.delete(conn.ws)) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.clientIds], null);
    if (this.conns.size === 0) this.onEmpty(this);
  }

  /** Re-resolve every open connection's role (after a sharing change). */
  async refreshPermissions() {
    for (const conn of [...this.conns.values()]) {
      const role = await this.resolveRole(conn.userId, this.pageId);
      if (!role) conn.ws.close(4403, "Access revoked");
      else conn.role = role;
    }
  }

  closeAll(code: number, reason: string) {
    for (const c of this.conns.values()) c.ws.close(code, reason);
  }

  private send(conn: Conn, msg: Uint8Array) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(msg);
  }

  private broadcast(msg: Uint8Array) {
    for (const c of this.conns.values()) this.send(c, msg);
  }

  // ---------- persistence ----------

  private schedulePersist() {
    const now = Date.now();
    this.firstDirtyAt ??= now;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const wait = now - this.firstDirtyAt >= config.persistMaxWaitMs ? 0 : config.persistDebounceMs;
    this.persistTimer = setTimeout(() => void this.flush(), wait);
  }

  /** Write to Postgres now. Serialized so saves never overlap. */
  flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.firstDirtyAt === null) return this.saving;
    this.firstDirtyAt = null;
    this.saving = this.saving.then(() => saveDocState(this.pageId, this.doc)).catch((e) => console.error("[collab] persist failed", e));
    return this.saving;
  }

  async destroy() {
    await this.flush();
    await this.bus.unsubscribe(this.pageId);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}
