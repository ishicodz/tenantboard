/**
 * Demo data. Users (password "password123"):
 *   alice@inkwell.dev  workspace owner
 *   bob@inkwell.dev    member
 *   carol@inkwell.dev  member, view-only on "Launch plan"
 *   dave@inkwell.dev   guest (not a member), can comment on "Launch plan"
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth.js";
import { buildDoc, welcomeDoc } from "../src/lib/welcome.js";

const prisma = new PrismaClient();

async function main() {
  if ((await prisma.user.count()) > 0 && !process.argv.includes("--force")) {
    console.log("Database already has data. Re-run with --force to add another demo set.");
    return;
  }
  const passwordHash = await hashPassword("password123");
  const mk = (name: string) =>
    prisma.user.upsert({ where: { email: `${name.toLowerCase()}@inkwell.dev` }, update: {}, create: { email: `${name.toLowerCase()}@inkwell.dev`, name, passwordHash } });
  const [alice, bob, carol, dave] = await Promise.all(["Alice", "Bob", "Carol", "Dave"].map(mk));

  const ws = await prisma.workspace.create({
    data: {
      name: "Acme Product",
      members: { create: [{ userId: alice.id, role: "OWNER" }, { userId: bob.id }, { userId: carol.id }] },
    },
  });

  const page = (title: string, icon: string, ydoc: Uint8Array, extra: object = {}) =>
    prisma.page.create({ data: { workspaceId: ws.id, title, icon, createdById: alice.id, ydoc: Buffer.from(ydoc), ...extra } });

  await page("Welcome", "👋", welcomeDoc());
  const launch = await page(
    "Launch plan",
    "🚀",
    buildDoc("Launch plan", [
      { type: "heading", level: 1, text: "v2 launch: Dec 4" },
      { type: "paragraph", text: "Goal: ship real-time collaboration to every workspace, with no data loss and sub-100ms sync." },
      { type: "heading", level: 2, text: "Milestones" },
      { type: "bullet", items: ["Load test with 50 concurrent editors", "Permission audit (view / comment / edit)", "Docs + changelog", "Announce on the blog"] },
      { type: "heading", level: 2, text: "Risks" },
      { type: "paragraph", text: "Redis outage would split instances. Mitigation: clients reconnect and CRDT merge heals divergence." },
    ]),
  );
  await page(
    "Weekly sync notes",
    "🗓️",
    buildDoc("Weekly sync notes", [
      { type: "heading", level: 2, text: "Agenda" },
      { type: "bullet", items: ["Status round", "Blockers", "Decisions"] },
      { type: "paragraph", text: "Open this page in two windows to see live cursors." },
    ]),
  );

  await prisma.pagePermission.createMany({
    data: [
      { pageId: launch.id, userId: carol.id, role: "VIEW" },
      { pageId: launch.id, userId: dave.id, role: "COMMENT" },
    ],
  });
  const thread = await prisma.comment.create({
    data: { pageId: launch.id, authorId: bob.id, body: "Do we have numbers for the 50-editor test yet?", quote: "Load test with 50 concurrent editors" },
  });
  await prisma.comment.create({ data: { pageId: launch.id, authorId: alice.id, parentId: thread.id, body: "Yes, p95 is in the performance doc." } });
  await prisma.snapshot.create({ data: { pageId: launch.id, label: "First draft", state: launch.ydoc!, createdById: alice.id } });

  console.log("Seeded workspace 'Acme Product'. Log in as alice@inkwell.dev / password123 (also bob, carol, dave).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
