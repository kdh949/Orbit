import type { AiDeckPreviewResponse } from "@orbit/shared/deck";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, mocked } from "storybook/test";

import { AiDeckGenerationPage } from "./AiDeckGenerationPage";
import {
  requestAiDeckPreview,
  retryAiDeckGeneration,
} from "./ai-deck-preview-api";

const basePreview = {
  completedSlideIds: [],
  deck: null,
  editable: false,
  error: null,
  expectedSlideCountRange: { max: 7, min: 5 },
  jobId: "job_story_ai_deck",
  outline: [
    {
      message: "발표의 문제와 목표를 한 문장으로 정리합니다.",
      order: 1,
      title: "문제 정의",
    },
    {
      message: "사용자 흐름과 핵심 근거를 연결합니다.",
      order: 2,
      title: "핵심 인사이트",
    },
    {
      message: "다음 행동과 기대 효과를 제안합니다.",
      order: 3,
      title: "실행 제안",
    },
  ],
  pendingSlideIds: [],
  progress: 24,
  projectId: "project_story_ai_deck",
  status: "grounding",
  updatedAt: "2026-08-29T06:00:00.000Z",
} satisfies AiDeckPreviewResponse;

const meta = {
  component: AiDeckGenerationPage,
  title: "Screens/AI/Deck Generation",
  parameters: { layout: "fullscreen" },
  args: {
    jobId: basePreview.jobId,
    projectId: basePreview.projectId,
  },
  beforeEach() {
    mocked(requestAiDeckPreview).mockResolvedValue(basePreview);
    mocked(retryAiDeckGeneration).mockResolvedValue(undefined);
  },
} satisfies Meta<typeof AiDeckGenerationPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GroundingSources: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/첨부한 참고자료를 분석하고 있습니다/),
    ).toBeVisible();
    await expect(canvas.getByText("24%")).toBeVisible();
    await expect(canvas.getByText("문제 정의")).toBeInTheDocument();
  },
};

export const RetryableFailure: Story = {
  beforeEach() {
    mocked(requestAiDeckPreview).mockResolvedValue({
      ...basePreview,
      error: {
        code: "AI_PROVIDER_UNAVAILABLE",
        message: "AI 생성 서비스가 잠시 응답하지 않습니다.",
        retryable: true,
      },
      progress: 46,
      status: "failed",
    });
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "AI 생성 서비스가 잠시 응답하지 않습니다.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "다시 시도" }));
    await expect(retryAiDeckGeneration).toHaveBeenCalledWith(
      basePreview.projectId,
      basePreview.jobId,
    );
  },
};
