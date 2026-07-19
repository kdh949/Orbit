import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SelectionInspectorModel } from "../selectionInspectorModel";
import {
  SelectionInspector,
  type SelectionInspectorProps,
} from "./SelectionInspector";

const slideModel: SelectionInspectorModel = {
  mode: "slide",
  selectedCount: 0,
  selectedElementIds: [],
  shouldAutoOpenDesignInspector: false,
};
const elementModel: SelectionInspectorModel = {
  mode: "element",
  selectedCount: 1,
  selectedElementId: "el_1",
  selectedElementIds: ["el_1"],
  shouldAutoOpenDesignInspector: true,
};
const multiModel: SelectionInspectorModel = {
  mode: "multi",
  selectedCount: 3,
  selectedElementIds: ["el_1", "el_2", "el_3"],
  shouldAutoOpenDesignInspector: true,
};

function renderInspector(
  model: SelectionInspectorModel,
  overrides: Partial<SelectionInspectorProps> = {},
) {
  return renderToString(
    <SelectionInspector
      canEdit
      elementControls={<div data-control="element">요소 controls</div>}
      elementLabel="텍스트"
      model={model}
      multiControls={<div data-control="multi">다중 controls</div>}
      slideControls={<div data-control="slide">슬라이드 controls</div>}
      slideLabel="Opening"
      {...overrides}
    />,
  );
}

describe("SelectionInspector", () => {
  it("renders only the control node matching the current mode", () => {
    const slideHtml = renderInspector(slideModel);
    const elementHtml = renderInspector(elementModel);
    const multiHtml = renderInspector(multiModel);

    expect(slideHtml).toContain('data-control="slide"');
    expect(slideHtml).not.toContain('data-control="element"');
    expect(slideHtml).not.toContain('data-control="multi"');

    expect(elementHtml).toContain('data-control="element"');
    expect(elementHtml).not.toContain('data-control="slide"');
    expect(elementHtml).not.toContain('data-control="multi"');

    expect(multiHtml).toContain('data-control="multi"');
    expect(multiHtml).not.toContain('data-control="slide"');
    expect(multiHtml).not.toContain('data-control="element"');
  });

  it("uses a stable region name without rendering editable mode summaries", () => {
    const slideHtml = renderInspector(slideModel);
    const elementHtml = renderInspector(elementModel);
    const multiHtml = renderInspector(multiModel);

    expect(slideHtml).toContain('role="region"');
    expect(slideHtml).toContain('aria-label="현재 선택"');
    expect(slideHtml).not.toContain("Opening 슬라이드 속성");
    expect(elementHtml).toContain('role="region"');
    expect(elementHtml).toContain('aria-label="현재 선택"');
    expect(elementHtml).not.toContain("선택한 텍스트 요소 속성");
    expect(multiHtml).toContain('role="region"');
    expect(multiHtml).toContain('aria-label="현재 선택"');
    expect(multiHtml).not.toContain("선택한 요소 3개 속성");
    expect(elementHtml).toContain('tabindex="0"');

    const focusRef = createRef<HTMLElement>();
    const element = SelectionInspector({
      canEdit: true,
      focusRef,
      model: elementModel,
    });
    expect(element.props.ref).toBe(focusRef);

    const defaultLabelsHtml = renderToString(
      <SelectionInspector canEdit model={slideModel} />,
    );
    expect(defaultLabelsHtml).not.toContain("현재 슬라이드 속성");
    expect(defaultLabelsHtml).not.toContain("슬라이드 슬라이드");
  });

  it("renders read-only selection summaries without mounting Viewer controls", () => {
    for (const [model, expectedSummary] of [
      [slideModel, "Opening 슬라이드의 정보를 보고 있습니다."],
      [elementModel, "선택한 텍스트 요소의 정보를 보고 있습니다."],
      [multiModel, "선택한 요소 3개의 정보를 보고 있습니다."],
    ] as const) {
      const html = renderInspector(model, {
        canEdit: false,
        elementControls: <input aria-label="element property" />,
        multiControls: <select aria-label="multi property" />,
        slideControls: <textarea aria-label="slide property" />,
      });

      expect(html).not.toContain("aria-readonly");
      expect(html).toContain(expectedSummary);
      expect(html).not.toContain("<input");
      expect(html).not.toContain("<select");
      expect(html).not.toContain("<textarea");
    }
  });

  it("handles Escape locally and delegates focus return to the shell", () => {
    const onEscape = vi.fn();
    const element = SelectionInspector({
      canEdit: true,
      model: elementModel,
      onEscape,
    }) as ReactElement<{
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    }>;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    element.props.onKeyDown({
      key: "Escape",
      preventDefault,
      stopPropagation,
    } as unknown as ReactKeyboardEvent<HTMLElement>);

    expect(onEscape).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();

    element.props.onKeyDown({
      key: "Enter",
      preventDefault,
      stopPropagation,
    } as unknown as ReactKeyboardEvent<HTMLElement>);
    expect(onEscape).toHaveBeenCalledOnce();
  });
});
