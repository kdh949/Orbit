import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { previewQnaView } from "../mockups/OrbitGapMockups";
import { ChallengeQnaPage } from "./ChallengeQnaPage";

const meta = {
  component: ChallengeQnaPage,
  title: "Screens/Coaching/ChallengeQna",
  parameters: { layout: "fullscreen" },
  args: {
    previewView: previewQnaView,
    projectId: "preview-project",
    sourceFullRunId: "preview-run",
  },
} satisfies Meta<typeof ChallengeQnaPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "질문 하나에 집중해 답해 보세요." }),
    ).toBeVisible();
    await expect(canvas.getByText(/신제품 2종을 동시에 출시/)).toBeVisible();
  },
};

export const TextAnswer: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "텍스트" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "답변" }),
      "단계별 출시 기준과 고객 검증 결과로 위험을 통제합니다.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "답변 제출" }));
    await expect(
      canvas.getByRole("heading", { name: "답변 피드백" }),
    ).toBeVisible();
  },
};

export const FullGuide: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "텍스트" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "답변" }),
      "근거를 설명합니다.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "답변 제출" }));
    await userEvent.click(canvas.getByRole("button", { name: "전체 가이드" }));
    await expect(
      canvas.getByRole("dialog", { name: "답변 구조 가이드" }),
    ).toBeVisible();
  },
};
