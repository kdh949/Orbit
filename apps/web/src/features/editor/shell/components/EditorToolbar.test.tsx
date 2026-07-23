import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorToolbar } from "./EditorToolbar";

describe("EditorToolbar", () => {
  it("disables every canvas editing control for a special slide", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar
        canInsertDataElements={false}
        canMutate
        canUseCurrentSlide={false}
        canZoomIn
        canZoomOut
        chartMenuButtonRef={createRef<HTMLButtonElement>()}
        insertTool="select"
        isChartMenuOpen={false}
        isIconPanelOpen={false}
        isImageUploadPending={false}
        isShapeMenuOpen={false}
        isStageFitToViewport
        onAddText={vi.fn()}
        onFitStageToViewport={vi.fn()}
        onOpenIconLibrary={vi.fn()}
        onOpenImagePicker={vi.fn()}
        onOpenActivityQrInsert={vi.fn()}
        onRedo={vi.fn()}
        onSelectTool={vi.fn()}
        onToggleChartMenu={vi.fn()}
        onToggleShapeMenu={vi.fn()}
        onUndo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        redoDisabled
        shapeMenuButtonRef={createRef<HTMLButtonElement>()}
        stageScale={0.8}
        undoDisabled
      />
    );

    for (const label of [
      "선택 도구",
      "텍스트",
      "도형",
      "차트",
      "아이콘",
      "참여 QR 코드",
      "이미지"
    ]) {
      const control = html.match(
        new RegExp(`<(?:button|select)[^>]*aria-label="${label}"[^>]*>`),
      )?.[0];
      expect(control, label).toContain("disabled");
    }

  });

  it("does not render the floating panel shortcut group", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar
        canInsertDataElements
        canMutate
        canUseCurrentSlide
        canZoomIn
        canZoomOut
        chartMenuButtonRef={createRef<HTMLButtonElement>()}
        insertTool="select"
        isChartMenuOpen={false}
        isIconPanelOpen={false}
        isImageUploadPending={false}
        isShapeMenuOpen={false}
        isStageFitToViewport
        onAddText={vi.fn()}
        onFitStageToViewport={vi.fn()}
        onOpenIconLibrary={vi.fn()}
        onOpenImagePicker={vi.fn()}
        onOpenActivityQrInsert={vi.fn()}
        onRedo={vi.fn()}
        onSelectTool={vi.fn()}
        onToggleChartMenu={vi.fn()}
        onToggleShapeMenu={vi.fn()}
        onUndo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        redoDisabled
        shapeMenuButtonRef={createRef<HTMLButtonElement>()}
        stageScale={0.8}
        undoDisabled
      />
    );

    expect(html).not.toContain('aria-label="에디터 패널 도구"');
    expect(html).not.toContain('aria-label="AI 챗봇"');
    expect(html).not.toContain('class="editor-ai-chat-toggle-badge"');
  });

  it("renders the collapsed right panel opener next to zoom controls", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar
        canInsertDataElements
        canMutate
        canUseCurrentSlide
        canZoomIn
        canZoomOut
        chartMenuButtonRef={createRef<HTMLButtonElement>()}
        insertTool="select"
        isChartMenuOpen={false}
        isIconPanelOpen={false}
        isImageUploadPending={false}
        isShapeMenuOpen={false}
        isStageFitToViewport
        onAddText={vi.fn()}
        onFitStageToViewport={vi.fn()}
        onOpenIconLibrary={vi.fn()}
        onOpenImagePicker={vi.fn()}
        onOpenActivityQrInsert={vi.fn()}
        onOpenRightPanel={vi.fn()}
        onRedo={vi.fn()}
        onSelectTool={vi.fn()}
        onToggleChartMenu={vi.fn()}
        onToggleShapeMenu={vi.fn()}
        onUndo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        redoDisabled
        shapeMenuButtonRef={createRef<HTMLButtonElement>()}
        stageScale={0.8}
        undoDisabled
      />
    );

    expect(html).toContain('aria-label="오른쪽 패널 열기"');
    expect(html).toContain('class="open-right-pane-floating-button"');
  });
});
