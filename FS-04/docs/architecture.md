# Architecture

## System overview

![Architecture](img/architecture.png)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
    B["Browser<br/>React + Vite SPA · dnd-kit Kanban"]
    N["nginx<br/>static files + /api reverse proxy"]
    A["API · Node 22 + Express 5 + TypeScript<br/>JWT auth · RBAC · Zod · tenantDb()"]
    W["Worker · BullMQ<br/>webhooks · notifications · reports · weekly cron"]
    P[("PostgreSQL 16<br/>shared schema + workspaceId")]
    R[("Redis 7<br/>job queue")]
    F[["Upload volume"]]
    S["Stripe (test mode)<br/>Checkout · Billing Portal"]
    H["Customer webhook endpoints"]

    B -->|HTTPS| N --> A
    A -->|Checkout / Portal| S
    S -.->|signed events| A
    A --> F
    A -->|Prisma| P
    A -->|enqueue| R
    R -->|consume| W
    W -->|Prisma| P
    W -->|HMAC-signed POST, retries| H

    classDef app fill:#eef0ff,stroke:#4f46e5,color:#1d2330
    classDef data fill:#e6f6ee,stroke:#0f9d58,color:#1d2330
    classDef ext fill:#fff8e6,stroke:#c77700,color:#1d2330
    class A,W,N app
    class P,R,F data
    class S,H ext
