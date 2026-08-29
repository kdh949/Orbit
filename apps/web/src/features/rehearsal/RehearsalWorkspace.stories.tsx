import { createDemoDeck } from "@orbit/editor-core/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

import { RehearsalFailureScreen } from "./completion/RehearsalFailureScreen";
import { RehearsalWorkspace } from "./RehearsalWorkspace";

const demoDeck = createDemoDeck();

const meta = {
  component: RehearsalWorkspace,
  parameters: { layout: "fullscreen" },
  title: "Screens/Rehearsal/Workspace",
  args: {
    initialDeck: demoDeck,
    projectId: demoDeck.projectId,
  },
} satisfies Meta<typeof RehearsalWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "리허설을 시작할까요?" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "리허설 시작" }),
    ).toBeDisabled();
  },
};

export const RehearsingWithoutVoice: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "음성 없이 연습하기" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "리허설 마치기" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("group", {
        name: `슬라이드쇼 렌더러: ${demoDeck.slides[0]!.title}`,
      }),
    ).toBeVisible();
  },
};

export const SttError: Story = {
  render: () => (
    <RehearsalFailureScreen
      error="마이크 권한을 확인했지만 음성 인식을 시작하지 못했습니다."
      onPracticeWithoutVoice={fn()}
      onRetry={fn()}
      projectId={demoDeck.projectId}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "리허설을 시작하지 못했습니다.",
    );
  },
};
