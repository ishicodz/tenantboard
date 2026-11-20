export type PageRole = "VIEW" | "COMMENT" | "EDIT";
export type WorkspaceRole = "OWNER" | "MEMBER";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  pageCount: number;
  memberCount: number;
}

export interface PageSummary {
  id: string;
  title: string;
  icon: string | null;
  memberRole: PageRole;
  myRole: PageRole;
  updatedAt: string;
  workspace?: { name: string };
}

export interface PageMeta {
  id: string;
  workspaceId: string;
  title: string;
  icon: string | null;
  memberRole: PageRole;
  createdById: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  body: string;
  quote: string | null;
  resolved: boolean;
  createdAt: string;
  author: User;
  replies?: Comment[];
}

export interface SnapshotSummary {
  id: string;
  label: string;
  auto: boolean;
  createdAt: string;
  createdBy: User | null;
}

export interface Presence {
  clientId: number;
  name: string;
  color: string;
  userId: string;
}
