import type { Prisma } from "@prisma/client";

export const issueInclude = {
  project: { select: { id: true, key: true } },
  status: { select: { id: true, name: true, category: true } },
  assignee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.IssueInclude;

type IssueWithIncludes = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;

export function serializeIssue(i: IssueWithIncludes) {
  const { _count, ...rest } = i;
  return {
    ...rest,
    key: `${i.project.key}-${i.number}`,
    commentCount: _count.comments,
    attachmentCount: _count.attachments,
  };
}

/** Fields captured in audit diffs and webhook payloads. */
export const ISSUE_AUDIT_FIELDS = [
  "title",
  "description",
  "type",
  "priority",
  "statusId",
  "sprintId",
  "assigneeId",
  "storyPoints",
  "dueDate",
];
