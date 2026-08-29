import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  previewDeck,
  previewFocusedAttempts,
  previewPracticePlan,
} from "../mockups/OrbitGapMockups";
import { FocusedPracticePage } from "./FocusedPracticePage";

const meta = {
  component: FocusedPracticePage,
  title: "Screens/Coaching/FocusedPractice",
  parameters: { layout: "fullscreen" },
  args: {
    goalId: previewPracticePlan.goals[1].goalId,
    preview: {
      attempts: previewFocusedAttempts,
      deck: previewDeck,
      plan: previewPracticePlan,
    },
    projectId: "preview-project",
    sourceFullRunId: "preview-run",
  },
} satisfies Meta<typeof FocusedPracticePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAttemptHistory: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "한 구간만 짧게 반복하세요." }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("region", { name: "반복 결과" }),
    ).toHaveTextContent("1회 시도");
  },
};

export const FirstAttempt: Story = {
  args: {
    preview: {
      attempts: [],
      deck: previewDeck,
      plan: previewPracticePlan,
    },
  },
  play: async ({ canvas, userEvent }) => {
    const record = canvas.getByRole("button", { name: "녹음 시작" });
    await userEvent.click(record);
    await expect(
      canvas.getByRole("button", { name: "녹음 끝내기" }),
    ).toBeVisible();
  },
};

export const Stabilized: Story = {
  args: {
    preview: {
      attempts: previewFocusedAttempts,
      deck: previewDeck,
      plan: previewPracticePlan,
      stabilized: true,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("연습에서 안정화됨")).toBeVisible();
  },
};
