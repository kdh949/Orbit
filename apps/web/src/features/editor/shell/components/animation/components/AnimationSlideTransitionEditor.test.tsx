import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnimationSlideTransitionEditor } from "./AnimationSlideTransitionEditor";

describe("AnimationSlideTransitionEditor", () => {
  it("renders fade duration controls for an editable transition", () => {
    const html = renderToString(
      <AnimationSlideTransitionEditor
        transition={{ type: "fade", durationMs: 700 }}
        onUpdateTransition={vi.fn()}
      />
    );

    expect(html).toContain("슬라이드 전환");
    expect(html).toContain("전환 시간");
    expect(html).toContain("전환 제거");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("disables mutation controls with the fail-closed reason", () => {
    const html = renderToString(
      <AnimationSlideTransitionEditor
        mutationDisabledReason="원본 OOXML에 안전하게 저장할 수 없습니다."
        onUpdateTransition={vi.fn()}
      />
    );

    expect(html).toContain("원본 OOXML에 안전하게 저장할 수 없습니다.");
    expect(html).toContain("disabled=\"\"");
  });
});
