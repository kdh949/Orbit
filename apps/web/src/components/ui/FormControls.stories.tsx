import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  OrbitField,
  OrbitInput,
  OrbitSelect,
  OrbitTextarea,
} from "./FormControls";

const meta = {
  component: OrbitField,
  title: "Primitives/Forms/FormControls",
  args: {
    id: "presentation-title",
    label: "발표 제목",
    children: <OrbitInput defaultValue="2026 제품 전략" />,
  },
} satisfies Meta<typeof OrbitField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Input: Story = {};

export const WithHint: Story = {
  args: {
    hint: "청중이 이해하기 쉬운 제목을 입력하세요.",
  },
};

export const WithError: Story = {
  args: {
    children: <OrbitInput defaultValue="" />,
    error: "발표 제목을 입력하세요.",
  },
  play: async ({ canvas }) => {
    const input = canvas.getByLabelText(/^발표 제목/);

    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "발표 제목을 입력하세요.",
    );
  },
};

export const Disabled: Story = {
  args: {
    children: <OrbitInput disabled value="수정할 수 없는 제목" />,
    hint: "권한이 있는 사용자만 수정할 수 있습니다.",
  },
};

export const Select: Story = {
  args: {
    id: "audience",
    label: "주요 청중",
    children: (
      <OrbitSelect defaultValue="team">
        <option value="team">제품 팀</option>
        <option value="executive">경영진</option>
      </OrbitSelect>
    ),
  },
};

export const Textarea: Story = {
  args: {
    id: "presentation-summary",
    label: "발표 요약",
    children: (
      <OrbitTextarea defaultValue="핵심 전략과 실행 계획을 공유합니다." />
    ),
  },
};
