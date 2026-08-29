import type { Meta, StoryObj } from "@storybook/react-vite";

import { OrbitCard } from "../ui";
import { WorkspaceContainer } from "./WorkspaceContainer";
import "./workspace-container.stories.css";

const meta = {
  component: WorkspaceContainer,
  parameters: { layout: "fullscreen" },
  title: "Patterns/Layout/WorkspaceContainer",
  argTypes: {
    as: { control: "inline-radio", options: ["div", "main", "section"] },
    width: { control: "inline-radio", options: ["wide", "content"] },
  },
  args: {
    as: "main",
    width: "wide",
  },
  render: (args) => (
    <WorkspaceContainer {...args} className="workspace-container-story">
      <header>
        <p>PROJECTS</p>
        <h1>발표 작업 공간</h1>
      </header>
      <div>
        {Array.from({ length: 3 }, (_, index) => (
          <OrbitCard key={index}>
            <strong>프로젝트 {index + 1}</strong>
            <span>최근 수정된 발표자료</span>
          </OrbitCard>
        ))}
      </div>
    </WorkspaceContainer>
  ),
} satisfies Meta<typeof WorkspaceContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Wide: Story = {};
export const Content: Story = { args: { width: "content" } };
