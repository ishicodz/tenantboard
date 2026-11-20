import type { Page, PageRole, WorkspaceRole } from "@prisma/client";
import { prisma } from "../db/client.js";

export const ROLE_RANK: Record<PageRole, number> = { VIEW: 0, COMMENT: 1, EDIT: 2 };

export function atLeast(role: PageRole | null | undefined, min: PageRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface PageAccess {
  page: Page;
  role: PageRole;
  /** Workspace owners and the page creator can share, change defaults and delete. */
  canManage: boolean;
  workspaceRole: WorkspaceRole | null;
}

/**
 * Resolves what a user may do on a page.
 *   1. Workspace owner        -> EDIT (always)
 *   2. Explicit PagePermission -> that role (can raise or lower a member's access, or grant a guest)
 *   3. Workspace member       -> page.memberRole
 *   4. Anyone else            -> no access (null)
 */
export function resolveRole(
  page: Pick<Page, "memberRole" | "createdById">,
  userId: string,
  workspaceRole: WorkspaceRole | null,
  explicit: PageRole | null,
): PageRole | null {
  if (workspaceRole === "OWNER") return "EDIT";
  if (page.createdById === userId && workspaceRole) return "EDIT";
  if (explicit) return explicit;
  if (workspaceRole) return page.memberRole;
  return null;
}

export async function getPageAccess(userId: string, pageId: string): Promise<PageAccess | null> {
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) return null;
  const [membership, perm] = await Promise.all([
    prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: page.workspaceId, userId } } }),
    prisma.pagePermission.findUnique({ where: { pageId_userId: { pageId, userId } } }),
  ]);
  const role = resolveRole(page, userId, membership?.role ?? null, perm?.role ?? null);
  if (!role) return null;
  return {
    page,
    role,
    workspaceRole: membership?.role ?? null,
    canManage: membership?.role === "OWNER" || (page.createdById === userId && !!membership),
  };
}
