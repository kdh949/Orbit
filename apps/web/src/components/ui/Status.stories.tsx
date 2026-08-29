import type { Meta, StoryObj } from "@storybook/react-vite";

import { OrbitStatus } from "./Status";

const meta = {
  component: OrbitStatus,
  title: "Primitives/Feedback/Status",
  args: {
    children: "편집 중",
  },
} satisfies Meta<typeof OrbitStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Primary: Story = { args: { tone: "primary" } };
export const Success: Story = { args: { children: "저장됨", tone: "success" } };
export const Warning: Story = {
  args: { children: "검토 필요", tone: "warning" },
};
export const Danger: Story = {
  args: { children: "연결 끊김", tone: "danger" },
};
