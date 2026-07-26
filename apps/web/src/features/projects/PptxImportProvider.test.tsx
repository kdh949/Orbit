import type { ProjectListItem } from "@orbit/shared/projects";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceProjectCard } from "./WorkspaceProjectCard";
import {
  mergePptxImportProject,
  type PptxImportOperation,
} from "./PptxImportProvider";

const project: ProjectListItem = {
  createdAt: "2026-07-22T00:00:00.000Z",
  createdBy: "user_1",
  generation: null,
  isPinned: false,
  pinnedAt: null,
  projectId: "project_pptx",
  tags: [],
  title: "2026 하반기 제품 전략",
  workspaceId: "workspace_1",
};

const operation: PptxImportOperation = {
  fileName: "2026 하반기 제품 전략.pptx",
  jobId: "job_pptx",
  message: "발표자 노트와 레이아웃을 정리하고 있습니다.",
  progress: 78,
  project,
  stage: "running",
};

describe("PPTX background import presentation", () => {
  it("adds the newly created project before the list request catches up", () => {
    expect(mergePptxImportProject([], operation)).toEqual([
      expect.objectContaining({
        projectId: "project_pptx",
        title: "2026 하반기 제품 전략",
      }),
    ]);
  });

  it("renders the selected temporary thumbnail and real job progress", () => {
    const html = renderToStaticMarkup(
      <WorkspaceProjectCard
        createdAtLabel="방금 업로드"
        deleting={false}
        isPinned={false}
        onDelete={() => undefined}
        onOpen={() => undefined}
        onRehearse={() => undefined}
        onReport={() => undefined}
        onTogglePinned={() => undefined}
        onToggleTag={() => undefined}
        pinning={false}
        pptxImport={operation}
        project={project}
        tagOptions={[]}
      />,
    );

    expect(html).toContain("PPTX 변환 중");
    expect(html).toContain("미리보기 만드는 중");
    expect(html).toContain("value=\"78\"");
    expect(html).toContain("발표자 노트와 레이아웃을 정리하고 있습니다.");
  });
});
