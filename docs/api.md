# REST API reference

Base URL: `/api`. JSON in and out. Authenticated routes need `Authorization: Bearer <token>`.

Everything under `/workspaces/:slug/...` is tenant-scoped: the caller must be a member of that workspace, otherwise the response is `404`.

## Errors

```json
{ "error": { "code": "PLAN_LIMIT", "message": "Your FREE plan allows 2 projects. Upgrade to add more.", "details": { "kind": "projects", "limit": 2, "current": 2 } } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST` | Invalid body/query (Zod details included) or business rule violated |
| 401 | `UNAUTHORIZED` | Missing/invalid token |
| 402 | `PLAN_LIMIT` | Plan quota reached |
| 403 | `FORBIDDEN` | Role lacks permission |
| 404 | `NOT_FOUND` | Missing, or belongs to another tenant |
| 409 | `CONFLICT` | Duplicate (email, project key, member) |
| 413 | `FILE_TOO_LARGE` | Attachment over plan limit |
| 503 | `BILLING_DISABLED` | Stripe not configured |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ email, name, password }` (min 8) | → `{ user, token }` |
| POST | `/auth/login` | `{ email, password }` | → `{ user, token }` |
| GET | `/auth/me` | | → `{ user }` |
| GET | `/health` | | DB check, no auth |

## Workspaces & members

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces` | any | Workspaces I belong to, with my role |
| POST | `/workspaces` | any | `{ name, slug? }`. Creator becomes OWNER, default workflow created |
| GET | `/workspaces/:slug` | viewer+ | Workspace, my role, usage, plan limits |
| PATCH | `/workspaces/:slug` | admin+ | `{ name }` |
| DELETE | `/workspaces/:slug` | owner | Cascades everything |
| GET | `/workspaces/:slug/members` | viewer+ | |
| POST | `/workspaces/:slug/members` | admin+ | `{ email, role }`. User must be registered. Plan limit |
| PATCH | `/workspaces/:slug/members/:userId` | admin+ | `{ role }`. Admins can't touch owners; last owner protected |
| DELETE | `/workspaces/:slug/members/:userId` | admin+ or self | Unassigns their issues |

## Projects & boards

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/projects` | viewer+ | With issue counts and boards |
| POST | `/workspaces/:slug/projects` | admin+ | `{ key: "WEB", name, description?, workflowId? }`. Creates a default board. Plan limit |
| GET | `/workspaces/:slug/projects/:id` | viewer+ | Project + workflow (statuses, transitions) + boards |
| PATCH | `/workspaces/:slug/projects/:id` | admin+ | Workflow can only change while the project has no issues |
| DELETE | `/workspaces/:slug/projects/:id` | admin+ | |
| POST | `/workspaces/:slug/projects/:id/boards` | admin+ | `{ name }` |
| GET | `/workspaces/:slug/projects/:id/boards/:boardId` | viewer+ | Kanban: `columns[{ status, issues[] }]` ordered by rank. Query: `sprintId` (`active`, `backlog`, or id), `assigneeId` (`unassigned` or id), `q` |

## Workflows

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/workflows` | viewer+ | |
| POST | `/workspaces/:slug/workflows` | admin+ | `{ name, statuses?: [{name, category}], enforceTransitions? }` |
| PATCH | `/workspaces/:slug/workflows/:id` | admin+ | `{ name?, enforceTransitions? }` |
| POST | `/workspaces/:slug/workflows/:id/statuses` | admin+ | `{ name, category: TODO \| IN_PROGRESS \| DONE }` |
| PATCH | `/workspaces/:slug/workflows/:id/statuses/:statusId` | admin+ | |
| PUT | `/workspaces/:slug/workflows/:id/statuses/order` | admin+ | `{ statusIds: [...] }` (all of them) |
| DELETE | `/workspaces/:slug/workflows/:id/statuses/:statusId?moveIssuesTo=<id>` | admin+ | `moveIssuesTo` required if the status is in use |
| PUT | `/workspaces/:slug/workflows/:id/transitions` | admin+ | `{ transitions: [{ fromStatusId, toStatusId }] }`. Replaces the set |

