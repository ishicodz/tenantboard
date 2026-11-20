import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api, ws } from "./api";
import type { Member, Project, Sprint, WorkspaceDetail } from "./types";

export function useSlug() {
  return useParams().slug!;
}

export function useWorkspace() {
  const slug = useSlug();
  return useQuery({ queryKey: ["ws", slug], queryFn: () => api.get<WorkspaceDetail>(ws(slug)) });
}

export function useProjects() {
  const slug = useSlug();
  return useQuery({
    queryKey: ["projects", slug],
    queryFn: () => api.get<{ projects: Project[] }>(ws(slug, "/projects")).then((r) => r.projects),
  });
}

export function useMembers() {
  const slug = useSlug();
  return useQuery({
    queryKey: ["members", slug],
    queryFn: () => api.get<{ members: Member[] }>(ws(slug, "/members")).then((r) => r.members),
  });
}

export function useSprints(projectId: string | undefined) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["sprints", slug, projectId],
    enabled: !!projectId,
    queryFn: () => api.get<{ sprints: Sprint[] }>(ws(slug, `/sprints?projectId=${projectId}`)).then((r) => r.sprints),
  });
}
