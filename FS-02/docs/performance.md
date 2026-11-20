# Performance

Measured on 20 Nov 2026 with `server/scripts/loadtest.ts`: **two API instances as separate processes**, sharing one Redis and one PostgreSQL 16, on a single cloud VM. Reproduce with:

```bash
cd server
CLIENTS=50 EDITS=40 npm run loadtest      # needs DATABASE_URL and REDIS_URL
```

Each simulated browser is a real `Y.Doc` + the stock `y-websocket` client, alternating between the two instances, so every edit must cross Redis to reach half of the other clients. Each client inserts a paragraph at a **random position** every ~25 ms (jittered), which forces genuine concurrent conflicts.

## Concurrent editors

| Metric | 10 clients | 25 clients | 50 clients | 100 clients |
|---|---|---|---|---|
| Total concurrent edits | 400 | 1000 | 2000 | 4000 |
| All clients connected + synced (ms) | 100.9 | 142.7 | 171 | 264 |
| Propagation latency **p50** (ms) | 1.8 | 10.4 | 73.7 | 304.6 |
| Propagation latency **p95** (ms) | 7.2 | 49 | 148.4 | 574.5 |
| Propagation latency **p99** (ms) | 13.4 | 65.4 | 181.4 | 736.3 |
| Latency samples (edit × receiving client) | 3600 | 24000 | 98000 | 396000 |
| Converged after last edit (ms) | 23 | 84.8 | 249.9 | 739.7 |
| **All replicas byte-identical** | ✅ | ✅ | ✅ | ✅ |

**Propagation latency** = time from one client's edit until each *other* client has applied it (same process clock, so no clock-skew error). It includes the hop through Redis for clients on the other instance.

## Book-sized document

A ~700 KB document (roughly the length of a Project Gutenberg novel; 801 KB as Yjs state):

| Metric | ms (range across runs) |
|---|---|
| New client joins on the other instance (sync via Redis) | 98 – 256.1 |
| Cold load: fresh instance reads it from Postgres and syncs a client | 121.3 – 157.9 |

## Reading these numbers honestly

- **Correctness held at every size:** 400 to 4,000 conflicting edits, every replica identical, no lost edits.
- **Up to 25 editors**, p95 is under 50 ms, which is imperceptible.
- **At 50 and 100**, the bottleneck is the load generator, not the servers. All simulated clients share *one* Node.js thread, and each client has to apply every other client's edits (100 clients × 4,000 edits = 400,000 CRDT applies on one thread). At 100 clients the edit phase stretched to 23 s instead of ~2 s, which shows the client process was saturated. Real browsers each have their own CPU. A fairer high-concurrency test would spread clients over several machines or worker threads (next step).
- A single document with 100 people typing continuously is far beyond typical use (Google Docs caps active editors at 100).

## Multi-browser test

Besides the simulator, the app was driven in real headless Chrome:

- 3 browsers through **nginx round-robin** in Docker Compose; nginx placed 2 on `api1` and 1 on `api2`. All three saw each other's edits and all 3 presence avatars.
- 2 browsers on different instances typing **into the same sentence simultaneously**: identical documents afterwards (ignoring the other user's cursor label).
- Version restore propagated to the other browser instantly and was undoable with Ctrl+Z.
- A view-only user typing in the editor: the editor is read-only, and the server also drops any write frames.
