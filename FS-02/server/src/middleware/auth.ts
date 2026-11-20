import type { NextFunction, Request, Response } from "express";
import type { PageRole } from "@prisma/client";
import { prisma } from "../db/client.js";
import { verifyToken } from "../lib/auth.js";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { atLeast, getPageAccess, type PageAccess } from "../lib/access.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string };
      access?: PageAccess;
    }
  }
}

export async function userFromToken(token: string | null | undefined) {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, name: true } });
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) throw unauthorized();
  const user = await userFromToken(token);
  if (!user) throw unauthorized("Invalid or expired token");
  req.user = user;
  next();
}

/** Loads :pageId, resolves the caller's role, and enforces a minimum. No access => 404. */
export function pageAccess(min: PageRole = "VIEW") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const access = await getPageAccess(req.user!.id, String(req.params.pageId));
    if (!access) throw notFound("Page");
    if (!atLeast(access.role, min)) throw forbidden(`This needs ${min.toLowerCase()} access`);
    req.access = access;
    next();
  };
}
