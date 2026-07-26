import type { Project } from "@orbit/shared/projects";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { syncProjectTitleQueryCache } from "../utils/projectTitleCache";

describe("syncProjectTitleQueryCache", () => {
  it("updates the matching home and project list cache entry", () => {
    const queryClient = new QueryClient();
    const projects: Project[] = [
      {
        projectId: "project-a",
        workspaceId: "workspace-a",
        title: "이전 제목",
        createdBy: "user-a",
        createdAt: "2026-07-18T00:00:00.000Z",
      },
      {
        projectId: "project-b",
        workspaceId: "workspace-a",
        title: "다른 프로젝트",
        createdBy: "user-a",
        createdAt: "2026-07-18T00:00:00.000Z",
      },
    ];
    queryClient.setQueryData(["projects"], projects);

    syncProjectTitleQueryCache(queryClient, {
      projectId: "project-a",
      title: "변경된 제목",
    });

    expect(queryClient.getQueryData<Project[]>(["projects"])).toEqual([
      { ...projects[0], title: "변경된 제목" },
      projects[1],
    ]);
  });
});
