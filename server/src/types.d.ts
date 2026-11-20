import type { Membership, Workspace } from "@prisma/client";
import type { TenantDb } from "./db/tenant.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string };
      workspace?: Workspace;
      membership?: Membership;
      db?: TenantDb;
    }
  }
}

export {};
