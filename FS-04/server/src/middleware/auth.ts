import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/client.js";
import { tenantDb } from "../db/tenant.js";
import { verifyToken } from "../lib/auth.js";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { can, type Permission } from "../lib/permissions.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized("Invalid or expired token");
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw unauthorized("User no longer exists");
  req.user = user;
  next();
}

/**
 * Resolves `:slug` to a workspace, verifies the caller is a member, and
 * attaches a tenant-scoped db client to the request. Non-members get 404
 * (not 403) so workspace slugs cannot be enumerated.
 */
export async function loadWorkspace(req: Request, _res: Response, next: NextFunction) {
  const slug = String(req.params.slug ?? "");
  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) throw notFound("Workspace");
  const membership = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: req.user!.id } },
  });
  if (!membership) throw notFound("Workspace");
  req.workspace = workspace;
  req.membership = membership;
  req.db = tenantDb(workspace.id);
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.membership || !can(req.membership.role, permission)) throw forbidden();
    next();
  };
}
