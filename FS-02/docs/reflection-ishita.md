
## How this project was built
This reflection covers what I owned in that loop and what I now understand about real-time systems.

## What I owned

- **Scope and acceptance criteria.** The brief's seven milestones (CRDTs, auth/pages, a TipTap editor on Yjs, WebSocket sync, presence, comments/history/permissions, Redis scaling plus multi-browser testing) became checks that each needed proof, not just code.
- **Evidence-based verification.** 30 server tests start two real server instances with Redis and connect the same client library a browser uses. A **negative control** mattered most to me: with Redis turned off, 7 of the 10 collaboration tests fail, which proves the scaling tests really exercise Redis rather than passing by accident.
- **Real-browser testing.** Two and three headless browsers editing at once, including through nginx load-balancing in Docker; simultaneous typing in one sentence; editing while both servers were down; restore propagating to another user.
- **Delivery.** Repository structure for both projects, commits, CI, documentation, and a side-by-side two-browser demo video.

## A decision I can defend

**Writing the sync server on `y-protocols` instead of using the reference y-websocket server.** The reference server checks access once, when a socket connects. Permissions here have to be enforced on every write: a view-only user who edits the page in DevTools, or crafts WebSocket frames, must still be unable to change the document. The custom server lets anyone read (sync step 1) but applies writes (step 2 and updates) only for editors. Owning the server also made it possible to fan out over Redis, to have an instance that opens a page ask its peers for edits that haven't reached Postgres yet, and to re-check open sockets the moment sharing changes. It stays wire-compatible, so the browser uses the stock `WebsocketProvider` unchanged.

## The hardest problems (both found by testing, not by reading code)

1. **A UI race condition.** On a warm server the socket connected in about 15 ms, before React attached its "status" listener, so the page said "Connecting…" while sync was working fine. The fix was to read the provider's current state on mount instead of only waiting for the next event.
2. **Transient errors treated as "no access".** While the servers were restarting, a background refresh of the page's details failed, and the page replaced the editor with "you don't have access". The fix was to keep the last good data and only show no-access for a real 403/404.
3. **Load-test honesty.** At 50 to 100 simulated editors, latency was dominated by the single test process (every client applies every edit on one thread), not by the servers. I moved the servers into separate processes and documented the caveat instead of publishing a flattering number.

## What I learned

- *Why CRDTs merge without a central authority: items are placed relative to their neighbours by id, not by index, so merges are commutative and idempotent. That's also why two servers can merge-save instead of overwriting each other.*
- *Real-time bugs show up in timing and failure modes (connect races, restarts, offline). Unit tests alone wouldn't have caught either UI bug; driving real browsers did.*
- *Negative controls: showing a test fails when the thing it tests is removed.*

## What I'd do differently or next

- Redis Streams instead of pub/sub, so a Redis blip can't drop messages between instances (today CRDT sync heals it on reconnect).
- Anchor comments with Yjs relative positions so they move with the text; store snapshots as diffs; put the title in the editor's undo history.
- A fairer high-concurrency load test spread across worker threads or machines.
