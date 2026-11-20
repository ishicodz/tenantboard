import type { Role } from "@prisma/client";

/**
 * Role-based permission matrix. Each role inherits nothing implicitly;
 * the matrix is explicit so it can be reviewed (and tested) at a glance.
 */
export const PERMISSIONS = {
  "workspace:read": ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  "workspace:update": ["OWNER", "ADMIN"],
  "workspace:delete": ["OWNER"],
  "member:manage": ["OWNER", "ADMIN"],
  "project:manage": ["OWNER", "ADMIN"],
  "workflow:manage": ["OWNER", "ADMIN"],
  "sprint:manage": ["OWNER", "ADMIN", "MEMBER"],
  "issue:write": ["OWNER", "ADMIN", "MEMBER"],
  "issue:delete": ["OWNER", "ADMIN"],
  "comment:write": ["OWNER", "ADMIN", "MEMBER"],
  "comment:moderate": ["OWNER", "ADMIN"],
  "attachment:write": ["OWNER", "ADMIN", "MEMBER"],
  "audit:read": ["OWNER", "ADMIN"],
  "webhook:manage": ["OWNER", "ADMIN"],
  "report:manage": ["OWNER", "ADMIN", "MEMBER"],
  "billing:manage": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

/** True if `actor` may assign/remove `target` role (admins cannot touch owners). */
export function canManageRole(actor: Role, targetCurrent: Role, targetNew?: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor !== "ADMIN") return false;
  if (targetCurrent === "OWNER") return false;
  if (targetNew && RANK[targetNew] > RANK.ADMIN) return false;
  return true;
}