```

</details>

| Component | Responsibility |
|---|---|
| **web** | SPA. Talks only to `/api`. Mirrors the permission matrix for UI affordances; the server is the source of truth. |
| **api** | Stateless REST API. Auth, tenant resolution, RBAC, validation, writes audit entries, enqueues jobs. |
| **worker** | Webhook delivery (HMAC-signed, 6 attempts with exponential backoff), notifications, sprint/project reports, weekly report cron. |
| **PostgreSQL** | Single database, single schema. Every tenant row carries `workspaceId`. |
| **Redis** | BullMQ queue only. No application state, so it can be wiped safely. |

## Tenant isolation

**Choice:** shared database, shared schema, `workspaceId` column on every tenant-owned table.

| Option | Isolation | Ops cost | Why not / why |
|---|---|---|---|
| Database per tenant | Strongest | High: N migrations, N connection pools | Overkill for a Jira-like SaaS with many small tenants |
| Schema per tenant | Strong | Medium: migrations fan out per schema | Prisma support is awkward; connection pool per schema |
| **Shared schema + tenant column** | Enforced in app (+ optional RLS) | Low | Simplest to operate and migrate. Risk is a forgotten `WHERE`, which the design below removes |

### How a forgotten `WHERE workspaceId = ?` is prevented

```mermaid
sequenceDiagram
    participant C as Client
    participant MW as requireAuth + loadWorkspace
    participant R as Route handler
    participant T as tenantDb(workspaceId)
    participant DB as PostgreSQL

    C->>MW: GET /api/workspaces/acme/issues/ck123
    MW->>DB: workspace by slug, membership(user, workspace)
    alt not a member
        MW-->>C: 404 (not 403, so slugs can't be probed)
    end
    MW->>R: req.db = tenantDb(ws.id), req.membership.role
    R->>T: issue.findUnique({ where: { id: "ck123" } })
    T->>DB: ... WHERE id = 'ck123' AND workspaceId = 'ws_acme'
    DB-->>T: null if the row belongs to another tenant
    T-->>R: null
    R-->>C: 404
```

`src/db/tenant.ts` is a Prisma client extension applied to **every operation on every tenant model**:

- **Reads, updates, deletes, counts, aggregates**: `workspaceId` is merged into `where`. This includes unique lookups (`findUnique`, `update`, `delete` by id), so fetching another tenant's row by a guessed id returns `null` / `P2025`.
- **Creates**: `workspaceId` is forced onto the payload and overrides any value a caller passes.
- **Updates**: `workspaceId` is stripped from the payload, so a row can never be moved between tenants.
- **Foreign keys from user input** (`statusId`, `sprintId`, `assigneeId`, `projectId`, `beforeId`/`afterId`) are always re-checked through the scoped client before use.

Route handlers never import the raw client for tenant data. The raw client is used only for global tables (`User`, `Workspace`, `StripeEvent`) and system jobs that first resolve the tenant from a row they own.

Tested in `tests/tenancy.test.ts` (API level and data-layer level) and `tests/unit.test.ts` (`scopeArgs`).

**Next step (defense in depth):** Postgres Row-Level Security with `SET app.workspace_id` per transaction, so even raw SQL is confined.

## Data model

```mermaid
erDiagram
    User ||--o{ Membership : has
    Workspace ||--o{ Membership : has
    Workspace ||--o{ Project : owns
    Workspace ||--o{ Workflow : owns
    Workflow ||--o{ WorkflowStatus : defines
    Workflow ||--o{ WorkflowTransition : allows
    Project }o--|| Workflow : uses
    Project ||--o{ Board : has
    Project ||--o{ Sprint : has
    Project ||--o{ Issue : contains
    WorkflowStatus ||--o{ Issue : "is in"
    Sprint |o--o{ Issue : plans
    Issue ||--o{ Comment : has
    Issue ||--o{ Attachment : has
    Workspace ||--o{ AuditLog : records
    Workspace ||--o{ Webhook : configures
    Webhook ||--o{ WebhookDelivery : logs
    Workspace ||--o{ Notification : sends
    Workspace ||--o{ Report : generates

    Workspace {
        string id PK
        string slug UK
        enum plan "FREE | PRO | BUSINESS"
        string stripeCustomerId UK
        string stripeSubscriptionId UK
    }
    Membership {
        string workspaceId FK
        string userId FK
        enum role "OWNER | ADMIN | MEMBER | VIEWER"
    }
    Issue {
        string workspaceId FK
        string projectId FK
        int number "per-project, e.g. WEB-42"
        string statusId FK
        float rank "fractional ordering"
        datetime resolvedAt "set on DONE"
    }
    WorkflowStatus {
        string name
        enum category "TODO | IN_PROGRESS | DONE"
        int position
    }
```

Full schema: [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).

### Design notes

- **Issue keys** (`WEB-42`): per-project counter `Project.issueSeq`, incremented atomically inside the create transaction. `@@unique([projectId, number])` guarantees no duplicates under concurrency.
- **Board ordering**: fractional `rank` (float). Dropping a card between two others sets `rank = (above + below) / 2`. One row is written per move. When the gap drops below `1e-6`, the column is renumbered (tested with 60 consecutive midpoint inserts).
- **Workflow categories**: custom status names map to one of three categories. Reports, "Done" detection and `resolvedAt` use the category, so teams can rename statuses freely.
- **Audit log**: append-only, written inside the request for every mutation, with field-level `{from, to}` diffs for issue edits.

## Roles and permissions

| Permission | Owner | Admin | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| Read workspace, issues, boards | ✓ | ✓ | ✓ | ✓ |
| Create/edit/move issues, comment, attach | ✓ | ✓ | ✓ | |
| Plan sprints, generate reports | ✓ | ✓ | ✓ | |
| Delete issues, moderate comments | ✓ | ✓ | | |
| Manage members, projects, workflows, webhooks | ✓ | ✓ | | |
| Read audit log | ✓ | ✓ | | |
| Billing, delete workspace | ✓ | | | |

Extra rules: admins cannot change or remove owners or grant `OWNER`; the last owner cannot leave or be demoted; anyone can leave a workspace. Source: `src/lib/permissions.ts`, tested in `tests/rbac.test.ts`.

## Background jobs

```mermaid
flowchart LR
    A[API request] -->|create delivery row| D[(WebhookDelivery<br/>PENDING)]
    A -->|enqueue webhook.deliver| Q[(Redis / BullMQ)]
    Q --> W[Worker]
    W -->|POST + X-TenantBoard-Signature| E[Customer endpoint]
    E -->|2xx| S[SUCCESS]
    E -->|non-2xx / timeout| X{attempt < 6?}
    X -->|yes, backoff 10s·2ⁿ| Q
    X -->|no| F[FAILED<br/>manual redeliver in UI]
```

| Job | Trigger | Retries |
|---|---|---|
| `webhook.deliver` | issue/comment/sprint/member events | 6, exponential from 10 s |
| `notification.send` | assignment, comment, payment failure | 3 |
| `report.generate` | sprint completion, "Generate report" button | 2 |
| `report.weekly` | cron, Mondays 08:00 UTC (`upsertJobScheduler`) | 1 |

`JOBS_MODE=inline` runs the same handlers in-process (used by tests and Redis-less local dev), so business logic is identical in both modes.

**Webhook signature:** `X-TenantBoard-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC_SHA256(secret, "<t>.<raw body>")`. Consumers should reject timestamps older than 5 minutes. A reference verifier is `verifySignature()` in `src/jobs/webhooks.ts`.

## Billing

```mermaid
sequenceDiagram
    participant O as Owner (browser)
    participant A as API
    participant S as Stripe
    O->>A: POST /billing/checkout {plan: PRO}
    A->>S: create customer (once) + checkout session<br/>client_reference_id = workspaceId
    A-->>O: { url }
    O->>S: pays with 4242 4242 4242 4242
    S->>A: checkout.session.completed (signed)
    S->>A: customer.subscription.created/updated (signed)
    A->>A: verify signature on raw body<br/>dedupe by event.id (StripeEvent)<br/>map price id → plan
    A-->>O: plan = PRO, limits raised
```

- Limits live in one table (`src/lib/plans.ts`) and are enforced at creation time (`402 PLAN_LIMIT` with `{kind, limit, current}`).
- Downgrades keep existing data but block new creation above the limit.
- `invoice.payment_failed` notifies owners. `customer.subscription.deleted` drops the workspace to FREE.
- Webhook handling is idempotent: each Stripe `event.id` is stored and processed once.
