/**
 * Demo data: two tenants, several users, projects, sprints, ~90 issues,
 * comments and audit history. Generated with Faker (deterministic seed).
 *
 *   npm run db:seed
 *
 * Login: demo@tenantboard.dev / password123
 */
import { faker } from "@faker-js/faker";
import { PrismaClient, type IssueType, type Priority, type Role } from "@prisma/client";
import { tenantDb } from "../src/db/tenant.js";
import { hashPassword } from "../src/lib/auth.js";
import { createWorkflow } from "../src/services/workflow.js";
import { RANK_STEP } from "../src/lib/rank.js";

faker.seed(42);
const prisma = new PrismaClient();

const TYPES: IssueType[] = ["TASK", "TASK", "STORY", "STORY", "BUG", "EPIC"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "URGENT"];
const TITLES = [
  "Add SSO login with Google",
  "Fix flaky checkout test",
  "Dark mode for settings page",
  "Rate limit public API",
  "Migrate cron jobs to queue",
  "Improve onboarding emails",
  "CSV export for invoices",
  "Search returns stale results",
  "Mobile nav overlaps footer",
  "Audit log retention policy",
];

async function main() {
  if ((await prisma.user.count()) > 0 && !process.argv.includes("--force")) {
    console.log("Database already has data. Re-run with --force to add another demo set.");
    return;
  }

  const password = await hashPassword("password123");
  const demo = await prisma.user.upsert({
    where: { email: "demo@tenantboard.dev" },
    update: {},
    create: { email: "demo@tenantboard.dev", name: "Demo Owner", passwordHash: password },
  });
  const people = [demo];
  for (let i = 0; i < 7; i++) {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    people.push(
      await prisma.user.create({
        data: { email: faker.internet.email({ firstName: first, lastName: last, provider: "example.com" }).toLowerCase(), name: `${first} ${last}`, passwordHash: password },
      }),
    );
  }

  const tenants = [
    { name: "Acme Corp", slug: `acme-${faker.string.alphanumeric(4).toLowerCase()}`, plan: "BUSINESS" as const, projects: [["WEB", "Web App"], ["API", "Public API"], ["OPS", "Platform Ops"]] },
    { name: "Globex", slug: `globex-${faker.string.alphanumeric(4).toLowerCase()}`, plan: "FREE" as const, projects: [["MOB", "Mobile"]] },
  ];

  for (const t of tenants) {
    const ws = await prisma.workspace.create({ data: { name: t.name, slug: t.slug, plan: t.plan } });
    const db = tenantDb(ws.id);
    const roles: Role[] = ["OWNER", "ADMIN", "MEMBER", "MEMBER", "MEMBER", "VIEWER"];
    const members = t.plan === "FREE" ? people.slice(0, 4) : people.slice(0, 6);
    for (const [i, u] of members.entries()) {
      await db.membership.create({ data: { userId: u.id, role: roles[i] } as any });
    }

    const wf = await createWorkflow(db, "Default workflow");
    const statuses = await db.workflowStatus.findMany({ where: { workflowId: wf.id }, orderBy: { position: "asc" } });
    await db.auditLog.create({ data: { actorId: demo.id, action: "workspace.created", entityType: "Workspace", entityId: ws.id } as any });

    for (const [key, name] of t.projects) {
      const project = await db.project.create({ data: { key, name, description: faker.company.catchPhrase(), workflowId: wf.id } as any });
      await db.board.create({ data: { projectId: project.id, name: `${key} board` } as any });

      const past = await db.sprint.create({
        data: { projectId: project.id, name: "Sprint 1", goal: faker.hacker.phrase(), state: "COMPLETED", startDate: faker.date.recent({ days: 30 }), endDate: faker.date.recent({ days: 16 }), completedAt: faker.date.recent({ days: 15 }) } as any,
      });
      const active = await db.sprint.create({
        data: { projectId: project.id, name: "Sprint 2", goal: faker.hacker.phrase(), state: "ACTIVE", startDate: faker.date.recent({ days: 7 }), endDate: faker.date.soon({ days: 7 }) } as any,
      });
      await db.sprint.create({ data: { projectId: project.id, name: "Sprint 3", state: "PLANNED" } as any });

      const count = t.plan === "FREE" ? 20 : 25;
      const ranks = new Map<string, number>();
      for (let n = 1; n <= count; n++) {
        const bucket = faker.number.int({ min: 0, max: 9 });
        const sprintId = bucket < 5 ? active.id : bucket < 7 ? past.id : null;
        const status = sprintId === past.id ? statuses[3] : faker.helpers.arrayElement(statuses);
        const createdAt = faker.date.recent({ days: 35 });
        const rank = (ranks.get(status.id) ?? 0) + RANK_STEP;
        ranks.set(status.id, rank);
        const issue = await db.issue.create({
          data: {
            projectId: project.id,
            number: n,
            title: n <= TITLES.length && key === t.projects[0][0] ? TITLES[n - 1] : faker.hacker.phrase().replace(/\.$/, ""),
            description: faker.lorem.paragraphs({ min: 1, max: 2 }),
            type: faker.helpers.arrayElement(TYPES),
            priority: faker.helpers.arrayElement(PRIORITIES),
            statusId: status.id,
            sprintId,
            assigneeId: faker.helpers.maybe(() => faker.helpers.arrayElement(members).id, { probability: 0.8 }) ?? null,
            reporterId: faker.helpers.arrayElement(members).id,
            storyPoints: faker.helpers.arrayElement([1, 2, 3, 5, 8, null]),
            rank,
            createdAt,
            resolvedAt: status.category === "DONE" ? faker.date.between({ from: createdAt, to: new Date() }) : null,
          } as any,
        });
        await db.auditLog.create({
          data: { actorId: issue.reporterId, action: "issue.created", entityType: "Issue", entityId: issue.id, metadata: { key: `${key}-${n}` }, createdAt } as any,
        });
        for (let c = 0; c < faker.number.int({ min: 0, max: 3 }); c++) {
          await db.comment.create({ data: { issueId: issue.id, authorId: faker.helpers.arrayElement(members).id, body: faker.lorem.sentences({ min: 1, max: 3 }) } as any });
        }
      }
      await db.project.update({ where: { id: project.id }, data: { issueSeq: count } });
    }
    console.log(`Seeded ${t.name} (/${t.slug}) on ${t.plan}`);
  }
  console.log("\nLogin: demo@tenantboard.dev / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
