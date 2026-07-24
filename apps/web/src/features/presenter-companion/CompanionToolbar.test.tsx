import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CompanionToolbar,
  companionStrokeWidthOptions,
} from "./CompanionToolbar";

describe("CompanionToolbar", () => {
  it("renders accessible icon tools and the pen palette", () => {
    const html = renderToStaticMarkup(
      <CompanionToolbar
        canClear
        canUndo
        color="ink-blue"
        disabled={false}
        onClear={vi.fn()}
        onColorChange={vi.fn()}
        onToolChange={vi.fn()}
        onUndo={vi.fn()}
        onWidthChange={vi.fn()}
        tool="pen"
        width={0.008}
        widthOptions={companionStrokeWidthOptions.pen}
      />,
    );

    expect(html).toContain('aria-label="펜"');
    expect(html).toContain('aria-label="형광펜"');
    expect(html).toContain('aria-label="지우개"');
    expect(html).toContain('aria-label="레이저"');
    expect(html).toContain('aria-label="펜 설정"');
    expect(html.match(/펜 굵기 [1-4]/g)).toHaveLength(4);
    expect(html).toContain('aria-label="파랑"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps action accessibility state disabled while recovering", () => {
    const html = renderToStaticMarkup(
      <CompanionToolbar
        canClear={false}
        canUndo={false}
        color="ink-blue"
        disabled
        onClear={vi.fn()}
        onColorChange={vi.fn()}
        onToolChange={vi.fn()}
        onUndo={vi.fn()}
        onWidthChange={vi.fn()}
        tool="laser"
        width={0.008}
        widthOptions={companionStrokeWidthOptions.pen}
      />,
    );

    expect(html).not.toContain("presenter-companion-palette");
    expect(html).toMatch(
      /<button aria-label="실행 취소"[^>]* disabled=""/,
    );
    expect(html).toMatch(
      /<button aria-label="모두 지우기"[^>]* disabled=""/,
    );
  });

  it("keeps the contracted width presets and current defaults", () => {
    expect(companionStrokeWidthOptions.pen).toEqual([
      0.004, 0.008, 0.014, 0.022,
    ]);
    expect(companionStrokeWidthOptions.highlighter).toEqual([
      0.012, 0.025, 0.035, 0.05,
    ]);
  });
});
