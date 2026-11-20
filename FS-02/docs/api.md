# API reference

Base URL `/api`. JSON. Authenticated routes need `Authorization: Bearer <token>`. Errors look like `{ "error": { "code", "message", "details?" } }` with 400 (validation), 401, 403 (role too low), 404 (missing or no access) and 409 (duplicate).

## WebSocket: `/collab/:pageId?token=<jwt>`

Standard [y-websocket](https://github.com/yjs/y-websocket) protocol, so connect with `new WebsocketProvider(url + "/collab", pageId, ydoc, { params: { token } })`.

| Message | Direction | Notes |
|---|---|---|
| `0` sync step 1 | both | Read. Allowed for every role |
| `0` sync step 2 / update | both | Write. **Dropped by the server unless the socket's role is EDIT** |
| `1` awareness | both | Presence: `{ user: { name, color, userId }, cursor }`. Allowed for every role |
| `3` query awareness | client → server | Server replies with all presence states |

Document shape (what TipTap expects): `ydoc.getXmlFragment("default")` holds the ProseMirror content; `ydoc.getText("title")` holds the page title.

| Close code | Meaning |
|---|---|
| `4401` | Missing/invalid token |
| `4404` | Page doesn't exist, you have no access, or it was deleted while open |
| `4403` | Your access was revoked while connected |

## Auth

| Method | Path | Body |
|---|---|---|
| POST | `/auth/register` | `{ email, name, password }` (min 8) → `{ user, token }` |
| POST | `/auth/login` | `{ email, password }` → `{ user, token }` |
| GET | `/auth/me` | → `{ user }` |
| GET | `/health` | → `{ ok, instance, redis, rooms }` (which instance answered + its open rooms) |

## Workspaces

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/workspaces` | any | Mine, with role and counts |
| POST | `/workspaces` | any | `{ name }`. I become owner; a Welcome page is created |
| GET | `/workspaces/:id` | member | Workspace, my role, members |
| PATCH | `/workspaces/:id` | owner | `{ name }` |
| POST | `/workspaces/:id/members` | owner | `{ email, role? }`. User must be registered |
| DELETE | `/workspaces/:id/members/:userId` | owner, or self | Last owner can't leave |
| GET | `/workspaces/:id/pages` | member | Pages with my effective role (`myRole`) |
| POST | `/workspaces/:id/pages` | member | `{ title?, icon? }` |

## Pages

| Method | Path | Min role | Notes |
|---|---|---|---|
| GET | `/pages/shared` | — | Pages shared with me as a guest |
| GET | `/pages/:id` | VIEW | `{ page, myRole, canManage }` |
| GET | `/pages/:id/text` | VIEW | Plain-text export of the live document |
| PATCH | `/pages/:id` | EDIT | `{ icon?, memberRole? }`. `memberRole` needs manage rights |
| DELETE | `/pages/:id` | manage | Disconnects everyone on the page (`4404`) |

## Sharing

| Method | Path | Min role | Notes |
|---|---|---|---|
| GET | `/pages/:id/permissions` | VIEW | `{ memberRole, canManage, shares[], members[] }` |
| PUT | `/pages/:id/permissions` | manage | `{ email, role }`. Upsert; works for guests. Open sockets are re-checked instantly |
| DELETE | `/pages/:id/permissions/:userId` | manage | Open sockets are downgraded or closed (`4403`) instantly, on every instance |

"Manage" means workspace owner, or the page's creator if still a member.

## Comments

| Method | Path | Min role | Notes |
|---|---|---|---|
| GET | `/pages/:id/comments` | VIEW | Top-level threads with `replies[]` |
| POST | `/pages/:id/comments` | COMMENT | `{ body, quote?, parentId? }` |
| PATCH | `/pages/:id/comments/:cid` | COMMENT | `{ resolved? }` anyone; `{ body? }` author only |
| DELETE | `/pages/:id/comments/:cid` | COMMENT | Author or manager |

## Version history

| Method | Path | Min role | Notes |
|---|---|---|---|
| GET | `/pages/:id/snapshots` | VIEW | Newest first, auto and manual |
| POST | `/pages/:id/snapshots` | EDIT | `{ label? }`. Captures the *live* doc (flushes first) |
| GET | `/pages/:id/snapshots/:sid` | VIEW | `{ snapshot, state (base64 Yjs update), title, text }` |

Restore is done client-side: decode `state`, convert with `yDocToProsemirrorJSON`, and `editor.commands.setContent(...)`, so it flows through the CRDT like any edit.
