import { IconLogout, IconSettings } from "@tabler/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  DropdownMenu,
  DropdownMenuAccount,
  DropdownMenuItem,
} from "./DropdownMenu";

const meta = {
  component: DropdownMenu,
  title: "Primitives/Overlay/DropdownMenu",
  args: {
    "aria-label": "계정 메뉴",
    children: (
      <>
        <DropdownMenuAccount initial="김" label="김동현" />
        <DropdownMenuItem icon={<IconSettings aria-hidden="true" size={16} />}>
          계정 설정
        </DropdownMenuItem>
        <DropdownMenuItem icon={<IconLogout aria-hidden="true" size={16} />}>
          로그아웃
        </DropdownMenuItem>
      </>
    ),
  },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const White: Story = {};

export const Black: Story = {
  args: {
    variant: "black",
  },
  parameters: {
    backgrounds: { default: "dark" },
  },
};

export const StartAligned: Story = {
  args: {
    align: "start",
  },
};
