import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

import { LandingPage } from "./LandingPage";

const meta = {
  component: LandingPage,
  title: "Screens/Public/Landing",
  args: {
    onNavigate: fn(),
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /^무료로 시작$/ }),
    );

    await expect(args.onNavigate).toHaveBeenCalledWith("/signup");
  },
};
