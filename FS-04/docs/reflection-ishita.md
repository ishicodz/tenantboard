
## How this project was built
I set the requirements, made or approved the key calls, and checked every claim against running software before accepting it. Saying that up front matters to me. The useful questions for this reflection are what I owned in that loop and what I now understand that I didn't before.

## What I owned

- **Turning the brief into a buildable spec.** The brief contradicted itself: the tool list said Node/Express/Prisma/Vitest, but milestones 2 and 5 said Django REST Framework and Celery. I went with the listed stack and mapped Celery to BullMQ on Redis, and the README records that choice so a reviewer sees it was deliberate.
- **Acceptance and verification.** I didn't treat "the code compiles" as done. The work was accepted on evidence: 74 tests against a real PostgreSQL database (88.5% coverage), the full Docker stack booting with migrations and seed, a real drag-and-drop in a headless browser, and a webhook endpoint returning 503 that got retried and then succeeded.
- **Delivery.** Repository layout for a two-project submission (`FS-04/`, `FS-02/`), milestone-based commit history, CI pipelines, documentation and the demo recording.

## A decision I can defend

**Shared database, shared schema, with a `workspaceId` column, enforced by the data layer rather than by developer discipline.** Database-per-tenant isolates best but multiplies migrations and connection pools; schema-per-tenant is awkward with Prisma. A shared schema is the simplest to run, and its real risk is one forgotten `WHERE workspaceId = ?`. The `tenantDb()` Prisma extension removes that risk: it injects the tenant filter into every query, including lookups by id, forces the tenant onto every insert (overwriting a spoofed one), and strips it from updates so a row can never move between tenants. Non-members get 404 instead of 403, so workspace slugs can't be probed. Next step: Postgres row-level security as a second layer, so even raw SQL is confined.

## The hardest problem

- *Kanban ordering: fractional ranks mean a drag writes one row, but repeated drops between the same two cards eventually exhaust float precision. The column then has to be renumbered, and there's a test that forces this with 60 consecutive drops.*
- *A demo-script bug: my first recording claimed a Free-plan limit was hit when it wasn't, because Globex only had one project. Reviewing the frames caught it, and I fixed it before shipping.*

## What I learned

- *How a Prisma client extension can enforce tenant isolation for every query in one place.*
- *Why Stripe webhook handling needs the raw body and idempotency keys.*
- *How to direct and verify an AI agent on a production-shaped build: spec first, evidence over assertions, and rejecting work that only "looks done".*

## What I'd do differently or next

- Row-level security in Postgres as defense in depth for tenant isolation.
- Email invitations for people without accounts, real-time board updates (SSE/WebSockets), S3 storage for attachments.