## Issues

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/issues` | viewer+ | Filters: `projectId, sprintId (or backlog), statusId, assigneeId, type, priority, q, page, limit≤200` |
| POST | `/workspaces/:slug/issues` | member+ | `{ projectId, title, description?, type?, priority?, statusId?, sprintId?, assigneeId?, storyPoints?, dueDate? }`. Plan limit |
| GET | `/workspaces/:slug/issues/:idOrKey` | viewer+ | Accepts id or key (`WEB-12`, case-insensitive) |
| PATCH | `/workspaces/:slug/issues/:idOrKey` | member+ | Partial update. Status changes respect enforced transitions |
| POST | `/workspaces/:slug/issues/:idOrKey/move` | member+ | Drag-and-drop: `{ statusId, beforeId?, afterId? }` (card above / card below) |
| DELETE | `/workspaces/:slug/issues/:idOrKey` | admin+ | |
| GET | `/workspaces/:slug/issues/:idOrKey/activity` | viewer+ | Audit entries for the issue |

Issue shape:

```json
{
  "id": "cm...", "key": "WEB-12", "number": 12, "title": "Fix login", "type": "BUG", "priority": "HIGH",
  "statusId": "cm...", "status": { "id": "cm...", "name": "In Progress", "category": "IN_PROGRESS" },
  "sprintId": null, "assignee": { "id": "...", "name": "...", "email": "..." }, "reporter": { ... },
  "storyPoints": 3, "rank": 2048, "resolvedAt": null, "commentCount": 2, "attachmentCount": 0
}
```

### Comments & attachments

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `.../issues/:id/comments` | viewer+ | |
| POST | `.../issues/:id/comments` | member+ | `{ body }`. Notifies assignee + reporter |
| PATCH | `.../issues/:id/comments/:commentId` | author | |
| DELETE | `.../issues/:id/comments/:commentId` | author or admin+ | |
| GET | `.../issues/:id/attachments` | viewer+ | |
| POST | `.../issues/:id/attachments` | member+ | `multipart/form-data`, field `file`. Size limit per plan |
| GET | `.../issues/:id/attachments/:attId/download` | viewer+ | Streams the file |
| DELETE | `.../issues/:id/attachments/:attId` | uploader or admin+ | |

## Sprints

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/sprints?projectId=&state=` | viewer+ | With issue/done counts and points |
| POST | `/workspaces/:slug/sprints` | member+ | `{ projectId, name, goal?, startDate?, endDate? }` |
| PATCH | `/workspaces/:slug/sprints/:id` | member+ | |
| POST | `/workspaces/:slug/sprints/:id/issues` | member+ | `{ issueIds: [...] }` |
| POST | `/workspaces/:slug/sprints/:id/start` | member+ | One active sprint per project. Defaults to 2 weeks |
| POST | `/workspaces/:slug/sprints/:id/complete` | member+ | `{ moveOpenIssuesTo?: sprintId }`. Unfinished issues go to backlog or the next sprint. Queues a report |
| DELETE | `/workspaces/:slug/sprints/:id` | member+ | Not while active |

## Reports

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/reports?projectId=` | viewer+ | |
| POST | `/workspaces/:slug/reports` | member+ | `{ projectId, sprintId? }` → `202`, generated by the worker |
| GET | `/workspaces/:slug/reports/:id` | viewer+ | `data`: totals, points committed/completed, avg cycle time, last 7 days, by status/assignee/type/priority, issue list |
| GET | `/workspaces/:slug/reports/:id/csv` | viewer+ | CSV export |

## Webhooks (Pro and Business)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/webhooks` | admin+ | Secrets are masked |
| POST | `/workspaces/:slug/webhooks` | admin+ | `{ url, events: ["issue.created", ...] or ["*"] }`. Full secret returned once |
| PATCH | `/workspaces/:slug/webhooks/:id` | admin+ | `{ url?, events?, active? }` |
| DELETE | `/workspaces/:slug/webhooks/:id` | admin+ | |
| POST | `/workspaces/:slug/webhooks/:id/test` | admin+ | Sends `webhook.test` |
| GET | `/workspaces/:slug/webhooks/:id/deliveries` | admin+ | Last 50 with status, attempts, response code |
| POST | `/workspaces/:slug/webhooks/:id/deliveries/:deliveryId/redeliver` | admin+ | |

Events: `issue.created`, `issue.updated`, `issue.moved`, `issue.deleted`, `comment.created`, `sprint.started`, `sprint.completed`, `member.added`.

Delivery body:

```json
{ "id": "<deliveryId>", "event": "issue.moved", "workspaceId": "...", "occurredAt": "2026-11-20T12:00:00Z", "data": { "issue": { ... }, "from": { ... }, "to": { ... } } }
```

Headers: `X-TenantBoard-Event`, `X-TenantBoard-Delivery`, `X-TenantBoard-Signature: t=<unix>,v1=<hmac-sha256-hex of "t.body">`.

## Audit log & notifications

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/audit-logs` | admin+ | Filters: `entityType, entityId, actorId, action` (prefix, e.g. `issue.`), cursor pagination (`cursor`, `limit`) |
| GET | `/workspaces/:slug/notifications?unread=true` | any | My notifications + unread count |
| POST | `/workspaces/:slug/notifications/:id/read` | any | |
| POST | `/workspaces/:slug/notifications/read-all` | any | |

## Billing

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces/:slug/billing` | viewer+ | Plan, status, usage, limits, catalog |
| POST | `/workspaces/:slug/billing/checkout` | owner | `{ plan: PRO \| BUSINESS }` → `{ url }` (Stripe Checkout) |
| POST | `/workspaces/:slug/billing/portal` | owner | → `{ url }` (Stripe Billing Portal) |
| POST | `/workspaces/:slug/billing/dev-set-plan` | owner | Only when `ALLOW_DEV_BILLING=true` |
| POST | `/stripe/webhook` | Stripe | Raw body, `Stripe-Signature` verified. Handles `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`. Idempotent |
