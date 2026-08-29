import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { RedesignSystemPage } from "./RedesignSystemPage";

const meta = {
  component: RedesignSystemPage,
  parameters: {
    layout: "fullscreen",
  },
  title: "Foundations/Overview",
} satisfies Meta<typeof RedesignSystemPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Catalog: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { name: "Semantic color" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("heading", { name: "Typography" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("heading", { name: "Spacing" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("heading", { name: "Shape & elevation" }),
    ).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Motion" })).toBeVisible();
  },
};
