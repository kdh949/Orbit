import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { AiPptMockupPage } from "./AiPptMockupPage";

const meta = {
  component: AiPptMockupPage,
  title: "Screens/AI/Deck Brief",
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AiPptMockupPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyBrief: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("form", { name: "발표 내용 입력" }),
    ).toBeVisible();
    await expect(canvas.getByLabelText("발표 주제")).toHaveValue("");
    await expect(
      canvas.getByRole("button", { name: /다음 단계/ }),
    ).toBeEnabled();
  },
};

export const ValidationError: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /다음 단계/ }));
    await expect(await canvas.findByRole("alert")).toBeVisible();
  },
};

export const PreparedBrief: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByLabelText("발표 주제"),
      "2027년 제품 전략",
    );
    await userEvent.type(
      canvas.getByLabelText("타깃 청중"),
      "제품·개발 리드와 경영진",
    );
    await userEvent.type(
      canvas.getByLabelText("상세 내용 및 컨텍스트"),
      "핵심 고객 문제, 성장 지표, 다음 분기 실행안을 설명합니다.",
    );
    await userEvent.click(canvas.getByRole("button", { name: /자신감 있는/ }));
    await expect(
      canvas.getByRole("button", { name: /자신감 있는/ }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};
