import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { OrbitLoadingState } from "./LoadingState";

const meta = {
  component: OrbitLoadingState,
  parameters: { layout: "centered" },
  title: "Primitives/Feedback/LoadingState",
  args: {
    description: "데이터를 안전하게 불러오는 동안 잠시만 기다려 주세요.",
    title: "프로젝트를 준비하고 있습니다.",
  },
} satisfies Meta<typeof OrbitLoadingState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  },
};

export const LongContent: Story = {
  args: {
    description:
      "발표자료, 발표자 노트, 리허설 기록을 함께 확인하고 있습니다. 네트워크 환경에 따라 조금 더 걸릴 수 있습니다.",
  },
};
