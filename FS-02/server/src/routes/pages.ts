import { Router, type Request } from "express";
import { z } from "zod";
import * as Y from "yjs";
import { prisma } from "../db/client.js";
import { forbidden, notFound } from "../lib/errors.js";
import { param, parse } from "../lib/validate.js";
import { pageAccess, requireAuth } from "../middleware/auth.js";
import { docToText } from "../collab/persistence.js";
import type { CollabServer } from "../collab/server.js";

const pageRole = z.enum(["VIEW", "COMMENT", "EDIT"]);
const userSel = { select: { id: true, name: true, email: true } } as const;

export function pagesRouter(collab: CollabServer) {
  const r = Router();
  r.use(requireAuth);

  /** Pages shared with me directly where I'm not a workspace member (guest access). */
  r.get("/shared", async (req, res) => {
    const perms = await prisma.pagePermission.findMany({
      where: { userId: req.user!.id, page: { workspace: { members: { none: { userId: req.user!.id } } } } },
      include: { page: { select: { id: true, title: true, icon: true, updatedAt: true, workspace: { select: { name: true } } } } },
    });
    res.json({ pages: perms.map((p) => ({ ...p.page, myRole: p.role })) });
  });

  // ---------- page ----------

  r.get("/:pageId", pageAccess("VIEW"), async (req, res) => {
    const { page, role, canManage } = req.access!;
    const { ydoc: _omit, ...meta } = page;
    res.json({ page: meta, myRole: role, canManage });
  });

  /** Plain-text export of the live document. */
  r.get("/:pageId/text", pageAccess("VIEW"), async (req, res) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, await collab.getDocState(req.access!.page.id));
    res.type("text/plain").send(`${doc.getText("title").toString()}\n\n${docToText(doc)}\n`);
  });

  r.patch("/:pageId", pageAccess("EDIT"), async (req, res) => {
    const body = parse(z.object({ icon: z.string().max(8).nullable().optional(), memberRole: pageRole.optional() }), req.body);
    if (body.memberRole && !req.access!.canManage) throw forbidden("Only the page owner or a workspace owner can change default access");
    const page = await prisma.page.update({ where: { id: req.access!.page.id }, data: body, omit: { ydoc: true } });
    if (body.memberRole) await collab.permissionsChanged(page.id);
    res.json({ page });
  });

  r.delete("/:pageId", pageAccess("EDIT"), async (req, res) => {
    if (!req.access!.canManage) throw forbidden("Only the page owner or a workspace owner can delete it");
    await collab.pageDeleted(req.access!.page.id);
    await prisma.page.delete({ where: { id: req.access!.page.id } });
    res.status(204).end();
  });

  // ---------- permissions ----------

  r.get("/:pageId/permissions", pageAccess("VIEW"), async (req, res) => {
    const { page } = req.access!;
    const [perms, members] = await Promise.all([
      prisma.pagePermission.findMany({ where: { pageId: page.id }, include: { user: userSel } }),
      prisma.membership.findMany({ where: { workspaceId: page.workspaceId }, include: { user: userSel } }),
    ]);
    res.json({
      memberRole: page.memberRole,
      canManage: req.access!.canManage,
      shares: perms.map((p) => ({ ...p.user, role: p.role, isMember: members.some((m) => m.userId === p.userId) })),
      members: members.map((m) => ({ ...m.user, workspaceRole: m.role })),
    });
  });

  r.put("/:pageId/permissions", pageAccess("VIEW"), async (req, res) => {
    if (!req.access!.canManage) throw forbidden("Only the page owner or a workspace owner can share this page");
    const body = parse(z.object({ email: z.string().email().transform((e) => e.toLowerCase()), role: pageRole }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw notFound("User with that email (they need to sign up first)");
    const pageId = req.access!.page.id;
    await prisma.pagePermission.upsert({
      where: { pageId_userId: { pageId, userId: user.id } },
      update: { role: body.role },
      create: { pageId, userId: user.id, role: body.role },
    });
    await collab.permissionsChanged(pageId);
    res.json({ share: { id: user.id, name: user.name, email: user.email, role: body.role } });
  });

  r.delete("/:pageId/permissions/:userId", pageAccess("VIEW"), async (req, res) => {
    if (!req.access!.canManage) throw forbidden();
    await prisma.pagePermission.deleteMany({ where: { pageId: req.access!.page.id, userId: param(req.params.userId) } });
    await collab.permissionsChanged(req.access!.page.id);
    res.status(204).end();
  });

  // ---------- comments ----------

  r.get("/:pageId/comments", pageAccess("VIEW"), async (req, res) => {
    const comments = await prisma.comment.findMany({
      where: { pageId: req.access!.page.id, parentId: null },
      include: { author: userSel, replies: { include: { author: userSel }, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ comments });
  });

  r.post("/:pageId/comments", pageAccess("COMMENT"), async (req, res) => {
    const body = parse(
      z.object({ body: z.string().trim().min(1).max(5000), quote: z.string().max(500).optional(), parentId: z.string().optional() }),
      req.body,
    );
    if (body.parentId) {
      const parent = await prisma.comment.findFirst({ where: { id: body.parentId, pageId: req.access!.page.id, parentId: null } });
      if (!parent) throw notFound("Comment thread");
    }
    const comment = await prisma.comment.create({
      data: { pageId: req.access!.page.id, authorId: req.user!.id, body: body.body, quote: body.quote, parentId: body.parentId },
      include: { author: userSel },
    });
    res.status(201).json({ comment });
  });

  async function loadComment(req: Request) {
    const c = await prisma.comment.findFirst({ where: { id: param(req.params.commentId), pageId: req.access!.page.id } });
    if (!c) throw notFound("Comment");
    return c;
  }

  r.patch("/:pageId/comments/:commentId", pageAccess("COMMENT"), async (req, res) => {
    const body = parse(z.object({ resolved: z.boolean().optional(), body: z.string().trim().min(1).max(5000).optional() }), req.body);
    const c = await loadComment(req);
    if (body.body !== undefined && c.authorId !== req.user!.id) throw forbidden("Only the author can edit a comment");
    res.json({ comment: await prisma.comment.update({ where: { id: c.id }, data: body }) });
  });

  r.delete("/:pageId/comments/:commentId", pageAccess("COMMENT"), async (req, res) => {
    const c = await loadComment(req);
    if (c.authorId !== req.user!.id && !req.access!.canManage) throw forbidden();
    await prisma.comment.delete({ where: { id: c.id } });
    res.status(204).end();
  });

  // ---------- version history ----------

  r.get("/:pageId/snapshots", pageAccess("VIEW"), async (req, res) => {
    const snaps = await prisma.snapshot.findMany({
      where: { pageId: req.access!.page.id },
      select: { id: true, label: true, auto: true, createdAt: true, createdBy: userSel },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ snapshots: snaps });
  });

  r.post("/:pageId/snapshots", pageAccess("EDIT"), async (req, res) => {
    const body = parse(z.object({ label: z.string().trim().min(1).max(100).default("Manual snapshot") }), req.body ?? {});
    const state = await collab.getDocState(req.access!.page.id);
    const snap = await prisma.snapshot.create({
      data: { pageId: req.access!.page.id, label: body.label, state: Buffer.from(state), createdById: req.user!.id },
      select: { id: true, label: true, auto: true, createdAt: true },
    });
    res.status(201).json({ snapshot: snap });
  });

  /**
   * Snapshot content as a base64 Yjs update. The client renders it read-only
   * for preview, and "restore" replays that content into the live doc as a
   * normal edit, so collaborators see it instantly and the restore is itself undoable.
   */
  r.get("/:pageId/snapshots/:snapshotId", pageAccess("VIEW"), async (req, res) => {
    const snap = await prisma.snapshot.findFirst({ where: { id: param(req.params.snapshotId), pageId: req.access!.page.id } });
    if (!snap) throw notFound("Snapshot");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(snap.state));
    res.json({
      snapshot: { id: snap.id, label: snap.label, auto: snap.auto, createdAt: snap.createdAt },
      state: Buffer.from(snap.state).toString("base64"),
      title: doc.getText("title").toString(),
      text: docToText(doc),
    });
  });

  return r;
}

