# 10-minute presentation outline (FS-02)

| # | Slide | Time | What to say | Visual |
|---|---|---|---|---|
| 1 | Title | 0:20 | Inkwell: real-time collaborative pages. Name, stack in one line | Two-user screenshot |
| 2 | Problem | 0:50 | Several people editing one doc at once: whose edit wins when two type in the same spot? How do you avoid losing work when someone goes offline, or when you run more than one server? | 3 bullets |
| 3 | CRDTs in one slide | 1:20 | Locking: slow. Last-write-wins: loses data. OT: needs a central server to transform ops. CRDT (Yjs): every character has a unique id and is placed relative to its neighbours, so merges are order-independent and duplicates are harmless. That's what makes multi-server and offline easy | Comparison table |
| 4 | Architecture | 1:00 | Browsers → nginx (round-robin, no sticky sessions) → 2 API instances, each holding live docs in memory → Redis pub/sub between them → Postgres as the truth | `docs/img/architecture.png` |
| 5 | **Live demo** | 3:00 | Script below | App |
| 6 | Challenges | 1:20 | (a) Enforcing permissions per WebSocket frame: why I wrote my own server on y-protocols. (b) Late joiners: an instance opening a page asks peers for unsaved edits. (c) Two instances saving at once: merge-save. (d) A real bug found while testing: socket connected before React attached its listener, so the UI said "Connecting…" while it was live | One card each |
| 7 | Results | 1:00 | 32 tests incl. multi-instance; negative control (tests fail without Redis); 92.8% coverage; p95 49 ms at 25 editors; 4,000 conflicting edits, zero divergence | `docs/performance.md` table |
| 8 | Next steps | 0:40 | Redis Streams, comment anchoring with relative positions, canvas mode | Bullets |
| 9 | Q&A | 0:20 | | |

## Demo script (3:00)

Prep: `docker compose up -d && docker compose run --rm seed`. Open **Chrome** logged in as Alice and **an incognito window** (or another browser) logged in as Bob, side by side, both on "Launch plan".

1. **0:00 Live editing.** Type in Alice's window: it appears in Bob's instantly with Alice's labeled cursor. Both type in the same sentence at once: it merges cleanly. Bob edits the title: the sidebar updates for Alice.
2. **0:45 Presence.** Point at the avatars and the green "Live" indicator. Close Bob's tab: his avatar disappears for Alice.
3. **1:05 Offline.** In a terminal run `docker compose stop api1 api2`. Both windows show "Offline, edits saved locally". Type in both. Run `docker compose start api1 api2`: both reconnect by themselves and both edits merge. (DevTools "Offline" mode doesn't close open WebSockets in Chrome, so stop the servers instead.)
4. **1:35 Comments.** Select text as Bob → Comments → "Quote selected text" → comment. Alice replies and resolves.
5. **2:00 Permissions.** Log in as Carol (view only): the editor is read-only and the pill says "Can view". As Alice, Share → change Carol to "Can edit": Carol can type within seconds, no reload.
6. **2:30 History.** History → open "First draft" → Restore. Bob's window jumps back instantly. Ctrl+Z undoes it.
7. **Optional:** `curl localhost:8081/api/health` a few times shows requests alternating between `api1` and `api2`.

Backup: a screen recording of this exact script, which is also the "working demo" deliverable.
