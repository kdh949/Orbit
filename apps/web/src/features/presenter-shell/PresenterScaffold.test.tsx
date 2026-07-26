import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "../../styles/readCssBundle.test-utils";
import { PresenterStageSection, PresenterTimerCard } from "./PresenterScaffold";

const presenterScaffoldSourcePath = fileURLToPath(
  new URL("./PresenterScaffold.tsx", import.meta.url),
);
const presenterStylesPath = fileURLToPath(
  new URL("../../styles.css", import.meta.url),
);
const rehearsalWorkspaceStylesPath = fileURLToPath(
  new URL("../rehearsal/rehearsal-workspace-orbit.css", import.meta.url),
);

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
      '<div class="rehearsal-stage-viewport"><div class="rehearsal-stage-surface"><div data-testid="rendered-slide">'
    );
  });

  it("measures the slide viewport without including the navigation controls", () => {
    const source = fs.readFileSync(presenterScaffoldSourcePath, "utf8");
    const styles = readCssBundle(presenterStylesPath);
    const stageWrapStart = source.indexOf('className="rehearsal-stage-wrap"');
    const controlsStart = source.indexOf(
      'className="rehearsal-slide-controls"',
      stageWrapStart,
    );
    const stageBody = source.slice(stageWrapStart, controlsStart);

    expect(stageBody).not.toMatch(/rehearsal-stage-wrap"\s+ref=/);
    expect(stageBody).toMatch(
      /className="rehearsal-stage-viewport" ref=\{props\.stageRef\}/,
    );
    expect(stageBody.match(/ref=\{props\.stageRef\}/g)).toHaveLength(2);
    expect(styles).toMatch(
      /\.rehearsal-stage-viewport \{[^}]*align-self: stretch;[^}]*justify-self: stretch;[^}]*min-height: 0;/s,
    );
    expect(styles).not.toMatch(
      /\.rehearsal-stage-viewport \{[^}]*height: 100%;/s,
    );
  });

  it("keeps rehearsal navigation above the visible slide shadow", () => {
    const styles = fs.readFileSync(rehearsalWorkspaceStylesPath, "utf8");

    expect(styles).toMatch(
      /\.rehearsal-presenter-shell \.rehearsal-stage-viewport \{[^}]*overflow: visible;[^}]*position: relative;[^}]*z-index: 1;/s,
    );
    expect(styles).toMatch(
      /\.rehearsal-presenter-shell \.rehearsal-stage-wrap > \.rehearsal-slide-controls \{[^}]*position: relative;[^}]*z-index: 2;/s,
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

  it("routes a normal stage click through the supplied next-step command", () => {
    const source = fs.readFileSync(presenterScaffoldSourcePath, "utf8");

    expect(source).toContain("onStageAdvance?: () => void;");
    expect(source).toContain("shouldAdvancePresentationFromClick(event.target)");
    expect(source).toContain("props.onStageAdvance();");
    expect(source).not.toContain("props.currentIndex >= props.totalSlides - 1");
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
