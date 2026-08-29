import type { ComponentProps } from "react";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { OrbitTabs } from "./Tabs";

const tabs = [
  { id: "slides", label: "슬라이드" },
  { id: "script", label: "대본" },
] as const;

function InteractiveTabs(props: ComponentProps<typeof OrbitTabs>) {
  const [activeTab, setActiveTab] = useState(props.activeTab);

  return (
    <OrbitTabs {...props} activeTab={activeTab} onChange={setActiveTab}>
      {activeTab === "slides" ? "슬라이드 목록" : "발표자 대본"}
    </OrbitTabs>
  );
}

const meta = {
  component: OrbitTabs,
  title: "Primitives/Navigation/Tabs",
  args: {
    activeTab: "slides",
    ariaLabel: "편집 패널",
    children: "슬라이드 목록",
    onChange: () => undefined,
    tabs,
  },
  render: (args) => <InteractiveTabs {...args} />,
} satisfies Meta<typeof OrbitTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "대본" }));

    await expect(canvas.getByRole("tab", { name: "대본" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent("발표자 대본");
  },
};

export const ScriptSelected: Story = {
  args: {
    activeTab: "script",
  },
};

export const KeyboardNavigation: Story = {
  play: async ({ canvas, userEvent }) => {
    const slidesTab = canvas.getByRole("tab", { name: "슬라이드" });
    slidesTab.focus();
    await userEvent.keyboard("{ArrowRight}");

    await expect(canvas.getByRole("tab", { name: "대본" })).toHaveFocus();
    await expect(canvas.getByRole("tab", { name: "대본" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};
