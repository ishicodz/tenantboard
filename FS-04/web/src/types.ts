export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type Plan = "FREE" | "PRO" | "BUSINESS";
export type StatusCategory = "TODO" | "IN_PROGRESS" | "DONE";
export type IssueType = "TASK" | "BUG" | "STORY" | "EPIC";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  role: Role;
}

export interface Limits {
  projects: number | null;
  members: number | null;
  issues: number | null;
  webhooks: number | null;
  maxAttachmentMb: number;
}

export interface Usage {
  projects: number;
  members: number;
  issues: number;
  webhooks: number;
}

export interface WorkspaceDetail {
  workspace: { id: string; name: string; slug: string; plan: Plan; subscriptionStatus: string | null };
  role: Role;
  usage: Usage;
  limits: Limits;
}

export interface Status {
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
}

export interface Workflow {
  id: string;
  name: string;
  enforceTransitions: boolean;
  statuses: Status[];
  transitions: { id: string; fromStatusId: string; toStatusId: string }[];
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  workflowId: string;
  issueCount?: number;
  boards?: { id: string; name: string }[];
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  state: "PLANNED" | "ACTIVE" | "COMPLETED";
  startDate: string | null;
  endDate: string | null;
  issueCount?: number;
  doneCount?: number;
  points?: number;
}

export interface Issue {
  id: string;
  key: string;
  number: number;
  projectId: string;
  title: string;
  description: string | null;
  type: IssueType;
  priority: Priority;
  statusId: string;
  status: { id: string; name: string; category: StatusCategory };
  sprintId: string | null;
  assigneeId: string | null;
  assignee: User | null;
  reporter: User;
  storyPoints: number | null;
  dueDate: string | null;
  rank: number;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  attachmentCount: number;
}

export interface Member extends User {
  role: Role;
  joinedAt: string;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: User;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
  uploader: { id: string; name: string };
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, any>;
  createdAt: string;
  actor: { id: string; name: string; email?: string } | null;
}
