import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ValidationPanel } from "./ValidationPanel";
import type { EditorValidationPresentationItem } from "./validationPresentation";

type ValidationPanelProps = ComponentProps<typeof ValidationPanel>;

const noop = () => undefined;

function renderPanel(overrides: Partial<ValidationPanelProps> = {}) {
  return renderToStaticMarkup(
    <ValidationPanel
      canRepair
      items={[]}
      repairableElementIds={[]}
      repairStatus=""
      onFocusTarget={noop}
      onHighlightElementIds={noop}
      onRepairTextOverflow={noop}
      {...overrides}
    />,
  );
}

function validationItem(
  overrides: Partial<EditorValidationPresentationItem> = {},
): EditorValidationPresentationItem {
  return {
    item: {
      elementId: "el_raw_private_identifier",
      issue: "textOverflow",
      message: "텍스트가 상자 높이를 넘을 수 있습니다.",
      severity: "warning",
      slideId: "slide_raw_private_identifier",
    },
    recoveryInstruction: null,
    target: {
      elementIds: ["el_raw_private_identifier"],
      label: "3번 슬라이드 · 제목 텍스트",
      slideId: "slide_raw_private_identifier",
      status: "resolved",
    },
    ...overrides,
  };
}

describe("ValidationPanel", () => {
  it("renders a semantic target button without exposing raw identifiers", () => {
    const html = renderPanel({
      items: [validationItem()],
      repairableElementIds: ["el_raw_private_identifier"],
    });

    expect(html).toContain('data-testid="editor-validation-target"');
    expect(html).toContain("3번 슬라이드 · 제목 텍스트");
    expect(html).not.toContain("el_raw_private_identifier");
    expect(html).not.toContain("slide_raw_private_identifier");

    const targetStart = html.indexOf('data-testid="editor-validation-target"');
    const targetEnd = html.indexOf("</button>", targetStart);
    const repairStart = html.indexOf('data-testid="editor-validation-repair"');
    expect(targetStart).toBeGreaterThan(-1);
    expect(targetEnd).toBeGreaterThan(targetStart);
    expect(repairStart).toBeGreaterThan(targetEnd);
    expect(html.slice(targetStart, targetEnd)).not.toContain("<button");
  });

  it("disables partial and missing targets with a safe fallback label", () => {
    const html = renderPanel({
      items: [
        validationItem({
          target: {
            elementIds: ["el_raw_private_identifier"],
            label: "대상을 찾을 수 없음",
            slideId: "slide_raw_private_identifier",
            status: "partial",
          },
        }),
        validationItem({
          item: {
            issue: "GRID_ALIGNMENT_INCONSISTENT",
            message: "그리드 기준에서 벗어났습니다.",
            severity: "warning",
          },
          target: {
            elementIds: [],
            label: "대상을 찾을 수 없음",
            slideId: null,
            status: "missing",
          },
        }),
      ],
    });

    expect(html.match(/data-testid="editor-validation-target"/g)).toHaveLength(
      2,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html.match(/대상을 찾을 수 없음/g)).toHaveLength(2);
    expect(html).not.toContain("el_raw_private_identifier");
  });

  it("hides every mutation action from a Viewer", () => {
    const html = renderPanel({
      canRepair: false,
      items: [validationItem()],
      onRepairTextOverflow: undefined,
      repairableElementIds: ["el_raw_private_identifier"],
    });

    expect(html).toContain('data-testid="editor-validation-target"');
    expect(html).not.toContain('data-testid="editor-validation-repair"');
    expect(html).not.toContain('data-testid="editor-validation-repair-all"');
    expect(html).not.toContain("안전 수정");
  });

  it("renders overlap and grid guidance as manual recovery only", () => {
    const html = renderPanel({
      items: [
        validationItem({
          item: {
            elementIds: ["overlap_a", "overlap_b"],
            issue: "textOverlap",
            message: "텍스트 요소가 겹쳐 읽기 어려울 수 있습니다.",
            severity: "warning",
            slideId: "slide_3",
          },
          recoveryInstruction:
            "관련 객체를 모두 선택한 뒤 이동하거나 크기를 조정해 겹침을 해소하세요.",
          target: {
            elementIds: ["overlap_a", "overlap_b"],
            label: "3번 슬라이드 · 본문 텍스트, 강조 텍스트",
            slideId: "slide_3",
            status: "resolved",
          },
        }),
        validationItem({
          item: {
            elementId: "grid_a",
            issue: "GRID_ALIGNMENT_INCONSISTENT",
            message: "핵심 레이아웃 요소가 기준에서 벗어났습니다.",
            severity: "warning",
            slideId: "slide_3",
          },
          recoveryInstruction:
            "12열 그리드와 8px 간격에 맞춰 위치와 크기를 수동 조정하세요.",
          target: {
            elementIds: ["grid_a"],
            label: "3번 슬라이드 · 미디어",
            slideId: "slide_3",
            status: "resolved",
          },
        }),
      ],
      repairableElementIds: ["overlap_a", "overlap_b", "grid_a"],
    });

    expect(html).toContain("이동하거나 크기를 조정해 겹침을 해소하세요.");
    expect(html).toContain("12열 그리드와 8px 간격");
    expect(html).not.toContain('data-testid="editor-validation-repair"');
    expect(html).not.toContain('data-testid="editor-validation-repair-all"');
  });

  it("counts only allowlisted textOverflow targets for individual and bulk repair", () => {
    const onRepairTextOverflow = vi.fn();
    const html = renderPanel({
      items: [
        validationItem(),
        validationItem({
          item: {
            elementId: "overflow_second",
            issue: "textOverflow",
            message: "두 번째 텍스트가 넘칩니다.",
            severity: "warning",
            slideId: "slide_3",
          },
          target: {
            elementIds: ["overflow_second"],
            label: "3번 슬라이드 · 본문 텍스트",
            slideId: "slide_3",
            status: "resolved",
          },
        }),
        validationItem({
          item: {
            elementId: "wrapped_title",
            issue: "titleWrap",
            message: "제목이 여러 줄로 줄바꿈되었습니다.",
            severity: "warning",
            slideId: "slide_3",
          },
          target: {
            elementIds: ["wrapped_title"],
            label: "3번 슬라이드 · 제목 텍스트",
            slideId: "slide_3",
            status: "resolved",
          },
        }),
      ],
      onRepairTextOverflow,
      repairableElementIds: [
        "el_raw_private_identifier",
        "overflow_second",
        "wrapped_title",
      ],
    });

    expect(html).toContain("텍스트 넘침 2개 안전 수정");
    expect(html.match(/data-testid="editor-validation-repair"/g)).toHaveLength(
      2,
    );
    expect(
      html.match(/data-testid="editor-validation-repair-all"/g),
    ).toHaveLength(1);
    expect(html).not.toContain("텍스트 넘침 3개 안전 수정");
  });

  it("announces repair feedback through an atomic polite status region", () => {
    const html = renderPanel({
      repairStatus: "텍스트 넘침 2개를 안전 수정했습니다.",
    });

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("텍스트 넘침 2개를 안전 수정했습니다.");
  });
});
