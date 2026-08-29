import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, fn } from "storybook/test";

import { ProjectListPage } from "./ProjectListPage";

const meta = {
  component: ProjectListPage,
  title: "Screens/Projects/ProjectList",
  args: {
    mode: "project",
    onNavigate: fn(),
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ProjectListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectGallery: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("분기 전략 리뷰")).toBeVisible();
    await expect(
      canvas.getByRole("list", { name: "프로젝트 목록" }),
    ).toBeVisible();
  },
};

export const RehearsalTable: Story = {
  args: {
    mode: "rehearsal",
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/workspaces/workspace_demo_1/projects", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "프로젝트를 불러오는 중입니다.",
    );
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/workspaces/workspace_demo_1/projects", () =>
        HttpResponse.json([]),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("아직 프로젝트가 없습니다."),
    ).toBeVisible();
  },
};

export const Error: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/workspaces/workspace_demo_1/projects", () =>
        HttpResponse.text("프로젝트 목록을 불러오지 못했습니다.", {
          status: 503,
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "프로젝트를 불러오지 못했습니다.",
    );
  },
};

export const SearchEmpty: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "프로젝트 검색" }),
      "없는 프로젝트",
    );
    await expect(
      await canvas.findByText("검색 결과가 없습니다."),
    ).toBeVisible();
  },
};
