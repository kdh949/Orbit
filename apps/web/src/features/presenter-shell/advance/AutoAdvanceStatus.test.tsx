import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultAutoAdvancePolicy } from "../../../runtime/presentation/advance/autoAdvanceConfig";
import { AutoAdvanceStatus } from "./AutoAdvanceStatus";
import type { AdvanceControllerState } from "../../../runtime/presentation/advance/advanceController";

describe("AutoAdvanceStatus", () => {
  it("renders presenter countdown status", () => {
    const html = renderStatus({
      countdownStartedAtMs: 1000,
      status: "countdown"
    });

    expect(html).toContain("자동 전환까지");
    expect(html).toContain("2초");
  });

  it("renders remaining build blocker", () => {
    const html = renderStatus({
      remainingTriggerSteps: 2,
      status: "blocked-by-builds"
    });

    expect(html).toContain("빌드 2개 남음");
  });

  it("renders non-blocking finish suggestion", () => {
    const html = renderStatus({
      status: "finish-suggested"
    });

    expect(html).toContain("발표 종료 준비됨");
    expect(html).toContain("종료");
  });

  it("renders manual guidance without forcing advance", () => {
    const html = renderStatus({
      manualGuidanceShown: true,
      status: "tracking"
    });

    expect(html).toContain("수동으로 넘겨주세요");
    expect(html).not.toContain("자동 전환까지");
  });

  it("removes countdown UI after cancellation returns to ready or tracking", () => {
    expect(renderStatus({ status: "ready" })).toBe("");
    expect(renderStatus({ status: "tracking" })).toBe("");
  });

  it("does not render stale manual guidance after eligibility recovers", () => {
    expect(
      renderStatus({
        manualGuidanceShown: true,
        status: "ready"
      })
    ).toBe("");
    expect(
      renderStatus({
        countdownStartedAtMs: 1000,
        manualGuidanceShown: true,
        status: "countdown"
      })
    ).not.toContain("수동으로 넘겨주세요");
  });

  it("renders nothing for ordinary tracking state", () => {
    expect(renderStatus({ status: "tracking" })).toBe("");
  });
});

function renderStatus(patch: Partial<AdvanceControllerState>) {
  const onFinish = vi.fn();
  return renderToStaticMarkup(
    <AutoAdvanceStatus
      countdownMs={defaultAutoAdvancePolicy.countdownMs}
      nowMs={1000}
      onFinish={onFinish}
      state={{
        countdownStartedAtMs: null,
        manualGuidanceShown: false,
        remainingTriggerSteps: 0,
        slideId: "slide-1",
        status: "tracking",
        ...patch
      }}
    />
  );
}
