import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PresenterStageSection, PresenterTimerCard } from "./PresenterScaffold";

describe("PresenterStageSection", () => {
  it("keeps the stage background sized to the rendered slide", () => {
    const html = renderToStaticMarkup(
      <PresenterStageSection
        currentIndex={0}
        emptyStageLabel="비어 있음"
        nextHint="다음 설명"
        nextSlideTitle="다음 슬라이드"
        onNext={() => undefined}
        onPrevious={() => undefined}
        previousDisabled
        renderStage={<div data-testid="rendered-slide">슬라이드</div>}
        stageIndexLabel="01 / 08"
        totalSlides={8}
      />
    );

    expect(html).toContain(
      '<div class="rehearsal-stage-surface"><div data-testid="rendered-slide">'
    );
  });

  it("marks the stage busy and disables navigation while slide assets load", () => {
    const html = renderToStaticMarkup(
      <PresenterStageSection
        currentIndex={1}
        emptyStageLabel="비어 있음"
        navigationPending
        nextHint="다음 설명"
        nextSlideTitle="다음 슬라이드"
        onNext={() => undefined}
        onPrevious={() => undefined}
        previousDisabled={false}
        renderStage={<div>슬라이드</div>}
        totalSlides={8}
      />
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("슬라이드 준비 중…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("PresenterTimerCard", () => {
  it("renders read-only stopwatch progress with timing warning tones", () => {
    const html = renderToStaticMarkup(
      <PresenterTimerCard
        ariaLabel="리허설 스톱워치"
        currentTimeLabel="경과 발표 시간"
        infoCards={[]}
        meterPercent={0}
        onPrimaryAction={() => undefined}
        onReset={() => undefined}
        onTimeInputBlur={() => undefined}
        onTimeInputChange={() => undefined}
        onTimeInputFocus={() => undefined}
        primaryActionAriaLabel="리허설 일시정지"
        primaryActionRunning
        progressItems={[
          {
            currentLabel: "현재 00:45",
            label: "총 발표 시간",
            percent: 90,
            targetLabel: "예상 00:50",
            tone: "warning",
          },
          {
            currentLabel: "현재 00:56",
            label: "현재 슬라이드",
            percent: 100,
            targetLabel: "예상 00:50",
            tone: "danger",
          },
        ]}
        progressPercent={0}
        timeInputValue="00:45"
        timeMetaLeft=""
        timeMetaRight=""
        timeReadOnly
        title="발표 스톱워치"
      />
    );

    expect(html).toContain('aria-label="경과 발표 시간"');
    expect(html).not.toContain('aria-label="발표 시간 설정"');
    expect(html).toContain("rehearsal-side-timing-progress-warning");
    expect(html).toContain("rehearsal-side-timing-progress-danger");
  });
});
