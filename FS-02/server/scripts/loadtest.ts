/**
 * Multi-client load test: N simulated browsers, split across 2 server
 * instances that share Redis + Postgres, all typing into one document at once.
 *
 *   CLIENTS=50 EDITS=40 npm run loadtest
 *
 * Measures edit propagation latency (sender -> every other client), checks
 * every replica converges to the identical document, and times cold-loading a
 * book-sized document. Requires DATABASE_URL and REDIS_URL.
 *
 * The two API instances run as separate OS processes. The simulated clients
 * share this one process, so at high client counts client-side CRDT work
 * (every client applies every edit) is part of the measured latency; real
 * browsers each have their own CPU.
 */
import WebSocket from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { faker } from "@faker-js/faker";
import { spawn, type ChildProcess } from "node:child_process";

const CLIENTS = Number(process.env.CLIENTS ?? 20);
const EDITS = Number(process.env.EDITS ?? 40);
const INTERVAL = Number(process.env.INTERVAL_MS ?? 25);
const BOOK_KB = Number(process.env.BOOK_KB ?? 700); // ~ the size of a Project Gutenberg novel
const redis = process.env.REDIS_URL ?? "redis://localhost:6379";

let nextPort = 4600 + Math.floor(Math.random() * 300);
async function startInstance(name: string): Promise<{ port: number; proc: ChildProcess }> {
  const port = nextPort++;
  const proc = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(port), INSTANCE_NAME: name, REDIS_URL: redis, ROOM_GRACE_MS: "200" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/health`)).ok) return { port, proc };
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${name} did not start`);
}
const stop = (i: { proc: ChildProcess }) => new Promise<void>((r) => { i.proc.once("exit", () => r()); i.proc.kill("SIGTERM"); });

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

async function json(base: string, path: string, body?: object, token?: string) {
  const res = await fetch(`${base}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
}

function client(port: number, pageId: string, token: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${port}/collab`, pageId, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    params: { token },
    disableBc: true,
  });
  const synced = new Promise<void>((r) => provider.once("sync", () => r()));
  return { doc, provider, synced };
}

async function main() {
  const a = await startInstance("api-a");
  const b = await startInstance("api-b");
  const ports = [a.port, b.port];
  const base = `http://localhost:${a.port}`;
  const email = `load.${Date.now()}@example.com`;
  const { token } = await json(base, "/auth/register", { email, name: "Load Tester", password: "password123" });
  const ws = (await json(base, "/workspaces", { name: "Load test" }, token)).workspace;
  const page = (await json(base, `/workspaces/${ws.id}/pages`, { title: "Load" }, token)).page;

  // ---- 1. N concurrent editors ----
  console.log(`Connecting ${CLIENTS} clients across 2 instances...`);
  const t0 = performance.now();
  const clients = Array.from({ length: CLIENTS }, (_, i) => client(ports[i % 2], page.id, token));
  await Promise.all(clients.map((c) => c.synced));
  const connectMs = performance.now() - t0;

  const latencies: number[] = [];
  clients.forEach((c, i) => {
    c.doc.getMap("probe").observe((ev, tr) => {
      if (tr.local) return;
      const now = performance.now();
      for (const k of ev.keysChanged) if (Number(k) !== i) latencies.push(now - (c.doc.getMap("probe").get(k) as number));
    });
  });

  console.log(`Each client makes ${EDITS} edits every ~${INTERVAL}ms...`);
  const editStart = performance.now();
  await Promise.all(
    clients.map(async (c, i) => {
      const frag = c.doc.getXmlFragment("default");
      for (let e = 0; e < EDITS; e++) {
        await new Promise((r) => setTimeout(r, INTERVAL * (0.5 + Math.random())));
        c.doc.transact(() => {
          const p = new Y.XmlElement("paragraph");
          p.insert(0, [new Y.XmlText(`c${i}-e${e} ${faker.lorem.words(3)}`)]);
          frag.insert(Math.floor(Math.random() * (frag.length + 1)), [p]); // random position = real conflicts
          c.doc.getMap("probe").set(String(i), performance.now());
        });
      }
    }),
  );
  const editsDone = performance.now();
  const expected = CLIENTS * EDITS;
  const ref = clients[0].doc;
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("did not converge in 30s")), 30_000);
    const tick = () => {
      const s = ref.getXmlFragment("default").toString();
      const ok = clients.every((c) => c.doc.getXmlFragment("default").length >= expected + 1 && c.doc.getXmlFragment("default").toString() === s);
      if (ok) {
        clearTimeout(deadline);
        resolve();
      } else setTimeout(tick, 10);
    };
    tick();
  });
  const convergeMs = performance.now() - editsDone;
  const totalMs = performance.now() - editStart;
  clients.forEach((c) => c.provider.destroy());

  // ---- 2. Book-sized document ----
  console.log(`Loading a ~${BOOK_KB} KB document...`);
  const book = (await json(base, `/workspaces/${ws.id}/pages`, { title: "Book" }, token)).page;
  const writer = client(a.port, book.id, token);
  await writer.synced;
  const frag = writer.doc.getXmlFragment("default");
  let size = 0;
  writer.doc.transact(() => {
    while (size < BOOK_KB * 1024) {
      const text = faker.lorem.paragraph(6);
      size += text.length;
      const p = new Y.XmlElement("paragraph");
      p.insert(0, [new Y.XmlText(text)]);
      frag.insert(frag.length, [p]);
    }
  });
  const encodedKb = Y.encodeStateAsUpdate(writer.doc).length / 1024;
  // Warm join: a second instance already holds nothing, so it pulls via Redis/Postgres.
  const w0 = performance.now();
  const reader = client(b.port, book.id, token);
  await reader.synced;
  await new Promise<void>((r) => {
    const t = () => (reader.doc.getXmlFragment("default").length === frag.length ? r() : setTimeout(t, 5));
    t();
  });
  const warmJoinMs = performance.now() - w0;
  writer.provider.destroy();
  reader.provider.destroy();
  await new Promise((r) => setTimeout(r, 2000)); // let the debounce flush to Postgres
  await stop(a); // SIGTERM flushes every open document
  await stop(b);

  // Cold load: fresh instance reads the doc from Postgres.
  const c = await startInstance("api-c");
  const c0 = performance.now();
  const cold = client(c.port, book.id, token);
  await cold.synced;
  const coldMs = performance.now() - c0;
  cold.provider.destroy();
  await stop(c);

  const results = {
    clients: CLIENTS,
    editsPerClient: EDITS,
    totalEdits: expected,
    connectAllMs: r1(connectMs),
    editPhaseMs: r1(totalMs),
    editsPerSecond: Math.round(expected / (totalMs / 1000)),
    latencySamples: latencies.length,
    p50: r1(pct(latencies, 50)),
    p95: r1(pct(latencies, 95)),
    p99: r1(pct(latencies, 99)),
    max: r1(latencies.reduce((m, x) => (x > m ? x : m), 0)),
    convergeAfterLastEditMs: r1(convergeMs),
    converged: true,
    bookTextKb: Math.round(size / 1024),
    bookEncodedKb: Math.round(encodedKb),
    bookWarmJoinMs: r1(warmJoinMs),
    bookColdLoadMs: r1(coldMs),
  };
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
