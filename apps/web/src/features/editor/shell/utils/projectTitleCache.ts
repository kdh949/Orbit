import type { Deck } from "@orbit/shared/deck";
import type { Project } from "@orbit/shared/projects";
import type { QueryClient } from "@tanstack/react-query";

export function syncProjectTitleQueryCache(
  queryClient: QueryClient,
  deck: Pick<Deck, "projectId" | "title">,
) {
  queryClient.setQueryData<Project[]>(["projects"], (projects) =>
    projects?.map((project) =>
      project.projectId === deck.projectId
        ? { ...project, title: deck.title }
        : project,
    ),
  );
}
