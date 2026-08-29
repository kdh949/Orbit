import { createActivitySlide } from "@orbit/editor-core";
import { createDemoDeck } from "@orbit/editor-core/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { PresentationWorkspace } from "./PresentationWorkspace";

const demoDeck = createDemoDeck();

const meta = {
  component: PresentationWorkspace,
  parameters: { layout: "fullscreen" },
  title: "Screens/Presentation/Workspace",
  args: {
    initialDeck: demoDeck,
    projectId: demoDeck.projectId,
  },
} satisfies Meta<typeof PresentationWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PresenterView: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("region", { name: "발표 타이머" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "다음 슬라이드" }),
    ).toBeEnabled();
  },
};

export const NextSlideInteraction: Story = {
  play: async ({ canvas, userEvent }) => {
    const nextSlide = demoDeck.slides[1];
    await userEvent.click(
      canvas.getByRole("button", { name: "다음 슬라이드" }),
    );
    if (nextSlide) {
      await expect(canvas.getByText(nextSlide.title)).toBeVisible();
    }
  },
};

export const AudienceActivity: Story = {
  args: {
    initialDeck: {
      ...demoDeck,
      slides: [createActivitySlide(demoDeck, "pre-question")],
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("region", { name: "참여 장표 운영" }),
    ).toBeVisible();
  },
};
