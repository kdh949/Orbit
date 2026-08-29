import { http, HttpResponse } from "msw";

import { communityStoryCards } from "../src/features/community-templates/communityStoryFixtures";

const projectItems = [
  {
    projectId: "project_story_1",
    workspaceId: "workspace_demo_1",
    title: "분기 전략 리뷰",
    createdBy: "user_demo_1",
    createdAt: "2026-08-20T09:00:00.000Z",
    generation: null,
    isPinned: true,
    pinnedAt: "2026-08-21T09:00:00.000Z",
    tags: ["전략"],
  },
  {
    projectId: "project_story_2",
    workspaceId: "workspace_demo_1",
    title: "신제품 발표 초안",
    createdBy: "user_demo_1",
    createdAt: "2026-08-18T09:00:00.000Z",
    generation: null,
    isPinned: false,
    pinnedAt: null,
    tags: ["제품"],
  },
];

export const mswHandlers = [
  http.get("/api/v1/workspaces/workspace_demo_1/projects", () =>
    HttpResponse.json(projectItems),
  ),
  http.get("/api/v1/workspaces/workspace_demo_1/projects/page", () =>
    HttpResponse.json({
      hasMore: false,
      items: projectItems,
      limit: 5,
      page: 1,
      total: projectItems.length,
    }),
  ),
  http.get("/api/v1/auth/project-tags", () =>
    HttpResponse.json({
      tags: [
        { color: "yellow", name: "전략" },
        { color: "blue", name: "제품" },
      ],
    }),
  ),
  http.get("/api/v1/community-templates/discover", () =>
    HttpResponse.json({ hasMore: false, items: communityStoryCards, page: 1 }),
  ),
  http.get("/api/v1/community-templates/categories", () =>
    HttpResponse.json({
      items: [
        { categoryId: "business", name: "비즈니스" },
        { categoryId: "data-research", name: "데이터·리서치" },
      ],
    }),
  ),
  http.get("/api/v1/community-templates/tags", () =>
    HttpResponse.json({
      items: [
        { name: "전략", tagId: "community_tag_strategy", usageCount: 28 },
        { name: "데이터", tagId: "community_tag_data", usageCount: 19 },
      ],
    }),
  ),
  http.get("/api/v1/projects/:projectId/deck", () =>
    HttpResponse.json({ deck: null }),
  ),
];
