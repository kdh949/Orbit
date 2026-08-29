import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { expect } from "storybook/test";

import { previewPracticePlan } from "../mockups/OrbitGapMockups";
import { PracticePlanPage } from "./PracticePlanPage";

const meta = {
  component: PracticePlanPage,
  title: "Screens/Coaching/PracticePlan",
  parameters: { layout: "fullscreen" },
  args: {
    previewCapabilities: {
      challengeQnaEnabled: true,
      focusedPracticeEnabled: true,
    },
    previewPlan: previewPracticePlan,
    projectId: "preview-project",
    sourceFullRunId: "preview-run",
  },
} satisfies Meta<typeof PracticePlanPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", {
        name: "다음 연습은 이 세 가지에 집중하세요.",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("list", { name: "우선 연습 목표" }),
    ).toBeVisible();
  },
};

export const GoalSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    const target = canvas.getByRole("button", {
      name: /ARR 30% 성장 근거를 한 문장으로 연결하기/,
    });
    await userEvent.click(target);
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.getByRole("heading", { name: /ARR 30% 성장 근거/ }),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  args: {
    previewCapabilities: undefined,
    previewPlan: undefined,
    projectId: "loading-project",
  },
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/projects/:projectId/practice-plan", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
      http.get(
        "/api/v1/projects/:projectId/coaching-capabilities",
        async () => {
          await delay("infinite");
          return HttpResponse.json({});
        },
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "연습 계획을 정리하고 있어요",
    );
  },
};

export const Error: Story = {
  args: {
    previewCapabilities: undefined,
    previewPlan: undefined,
    projectId: "error-project",
  },
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/projects/:projectId/practice-plan", () =>
        HttpResponse.json({}, { status: 503 }),
      ),
      http.get("/api/v1/projects/:projectId/coaching-capabilities", () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "계획을 불러오지 못했어요",
    );
  },
};
