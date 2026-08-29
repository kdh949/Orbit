import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

import { OrbitButton } from "./Button";
import { OrbitFailureState } from "./FailureState";

const meta = {
  component: OrbitFailureState,
  title: "Primitives/Feedback/FailureState",
  args: {
    description: "프로젝트 목록을 가져오는 중 연결 문제가 발생했습니다.",
    onRetry: fn(),
    recommendedAction: "인터넷 연결을 확인한 뒤 목록을 다시 불러오세요.",
    title: "프로젝트를 불러오지 못했습니다.",
  },
} satisfies Meta<typeof OrbitFailureState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Retry: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "다시 시도" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const CustomActions: Story = {
  args: {
    retryLabel: "목록 다시 불러오기",
    secondaryAction: <OrbitButton variant="quiet">홈으로 이동</OrbitButton>,
  },
};
