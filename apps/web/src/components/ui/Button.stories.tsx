import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

import { OrbitButton } from "./Button";

const meta = {
  component: OrbitButton,
  title: "Primitives/Actions/Button",
  parameters: {
    layout: "centered",
  },
  argTypes: {
    size: {
      control: "inline-radio",
      options: ["compact", "default", "prominent"],
    },
    variant: {
      control: "inline-radio",
      options: ["primary", "secondary", "quiet", "danger"],
    },
  },
  args: {
    children: "계속하기",
    onClick: fn(),
  },
} satisfies Meta<typeof OrbitButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const CssCheck: Story = {
  args: {
    children: "스타일 확인",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: "스타일 확인" });
    const colorProbe = button.ownerDocument.createElement("span");
    colorProbe.style.background = "var(--redesign-color-primary-emphasis)";
    button.ownerDocument.body.append(colorProbe);
    const expectedBackground = getComputedStyle(colorProbe).backgroundColor;
    colorProbe.remove();

    await expect(getComputedStyle(button).backgroundColor).toBe(
      expectedBackground,
    );
  },
};

export const Secondary: Story = {
  args: {
    variant: "secondary",
  },
};

export const Loading: Story = {
  args: {
    children: "저장 중",
    loading: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const Hover: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("button", { name: "계속하기" }));
  },
};

export const KeyboardFocus: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "계속하기" }),
    ).toHaveFocus();
  },
};

export const Clickable: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "계속하기" });

    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
