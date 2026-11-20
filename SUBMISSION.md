# Submission checklist (FS-04, due 20 Nov 2026)

| Deliverable | Status | What you still do |
|---|---|---|
| Working demo (deployed or screen-recorded) | App ready | **Record** the 3-minute demo (script in `docs/presentation.md`) or deploy it |
| GitHub repo with clean commits, README, setup | Code + README ready | **Create the repo and commit in milestones** (below) |
| Architecture diagram + data/API docs | ✅ `docs/architecture.md`, `docs/img/*.png`, `docs/api.md` | Nothing |
| Test results + numbers | ✅ `docs/test-results.md` (74 tests, 88.5% coverage) | Paste the CI run link once GitHub Actions passes |
| 10-minute presentation | Outline + demo script in `docs/presentation.md` | **Build the slides** and rehearse |
| Individual reflection (each intern) | Template in `docs/reflection-template.md` | **Each person writes their own** |

## 1. Push to GitHub with milestone commits

```bash
cd tenantboard
git init -b main
git add .gitignore README.md docs/architecture.md server/package*.json server/tsconfig.json server/prisma/schema.prisma server/prisma/migrations server/src/db server/src/config.ts server/.env.example
git commit -m "Data model and shared-schema tenant isolation"

git add server/src/lib server/src/middleware server/src/routes server/src/services server/src/app.ts server/src/server.ts server/src/types.d.ts
git commit -m "REST API with role-based permissions, workflows, comments, attachments, audit log"

git add server/src/jobs server/src/worker.ts
git commit -m "Webhooks, notifications and reports on BullMQ; Stripe billing with plan limits"

git add server/tests server/vitest.config.ts server/prisma/seed.ts
git commit -m "Integration tests against Postgres and Faker seed data"

git add web
git commit -m "React frontend with drag-and-drop Kanban board"

git add docker-compose.yml server/Dockerfile server/.dockerignore .github
git commit -m "Docker images, Compose stack, GitHub Actions CI/CD"

git add docs SUBMISSION.md
git commit -m "Docs: API reference, test results, presentation outline"

gh repo create tenantboard --public --source=. --push   # or create on github.com and git push
```

Then open the **Actions** tab and confirm the pipeline goes green. If a step fails, it's most likely the Docker smoke test; the logs print the API and worker output.

## 2. Demo: pick one

**Screen recording (safest, about 20 minutes):** `docker compose up -d --build && docker compose run --rm seed`, open http://localhost:8080, follow the demo script, record with Loom or OBS. Upload it and put the link at the top of the README.

**Deployed (about 45 minutes):** on Render or Railway create Postgres + Redis, a web service from `server/Dockerfile` (API), a background worker from the same image with command `node dist/worker.js`, and a static site from `web` (set `VITE_API_URL=https://<api-host>/api` at build time and `CORS_ORIGIN`/`APP_URL` on the API). Add the deploy-hook URLs as repo secrets `DEPLOY_HOOK_API`, `DEPLOY_HOOK_WORKER`, `DEPLOY_HOOK_WEB` so the pipeline deploys on push to main. Set a real `JWT_SECRET` and keep `ALLOW_DEV_BILLING` off in production.

## 3. Before you present, be ready to answer

- Why shared schema over schema-per-tenant? What happens if someone writes raw SQL? (Answer: RLS is the next step.)
- How do you stop someone fetching another tenant's issue by guessing its id? (Show `scopeArgs` and the tenancy test.)
- How does drag-and-drop ordering avoid rewriting the whole column?
- What if Stripe sends the same webhook twice? What if your server is down when it sends it?
- What happens to a webhook when the customer's endpoint is down?
- The spec said Django/Celery: why Node/BullMQ?
