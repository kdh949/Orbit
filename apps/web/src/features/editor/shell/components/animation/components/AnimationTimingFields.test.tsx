import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnimationTimingFields } from "./AnimationTimingFields";

describe("AnimationTimingFields", () => {
  it("shows all four start modes and the previous effect summary for a relative mode", () => {
    const html = renderToString(
      <AnimationTimingFields
        delayMs={100}
        durationMs={800}
        previousEffectSummary="선행 효과: 페이드 인 · 1번째"
        startMode="after-previous"
        onDelayChange={vi.fn()}
        onDurationChange={vi.fn()}
        onStartModeChange={vi.fn()}
      />
    );

    expect(html).toContain("애니메이션 시작 방식");
    expect(html).toContain("슬라이드 시작과 함께");
    expect(html).toContain("클릭할 때");
    expect(html).toContain("이전 효과와 함께");
    expect(html).toContain("이전 효과 다음");
    expect(html).toContain("선행 효과: 페이드 인 · 1번째");
  });

  it("explains the implicit transition base for an orphan after-previous", () => {
    const html = renderToString(
      <AnimationTimingFields
        delayMs={0}
        durationMs={400}
        startMode="after-previous"
        onDelayChange={vi.fn()}
        onDurationChange={vi.fn()}
        onStartModeChange={vi.fn()}
      />
    );

    expect(html).toContain("선행 효과 없음");
    expect(html).toContain("슬라이드 전환이 끝난 뒤 시작합니다.");
  });

  it("blocks an incompatible mode change for an action target", () => {
    const html = renderToString(
      <AnimationTimingFields
        delayMs={0}
        durationMs={400}
        startMode="on-click"
        startModeChangeDisabledReason="action 연결을 해제한 뒤 변경하세요."
        onDelayChange={vi.fn()}
        onDurationChange={vi.fn()}
        onStartModeChange={vi.fn()}
      />
    );

    expect(html).toContain("action 연결을 해제한 뒤 변경하세요.");
    expect(html).toContain("disabled=\"\"");
  });
});
