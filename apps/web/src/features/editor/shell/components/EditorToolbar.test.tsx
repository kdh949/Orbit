import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorToolbar } from "./EditorToolbar";

type ToolbarProps = Parameters<typeof EditorToolbar>[0];

function createToolbarProps(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    canMutate: true,
    canUseCurrentSlide: true,
    canZoomIn: true,
    canZoomOut: true,
    chartMenuButtonRef: createRef<HTMLButtonElement>(),
    insertTool: "select",
    isAnimationPanelOpen: false,
    isChartMenuOpen: false,
    isFormatPainterActive: false,
    isIconPanelOpen: false,
    isImageUploadPending: false,
    isShapeMenuOpen: false,
    isPrintPreparing: false,
    isStageFitToViewport: true,
    onAddSlide: vi.fn(),
    onAddText: vi.fn(),
    onChangeSelectedFrame: vi.fn(),
    onChangeSelectedProps: vi.fn(),
    onDistributeSelectionX: vi.fn(),
    onDistributeSelectionY: vi.fn(),
    onFitStageToViewport: vi.fn(),
    onGroupSelection: vi.fn(),
    onOpenAnimation: vi.fn(),
    onOpenIconLibrary: vi.fn(),
    onOpenImagePicker: vi.fn(),
    onOpenProperties: vi.fn(),
    onPrint: vi.fn(),
    onRedo: vi.fn(),
    onSelectTool: vi.fn(),
    onToggleChartMenu: vi.fn(),
    onToggleFormatPainter: vi.fn(),
    onToggleShapeMenu: vi.fn(),
    onUndo: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    redoDisabled: true,
    selectedElement: null,
    selectedElementAnimationCount: 0,
    selectedElementCount: 0,
    shapeMenuButtonRef: createRef<HTMLButtonElement>(),
    stageScale: 0.8,
    undoDisabled: true,
    ...overrides,
  };
}

describe("EditorToolbar", () => {
  it("disables every canvas editing control for a special slide", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar {...createToolbarProps({ canUseCurrentSlide: false })} />,
    );

    for (const label of [
      "선택 도구",
      "새 슬라이드",
      "텍스트",
      "도형",
      "차트",
      "아이콘",
      "이미지",
      "애니메이션",
    ]) {
      const control = html.match(
        new RegExp(`<(?:button|select)[^>]*aria-label="${label}"[^>]*>`),
      )?.[0];
      expect(control, label).toContain("disabled");
    }
  });

  it("keeps command tools without the legacy floating shortcut group", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar {...createToolbarProps()} />,
    );

    expect(html).toContain('aria-label="명령 검색"');
    expect(html).toContain('aria-label="서식 복사"');
    expect(html).toContain('aria-label="인쇄"');
    expect(html).not.toContain('aria-label="에디터 패널 도구"');
    expect(html).not.toContain('aria-label="AI 챗봇"');
    expect(html).not.toContain('aria-label="100%로 보기"');
  });

  it("renders the collapsed right panel opener next to zoom controls", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar
        {...createToolbarProps({ onOpenRightPanel: vi.fn() })}
      />,
    );

    expect(html).toContain('aria-label="오른쪽 패널 열기"');
    expect(html).toContain('class="open-right-pane-floating-button"');
  });

  it("disables duplicate print requests while the deck is preparing", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar {...createToolbarProps({ isPrintPreparing: true })} />,
    );

    const printButton = html.match(
      /<button[^>]*aria-label="인쇄 준비 중"[^>]*>/,
    )?.[0];
    expect(printButton).toContain("disabled");
  });
});
