import type { Meta, StoryObj } from "@storybook/react-vite";

import { OrbitButton } from "./Button";
import { OrbitCard } from "./Card";
import "./card.stories.css";

const meta = {
  component: OrbitCard,
  parameters: { layout: "centered" },
  title: "Primitives/Layout/Card",
  args: {
    children: (
      <>
        <h3>분기 전략 리뷰</h3>
        <p>제품 방향과 실행 계획을 정리한 발표자료입니다.</p>
        <OrbitButton size="compact" variant="secondary">
          열기
        </OrbitButton>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="card-story-frame">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrbitCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Interactive: Story = {
  render: (args) => <OrbitCard {...args} data-interactive="true" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("article"));
  },
};

export const Selected: Story = {
  render: (args) => <OrbitCard {...args} data-selected="true" />,
};

export const LongContent: Story = {
  args: {
    children: (
      <>
        <h3>
          글로벌 파트너와 함께 검토하는 2026년 하반기 제품 전략 및 실행 계획
        </h3>
        <p>
          긴 제목과 설명이 들어와도 정보 위계와 버튼 배치가 무너지지 않아야
          합니다.
        </p>
        <OrbitButton size="compact" variant="secondary">
          발표자료 열기
        </OrbitButton>
      </>
    ),
  },
};
