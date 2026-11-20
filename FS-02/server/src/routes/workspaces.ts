import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { resolveRole } from "../lib/access.js";
import { param, parse } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { buildDoc, welcomeDoc } from "../lib/welcome.js";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

async function membership(req: Request) {
  const m = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: param(req.params.workspaceId), userId: req.user!.id } },
  });
  if (!m) throw notFound("Workspace");
  return m;
}

workspacesRouter.get("/", async (req, res) => {
  const ms = await prisma.membership.findMany({
    where: { userId: req.user!.id },
    include: { workspace: { include: { _count: { select: { pages: true, members: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({
    workspaces: ms.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
      pageCount: m.workspace._count.pages,
      memberCount: m.workspace._count.members,
    })),
  });
});

workspacesRouter.post("/", async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
  const ws = await prisma.workspace.create({
    data: {
      name: body.name,
      members: { create: { userId: req.user!.id, role: "OWNER" } },
      pages: { create: { title: "Welcome", icon: "👋", createdById: req.user!.id, ydoc: Buffer.from(welcomeDoc()) } },
    },
  });
  res.status(201).json({ workspace: { ...ws, role: "OWNER" } });
});

workspacesRouter.get("/:workspaceId", async (req, res) => {
  const m = await membership(req);
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: m.workspaceId },
    include: { members: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } } },
  });
  res.json({
    workspace: { id: ws.id, name: ws.name },
    role: m.role,
    members: ws.members.map((x) => ({ ...x.user, role: x.role })),
  });
});

workspacesRouter.patch("/:workspaceId", async (req, res) => {
  const m = await membership(req);
  if (m.role !== "OWNER") throw forbidden();
  const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
  res.json({ workspace: await prisma.workspace.update({ where: { id: m.workspaceId }, data: body }) });
});

workspacesRouter.post("/:workspaceId/members", async (req, res) => {
  const m = await membership(req);
  if (m.role !== "OWNER") throw forbidden("Only owners can add members");
  const body = parse(z.object({ email: z.string().email().transform((e) => e.toLowerCase()), role: z.enum(["OWNER", "MEMBER"]).default("MEMBER") }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) throw notFound("User with that email (they need to sign up first)");
  const existing = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: m.workspaceId, userId: user.id } } });
  if (existing) throw conflict("Already a member");
  await prisma.membership.create({ data: { workspaceId: m.workspaceId, userId: user.id, role: body.role } });
  res.status(201).json({ member: { id: user.id, name: user.name, email: user.email, role: body.role } });
});

workspacesRouter.delete("/:workspaceId/members/:userId", async (req, res) => {
  const m = await membership(req);
  const target = param(req.params.userId);
  if (target !== req.user!.id && m.role !== "OWNER") throw forbidden();
  const tm = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: m.workspaceId, userId: target } } });
  if (!tm) throw notFound("Member");
  if (tm.role === "OWNER" && (await prisma.membership.count({ where: { workspaceId: m.workspaceId, role: "OWNER" } })) <= 1) {
    throw badRequest("A workspace needs at least one owner");
  }
  await prisma.membership.delete({ where: { id: tm.id } });
  res.status(204).end();
});

/** Pages in this workspace the caller can see, with their effective role. */
workspacesRouter.get("/:workspaceId/pages", async (req, res) => {
  const m = await membership(req);
  const pages = await prisma.page.findMany({
    where: { workspaceId: m.workspaceId },
    select: { id: true, title: true, icon: true, memberRole: true, createdById: true, updatedAt: true, permissions: { where: { userId: req.user!.id }, select: { role: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({
    pages: pages
      .map(({ permissions, ...p }) => ({ ...p, myRole: resolveRole(p, req.user!.id, m.role, permissions[0]?.role ?? null) }))
      .filter((p) => p.myRole),
  });
});

workspacesRouter.post("/:workspaceId/pages", async (req, res) => {
  const m = await membership(req);
  const body = parse(z.object({ title: z.string().trim().max(200).optional(), icon: z.string().max(8).optional() }), req.body);
  const page = await prisma.page.create({
    data: { workspaceId: m.workspaceId, title: body.title || "Untitled", icon: body.icon, createdById: req.user!.id, ydoc: Buffer.from(buildDoc(body.title ?? "")) },
  });
  res.status(201).json({ page: { ...page, ydoc: undefined, myRole: "EDIT" } });
});
