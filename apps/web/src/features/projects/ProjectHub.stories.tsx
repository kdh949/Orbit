import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, fn } from "storybook/test";

import { withQueryData } from "../../../.storybook/with-query-data";
import { communityStoryCards } from "../community-templates/communityStoryFixtures";
import { OrbitWorkspaceHome } from "./ProjectHub";

const projects = [
  {
    createdAt: "2026-08-20T09:00:00.000Z",
    createdBy: "user_demo_1",
    generation: null,
    isPinned: true,
    pinnedAt: "2026-08-21T09:00:00.000Z",
    projectId: "project_story_1",
    tags: ["전략"],
    title: "분기 전략 리뷰",
    workspaceId: "workspace_demo_1",
  },
  {
    createdAt: "2026-08-18T09:00:00.000Z",
    createdBy: "user_demo_1",
    generation: null,
    isPinned: false,
    pinnedAt: null,
    projectId: "project_story_2",
    tags: ["제품"],
    title: "신제품 발표 초안",
    workspaceId: "workspace_demo_1",
  },
];

const workspaceSuccessHandlers = [
  http.get("/api/v1/workspaces/workspace_demo_1/projects/page", () =>
    HttpResponse.json({
      hasMore: false,
      items: projects,
      limit: 5,
      page: 1,
      total: projects.length,
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
  http.get("/api/v1/projects/:projectId/deck", () =>
    HttpResponse.json({ deck: null }),
  ),
];

const populatedQueryFixtures = [
  [
    [
      "projects",
      "page",
      { filter: "all", query: "", sort: "latest", tags: [] },
    ],
    {
      pageParams: [1],
      pages: [
        {
          hasMore: false,
          items: projects,
          limit: 5,
          page: 1,
          total: projects.length,
        },
      ],
    },
  ],
  [
    ["community", "home", "latest"],
    { hasMore: false, items: communityStoryCards, page: 1 },
  ],
] as const;

const meta = {
  component: OrbitWorkspaceHome,
  title: "Screens/Workspace/Home",
  parameters: {
    layout: "fullscreen",
    msw: workspaceSuccessHandlers,
  },
  args: { onNavigate: fn(), userName: "지윤" },
} satisfies Meta<typeof OrbitWorkspaceHome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  decorators: [withQueryData(populatedQueryFixtures)],
  parameters: { msw: workspaceSuccessHandlers },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "내 프로젝트" }),
    ).toBeVisible();
    await expect(canvas.getByText("분기 전략 리뷰")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: /분기 전략을 한 장으로 설명하는 법/ }),
    ).toBeInTheDocument();
  },
};

export const ListView: Story = {
  decorators: [withQueryData(populatedQueryFixtures)],
  parameters: { msw: workspaceSuccessHandlers },
  play: async ({ canvas, userEvent }) => {
    const listView = canvas.getByRole("button", { name: "리스트 보기" });
    await userEvent.click(listView);
    await expect(listView).toHaveAttribute("aria-pressed", "true");
  },
};

export const Empty: Story = {
  args: { userName: "새 사용자" },
  parameters: {
    msw: [
      http.get("/api/v1/workspaces/workspace_demo_1/projects/page", () =>
        HttpResponse.json({
          hasMore: false,
          items: [],
          limit: 5,
          page: 1,
          total: 0,
        }),
      ),
      http.get("/api/v1/community-templates/discover", () =>
        HttpResponse.json({ hasMore: false, items: [], page: 1 }),
      ),
    ],
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("조건에 맞는 프로젝트가 없습니다."),
    ).toBeVisible();
    await expect(
      canvas.getByText("아직 공개된 발표 프로젝트가 없습니다."),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  args: { userName: "지윤" },
  parameters: {
    msw: [
      http.get(
        "/api/v1/workspaces/workspace_demo_1/projects/page",
        async () => {
          await delay("infinite");
          return HttpResponse.json({});
        },
      ),
      http.get("/api/v1/community-templates/discover", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("프로젝트를 불러오는 중입니다."),
    ).toBeVisible();
    await expect(
      canvas.getByText("최근 공개 자료를 불러오는 중입니다."),
    ).toBeVisible();
  },
};

export const Error: Story = {
  parameters: {
    msw: [
      http.get("/api/v1/workspaces/workspace_demo_1/projects/page", () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    ],
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "프로젝트를 불러오지 못했어요",
    );
  },
};
