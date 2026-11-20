import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import * as Y from "yjs";
import { config } from "../config.js";
import { userFromToken } from "../middleware/auth.js";
import { getPageAccess } from "../lib/access.js";
import { Bus } from "./bus.js";
import { Room, type RoleResolver } from "./room.js";
import { loadDocState } from "./persistence.js";

const PATH = /^\/collab\/([A-Za-z0-9_-]+)$/;

/**
 * WebSocket endpoint: ws(s)://host/collab/<pageId>?token=<jwt>
 * Speaks the standard y-websocket protocol, so the browser uses the stock
 * `WebsocketProvider` from y-websocket.
 *
 * Close codes: 4401 bad token, 4404 no such page / no access, 4403 access revoked.
 */
export class CollabServer {
  readonly bus: Bus;
  private wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });
  private rooms = new Map<string, Promise<Room>>();
  private heartbeat: NodeJS.Timeout;

  constructor(redisUrl?: string) {
    this.bus = new Bus(redisUrl);
    // Drop dead connections (laptop lid closed, network gone) so presence stays honest.
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients as Set<WebSocket & { alive?: boolean }>) {
        if (ws.alive === false) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
      }
    }, 30_000);
  }

  private resolveRole: RoleResolver = async (userId, pageId) => (await getPageAccess(userId, pageId))?.role ?? null;

  attach(server: Server) {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = PATH.exec(url.pathname);
      if (!match) return; // not ours; let other handlers (or the default) deal with it
      this.wss.handleUpgrade(req, socket, head, (ws) => void this.onConnection(ws, match[1], url.searchParams.get("token")));
    });
  }

  private async onConnection(ws: WebSocket & { alive?: boolean }, pageId: string, token: string | null) {
    ws.alive = true;
    ws.on("pong", () => (ws.alive = true));
    // Buffer messages that arrive while we authenticate and load the doc.
    const early: Buffer[] = [];
    const buffer = (d: Buffer) => early.push(d);
    ws.on("message", buffer);

    const user = await userFromToken(token);
    if (!user) return ws.close(4401, "Unauthorized");
    const role = await this.resolveRole(user.id, pageId);
    if (!role) return ws.close(4404, "Page not found");
    if (ws.readyState !== ws.OPEN) return;

    const room = await this.getRoom(pageId);
    ws.off("message", buffer);
    room.addConnection(ws, user.id, role);
    for (const d of early) ws.emit("message", d);
  }

  getRoom(pageId: string): Promise<Room> {
    let room = this.rooms.get(pageId);
    if (!room) {
      const r = new Room(pageId, this.bus, this.resolveRole, (empty) => void this.closeRoom(empty));
      room = r.init().then(() => r);
      this.rooms.set(pageId, room);
    }
    return room;
  }

  private async closeRoom(room: Room) {
    // Small grace period: a page refresh reconnects within a second.
    setTimeout(async () => {
      if (room.conns.size > 0 || (await this.rooms.get(room.pageId)) !== room) return;
      this.rooms.delete(room.pageId);
      await room.destroy();
    }, config.roomGraceMs);
  }

  /** Current document state: live in-memory doc if open here, else Postgres. */
  async getDocState(pageId: string): Promise<Uint8Array> {
    const room = this.rooms.get(pageId);
    if (room) {
      const r = await room;
      await r.flush();
      return Y.encodeStateAsUpdate(r.doc);
    }
    return (await loadDocState(pageId)) ?? Y.encodeStateAsUpdate(new Y.Doc());
  }

  /** Tell every instance holding this page to re-check open connections' roles. */
  async permissionsChanged(pageId: string) {
    const room = this.rooms.get(pageId);
    if (room) await (await room).refreshPermissions();
    this.bus.publish(pageId, { t: "permissions" });
  }

  async pageDeleted(pageId: string) {
    const room = this.rooms.get(pageId);
    if (room) (await room).closeAll(4404, "Page deleted");
    this.bus.publish(pageId, { t: "deleted" });
  }

  /** Online users per page (this instance only), for the sidebar badge and metrics. */
  async stats() {
    const out: Record<string, { connections: number; awareness: number }> = {};
    for (const [id, p] of this.rooms) {
      const r = await p;
      out[id] = { connections: r.conns.size, awareness: r.awareness.getStates().size };
    }
    return out;
  }

  async close() {
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.terminate();
    for (const p of this.rooms.values()) await (await p).destroy();
    this.rooms.clear();
    await this.bus.close();
    this.wss.close();
  }
}
