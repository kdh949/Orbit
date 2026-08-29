import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { OrbitButton } from "./Button";
import { OrbitDialog } from "./Dialog";

const meta = {
  component: OrbitDialog,
  title: "Primitives/Overlay/Dialog",
  args: {
    children: "팀원별 편집 권한을 확인하고 변경할 수 있습니다.",
    description: "프로젝트 접근 권한을 관리합니다.",
    onClose: fn(),
    open: true,
    title: "프로젝트 공유",
  },
} satisfies Meta<typeof OrbitDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(body.getByRole("button", { name: "닫기" }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const WithFooter: Story = {
  args: {
    footer: (
      <>
        <OrbitButton variant="secondary">취소</OrbitButton>
        <OrbitButton>저장</OrbitButton>
      </>
    ),
  },
};

export const ClosingDisabled: Story = {
  args: {
    closeDisabled: true,
    footer: <OrbitButton disabled>저장 중...</OrbitButton>,
  },
};
