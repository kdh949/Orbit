import type { ProjectListItem } from "@orbit/shared/projects";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

import { ProjectGalleryCard } from "./ProjectGalleryCard";
import type { PptxImportOperation } from "./PptxImportProvider";
import "./orbit-project-hub.css";
import "./project-gallery-card.stories.css";

const project: ProjectListItem = {
  createdAt: "2026-08-20T09:00:00.000Z",
  createdBy: "user_demo_1",
  generation: null,
  isPinned: false,
  pinnedAt: null,
  projectId: "project_story_1",
  tags: ["전략"],
  title: "분기 전략 리뷰",
  workspaceId: "workspace_demo_1",
};

const meta = {
  component: ProjectGalleryCard,
  decorators: [
    (Story) => (
      <div
        aria-label="프로젝트 목록"
        className="project-card-story-list"
        role="list"
      >
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  title: "Features/Projects/ProjectGalleryCard",
  args: {
    createdAtLabel: "2026. 8. 20.",
    deleting: false,
    isPinned: false,
    onDelete: fn(),
    onOpen: fn(),
    onRehearse: fn(),
    onTogglePinned: fn(),
    pinning: false,
    pptxImport: null,
    project,
  },
} satisfies Meta<typeof ProjectGalleryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "분기 전략 리뷰 편집" }),
    );
    await expect(args.onOpen).toHaveBeenCalledOnce();
  },
};

export const Pinned: Story = { args: { isPinned: true } };

export const Pinning: Story = { args: { pinning: true } };

export const LongTitle: Story = {
  args: {
    project: {
      ...project,
      title:
        "글로벌 파트너와 함께 검토하는 2026년 하반기 제품 전략 및 실행 계획",
    },
  },
};

const pptxImport: PptxImportOperation = {
  fileName: "2026-product-strategy.pptx",
  jobId: "job_story_1",
  message: "발표자 노트와 레이아웃을 정리하고 있습니다.",
  progress: 48,
  project,
  stage: "running",
};

export const PptxProcessing: Story = { args: { pptxImport } };

export const PptxFailed: Story = {
  args: {
    pptxImport: {
      ...pptxImport,
      message: "변환할 수 없는 레이아웃이 포함되어 있습니다.",
      stage: "failed",
    },
  },
};
