import { Redis } from "ioredis";
import { config } from "../config.js";

/**
 * Cross-instance message bus. With REDIS_URL set, every API instance
 * publishes document/awareness updates for a page on `collab:<pageId>` and
 * subscribes to the pages it currently has open. Without Redis it is a no-op
 * and the server works as a single instance.
 */
export type BusMessage =
  | { t: "update"; d: string } // Yjs update (base64)
  | { t: "awareness"; d: string } // awareness update (base64)
  | { t: "sync-request"; sv: string } // "send me what I'm missing" (state vector, base64)
  | { t: "permissions" } // a page's sharing settings changed: re-check open connections
  | { t: "deleted" }; // page deleted: drop everyone

type Envelope = BusMessage & { from: string };
type Handler = (msg: BusMessage) => void;

export class Bus {
  readonly instanceId = crypto.randomUUID();
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private handlers = new Map<string, Handler>();

  constructor(redisUrl = config.redisUrl) {
    if (!redisUrl) return;
    this.pub = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.sub = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.sub.on("message", (channel: string, raw: string) => {
      const handler = this.handlers.get(channel);
      if (!handler) return;
      const msg = JSON.parse(raw) as Envelope;
      if (msg.from === this.instanceId) return;
      handler(msg);
    });
  }

  get enabled() {
    return !!this.pub;
  }

  private channel(pageId: string) {
    return `collab:${pageId}`;
  }

  async subscribe(pageId: string, handler: Handler) {
    this.handlers.set(this.channel(pageId), handler);
    await this.sub?.subscribe(this.channel(pageId));
  }

  async unsubscribe(pageId: string) {
    this.handlers.delete(this.channel(pageId));
    await this.sub?.unsubscribe(this.channel(pageId));
  }

  publish(pageId: string, msg: BusMessage) {
    if (!this.pub) return;
    void this.pub.publish(this.channel(pageId), JSON.stringify({ ...msg, from: this.instanceId }));
  }

  async close() {
    await Promise.all([this.pub?.quit(), this.sub?.quit()]);
  }
}

export const b64 = {
  enc: (u: Uint8Array) => Buffer.from(u).toString("base64"),
  dec: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
};
