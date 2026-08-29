import { IconPresentation } from "@tabler/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { OrbitButton } from "./Button";
import { OrbitEmptyState } from "./EmptyState";

const meta = {
  component: OrbitEmptyState,
  title: "Primitives/Feedback/EmptyState",
  args: {
    description: "AI 발표자료 만들기로 첫 프로젝트를 시작하세요.",
    title: "아직 프로젝트가 없습니다.",
  },
} satisfies Meta<typeof OrbitEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = {
  args: {
    icon: <IconPresentation aria-hidden="true" size={24} />,
  },
};

export const WithAction: Story = {
  args: {
    action: <OrbitButton>AI 발표자료 만들기</OrbitButton>,
  },
};
