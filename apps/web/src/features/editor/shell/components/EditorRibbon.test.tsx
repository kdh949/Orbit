import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorRibbon, resolveEditorRibbonTab } from "./EditorRibbon";

const commonProps = {
  canMutate: true,
  canUseCurrentSlide: true,
  canZoomIn: true,
  canZoomOut: true,
  chartMenuButtonRef: createRef<HTMLButtonElement>(),
  insertTool: "select" as const,
  isChartMenuOpen: false,
  isIconPanelOpen: false,
  isImageUploadPending: false,
  isShapeMenuOpen: false,
  isStageFitToViewport: true,
  onAddText: vi.fn(),
  onFitStageToViewport: vi.fn(),
  onOpenAnimationPanel: vi.fn(),
  onOpenIconLibrary: vi.fn(),
  onOpenImagePicker: vi.fn(),
  onOpenRightPanel: vi.fn(),
  onRedo: vi.fn(),
  onSelectTool: vi.fn(),
  onStartImageCrop: vi.fn(),
  onToggleChartMenu: vi.fn(),
  onToggleShapeMenu: vi.fn(),
  onUndo: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  redoDisabled: false,
  shapeMenuButtonRef: createRef<HTMLButtonElement>(),
  stageScale: 1,
  undoDisabled: false,
};

describe("EditorRibbon", () => {
  it("switches to the contextual image tab on image selection changes", () => {
    expect(
      resolveEditorRibbonTab({
        currentTab: "insert",
        selectedElementType: "image",
        selectionChanged: true,
      }),
    ).toBe("image");
    expect(
      resolveEditorRibbonTab({
        currentTab: "design",
        selectedElementType: "text",
        selectionChanged: true,
      }),
    ).toBe("home");
    expect(
      resolveEditorRibbonTab({
        currentTab: "insert",
        selectedElementType: "image",
        selectionChanged: false,
      }),
    ).toBe("insert");
  });

  it("renders the image tab and crop controls for a selected image", () => {
    const html = renderToStaticMarkup(
      <EditorRibbon
        {...commonProps}
        selectedElementType="image"
        selectionKey="el_image"
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("이미지 자르기");
    expect(html).toContain("이미지 맞춤");
    expect(html).toContain("대체 텍스트");
  });

  it("renders ribbon commands as icon-only controls with accessible names", () => {
    const html = renderToStaticMarkup(<EditorRibbon {...commonProps} />);

    expect(html).toContain('aria-label="실행 취소"');
    expect(html).toContain('title="실행 취소"');
    expect(html).not.toContain("<span>실행 취소</span>");
    expect(html).not.toContain("<span>텍스트</span>");
  });
});
