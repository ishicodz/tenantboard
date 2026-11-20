# Test results

Run on 20 Nov 2026 against real PostgreSQL 16 and Redis 7. Collaboration tests start **two server instances** and connect real `y-websocket` clients, so they exercise the same path a browser does.

```bash
cd server && npm run test:coverage    # needs Postgres + Redis (see README)
cd web && npm test
```

| Suite | Tests | Result |
|---|---|---|
| Collaboration (2 instances + Redis + y-websocket clients) | 10 | ✅ |
| REST API (auth, workspaces, permissions, comments, history) | 11 | ✅ |
| Unit (role resolution, CRDT merge properties, doc helpers) | 9 | ✅ |
| Web (collaborative title diffing) | 2 | ✅ |
| **Total** | **32** | ✅ |

**Server line coverage: 92.8%** (functions 98.6%, branches 83.0%).

Performance and load numbers: [performance.md](performance.md).

## Negative control: do the scaling tests really use Redis?

The collaboration suite was re-run with Redis disabled (`TEST_REDIS_URL=""`). **7 of 10 tests failed**: every cross-instance test (sync, conflicts, presence, revocation, late joiner, delete). Only the single-instance tests passed. So the cross-instance tests genuinely depend on the Redis fan-out and aren't passing by accident.

## What the tests prove

| Requirement | Test |
|---|---|
| Edits sync live | same-instance and **cross-instance** sync (`collab.test.ts`) |
| Never lose changes | concurrent conflicting edits converge; late joiner gets unsaved edits from another instance; full restart keeps content; merge-save; offline edits merge (`unit.test.ts`) |
| Presence | awareness crosses instances and is cleared on disconnect |
| Permissions | server drops writes from viewers; bad token `4401`; no access `4404`; revoking access closes an open socket on another instance `4403`; deleting a page closes sockets; REST role matrix incl. guests and overrides |
| Comments | view can't comment; comment can; threads/replies; resolve; author-only edit; moderation |
| Version history | snapshot captures live state; preview content is the old version; viewers can browse but not save |

## Server test list

```
✓ tests/collab.test.ts > real-time collaboration > syncs edits between two clients on the same instance
 ✓ tests/collab.test.ts > real-time collaboration > syncs edits ACROSS instances through Redis
 ✓ tests/collab.test.ts > real-time collaboration > concurrent conflicting edits converge to the same document (CRDT)
 ✓ tests/collab.test.ts > real-time collaboration > server rejects writes from view-only users, even if they bypass the UI
 ✓ tests/collab.test.ts > real-time collaboration > shares presence (awareness) across instances and clears it on disconnect
 ✓ tests/collab.test.ts > real-time collaboration > rejects bad tokens and users without access
 ✓ tests/collab.test.ts > real-time collaboration > revoking access disconnects an open session immediately (on any instance)
 ✓ tests/collab.test.ts > real-time collaboration > a late joiner on another instance gets edits that are not in Postgres yet
 ✓ tests/collab.test.ts > real-time collaboration > persists to Postgres and survives a full restart
 ✓ tests/collab.test.ts > real-time collaboration > deleting a page disconnects everyone
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > auth > registers, logs in, rejects bad credentials
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > workspaces > creates a workspace with a welcome page and lists only my workspaces
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > workspaces > only owners add members; members can leave; last owner cannot
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > page permissions > members get the page default; explicit shares override it
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > page permissions > non-members have no access unless the page is shared with them (guest)
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > page permissions > only managers (page creator / workspace owner) can share, change defaults or delete
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > page permissions > the page creator can manage their own page
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > comments > COMMENT+ can create threads and replies; VIEW cannot
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > comments > resolve, author-only edit, owner moderation
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > version history > snapshots the live document, previews it, and lists auto + manual versions
 ✓ tests/api.test.ts > REST API: auth, workspaces, pages, permissions, comments, history > version history > viewers can browse history but not create snapshots
 ✓ tests/unit.test.ts > resolveRole > workspace owners always edit
 ✓ tests/unit.test.ts > resolveRole > page creators who are members edit
 ✓ tests/unit.test.ts > resolveRole > explicit share beats the member default (up or down)
 ✓ tests/unit.test.ts > resolveRole > members fall back to the page default
 ✓ tests/unit.test.ts > resolveRole > guests need an explicit share
 ✓ tests/unit.test.ts > resolveRole > orders roles
 ✓ tests/unit.test.ts > CRDT properties the product relies on > merging is order-independent and idempotent
 ✓ tests/unit.test.ts > CRDT properties the product relies on > an offline client's edits merge cleanly when it reconnects
 ✓ tests/unit.test.ts > document helpers > buildDoc produces TipTap-shaped content and docToText reads it back
```

## Coverage

```
-----------------|---------|----------|---------|---------|---------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s   
-----------------|---------|----------|---------|---------|---------------------
All files        |    92.8 |    82.97 |   98.57 |    92.8 |                     
 src             |   95.65 |    22.22 |     100 |   95.65 |                     
  app.ts         |     100 |      100 |     100 |     100 |                     
  config.ts      |   89.47 |        0 |     100 |   89.47 | 24-25               
 src/collab      |    92.2 |     86.4 |     100 |    92.2 |                     
  bus.ts         |     100 |    81.25 |     100 |     100 | 27,32,58            
  persistence.ts |     100 |    83.33 |     100 |     100 | 7,18-19             
  room.ts        |   92.69 |     90.9 |     100 |   92.69 | ...,130-134,167-172 
  server.ts      |   85.57 |    83.33 |     100 |   85.57 | ...6-88,100,120-122 
 src/db          |     100 |        0 |     100 |     100 |                     
  client.ts      |     100 |        0 |     100 |     100 | 9                   
 src/lib         |     100 |     92.3 |      95 |     100 |                     
  access.ts      |     100 |    96.15 |     100 |     100 | 40                  
  auth.ts        |     100 |       80 |     100 |     100 | 10                  
  errors.ts      |     100 |      100 |    87.5 |     100 |                     
  validate.ts    |     100 |       50 |     100 |     100 | 9                   
  welcome.ts     |     100 |      100 |     100 |     100 |                     
 src/middleware  |   68.42 |       80 |     100 |   68.42 |                     
  auth.ts        |     100 |    88.23 |     100 |     100 | 18,32               
  error.ts       |   30.76 |    33.33 |     100 |   30.76 | 11-23,25-29         
 src/routes      |   94.88 |       80 |     100 |   94.88 |                     
  auth.ts        |   94.87 |      100 |     100 |   94.87 | 44-45               
  pages.ts       |     100 |    84.61 |     100 |     100 | ...,113,124,155,171 
  workspaces.ts  |   87.73 |    68.96 |     100 |   87.73 | 29-33,64-68,91-93   
-----------------|---------|----------|---------|---------|---------------------
```
