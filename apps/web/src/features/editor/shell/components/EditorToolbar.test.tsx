import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorToolbar } from "./EditorToolbar";

describe("EditorToolbar", () => {
  it("disables every canvas editing control for a special slide", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar
        canMutate
        canUseCurrentSlide={false}
        canZoomIn
        canZoomOut
        chartMenuButtonRef={createRef<HTMLButtonElement>()}
        insertTool="select"
        isAnimationPanelOpen={false}
        isChartMenuOpen={false}
        isFormatPainterActive={false}
        isIconPanelOpen={false}
        isImageUploadPending={false}
        isShapeMenuOpen={false}
        isStageFitToViewport
        onAddSlide={vi.fn()}
        onAddText={vi.fn()}
        onChangeSelectedFrame={vi.fn()}
        onChangeSelectedProps={vi.fn()}
        onDistributeSelectionX={vi.fn()}
        onDistributeSelectionY={vi.fn()}
        onFitStageToViewport={vi.fn()}
        onGroupSelection={vi.fn()}
        onOpenAnimation={vi.fn()}
        onOpenIconLibrary={vi.fn()}
        onOpenImagePicker={vi.fn()}
        onOpenProperties={vi.fn()}
        onPrint={vi.fn()}
        onRedo={vi.fn()}
        onSelectTool={vi.fn()}
        onToggleChartMenu={vi.fn()}
        onToggleFormatPainter={vi.fn()}
        onToggleShapeMenu={vi.fn()}
        onUndo={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomToActualSize={vi.fn()}
        redoDisabled
        selectedElement={null}
        selectedElementAnimationCount={0}
        selectedElementCount={0}
        shapeMenuButtonRef={createRef<HTMLButtonElement>()}
        stageScale={0.8}
        undoDisabled
      />
    );

    for (const label of [
      "선택 도구",
      "새 슬라이드",
      "텍스트",
      "도형",
      "차트",
      "아이콘",
      "이미지",
      "애니메이션"
    ]) {
      const control = html.match(
        new RegExp(`<(?:button|select)[^>]*aria-label="${label}"[^>]*>`),
      )?.[0];
      expect(control, label).toContain("disabled");
    }

  });
});
