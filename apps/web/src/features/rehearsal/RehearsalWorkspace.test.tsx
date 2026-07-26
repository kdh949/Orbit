import { fileURLToPath } from "node:url";
import { createDemoDeck } from "@orbit/editor-core";
import { createKeywordOccurrenceId } from "@orbit/shared/deck";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCssBundle } from "../../styles/readCssBundle.test-utils";
import { RehearsalCompletionScreen } from "./completion/RehearsalCompletionScreen";
import { getPreflightMicrophonePermissionHint } from "./preflight/RehearsalPreflightScreen";
import {
  applyLiveTranscriptEvent,
  confirmKeywordOccurrenceMatches,
  createKeywordOccurrenceAnimationCueEvent,
  createLiveKeywordOccurrenceState,
  createLiveTranscriptBuffer,
  evaluateLiveTranscript,
  getOccurrenceTriggerProgress,
  renderLiveTranscriptBuffer,
} from "../../runtime/speech/tracking/liveTranscriptAnalysis";
import { RehearsalWorkspace } from "./RehearsalWorkspace";
import { RehearsalFailureScreen } from "./completion/RehearsalFailureScreen";
import {
  buildP3SessionSlides,
  getHighlightedKeywordOccurrencesForSlide,
  getRehearsalPrompterRows,
  getRehearsalTimingProgress,
  getRemainingTriggerStepsForSlide,
  resetRehearsalTimerState,
  shouldRenderRehearsalThumbnailImage,
} from "./rehearsalWorkspaceModel";
import {
  getRehearsalFinishPath,
  getRehearsalPresenterWindowPath,
  getRehearsalReportPath,
} from "./rehearsalRoutes";
import { p0AnimationDeck } from "../../runtime/presentation/slideshow/__fixtures__/animationDeck";
import { matchKeywordOccurrenceTriggers } from "../../runtime/speech/tracking/keywordOccurrenceRuntime";

const createdAt = "2026-06-29T00:00:00.000Z";

const globalStylesPath = fileURLToPath(
  new URL("../../styles.css", import.meta.url),
);

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text,
  };
});

describe("RehearsalWorkspace integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("녹음 시작 실패를 숨기지 않고 재시도와 대체 경로를 제공한다", () => {
    const html = renderToStaticMarkup(
      <RehearsalFailureScreen
        error="마이크를 시작하지 못했습니다."
        onPracticeWithoutVoice={() => undefined}
        onRetry={() => undefined}
        projectId="project retry"
      />,
    );

    expect(html).toContain("리허설을 시작하지 못했습니다.");
    expect(html).toContain("마이크를 시작하지 못했습니다.");
    expect(html).toContain("다시 시도");
    expect(html).toContain("마이크 없이 연습");
    expect(html).toContain("/project/project%20retry");
  });

  it("renders the pre-rehearsal preflight screen before recording starts", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalWorkspace initialDeck={deck} />,
    );

    expect(html).toContain("리허설");
    expect(html).toContain("리허설을 시작할까요?");
    expect(html).toContain("마이크 권한 확인");
    expect(html).toContain("마이크 연결 확인");
    expect(html).not.toContain("음성 인식 준비");
    expect(html).toContain(`슬라이드 ${deck.slides.length}장 로드됨`);
    expect(html).toContain("음성 트리거");
    expect(html).toContain("리허설 시작");
    expect(html).toContain('disabled=""');
    expect(html).toContain(
      "마이크 연결을 확인해야 리허설을 시작할 수 있습니다.",
    );
    expect(html).toContain("음성 없이 연습하기");
    expect(html).toContain("이번 목표는");
    expect(html).not.toContain("지난번보다");
    expect(html).not.toContain("Live STT");
    expect(html).not.toContain(deck.slides[0]?.title);
    expect(html).not.toContain("Partial transcript");
    expect(html).not.toContain("Report AI");
    expect(html).not.toContain("Speaker notes");
  });

  it("shows an already granted browser microphone permission as allowed", () => {
    expect(getPreflightMicrophonePermissionHint("granted")).toBe("granted");
    expect(getPreflightMicrophonePermissionHint("denied")).toBe("denied");
    expect(getPreflightMicrophonePermissionHint("prompt")).toBe("prompt");
  });

  it("keeps explicit editor and home exits on the rehearsal completion screen", () => {
    const html = renderToStaticMarkup(
      <RehearsalCompletionScreen
        hasReportTarget={false}
        isReportPending={false}
        onClose={() => undefined}
        onGoHome={() => undefined}
        onOpenProject={() => undefined}
        onPracticeAgain={() => undefined}
        onPrimaryAction={() => undefined}
      />,
    );

    expect(html).toContain("프로젝트 편집기로");
    expect(html).toContain("홈으로");
    expect(html).toContain("다시 연습하기");
    expect(html).not.toContain("발표 시간");
    expect(html).not.toContain("대본 커버리지");
  });

  it("reflects report preparation and ready states on the completion screen", () => {
    const sharedProps = {
      onClose: () => undefined,
      onGoHome: () => undefined,
      onOpenProject: () => undefined,
      onPracticeAgain: () => undefined,
      onPrimaryAction: () => undefined,
    };
    const pendingHtml = renderToStaticMarkup(
      <RehearsalCompletionScreen
        {...sharedProps}
        hasReportTarget
        isReportPending
      />,
    );
    const readyHtml = renderToStaticMarkup(
      <RehearsalCompletionScreen
        {...sharedProps}
        hasReportTarget
        isReportPending={false}
      />,
    );

    expect(pendingHtml).toContain("리포트를 준비하고 있어요");
    expect(pendingHtml).toContain("disabled");
    expect(readyHtml).toContain("리포트가 준비됐어요");
    expect(readyHtml).not.toContain("disabled");
  });

  it("uses the stored previous rehearsal summary on the preflight screen", () => {
    const deck = createDemoDeck();
    const key = `orbit.rehearsal.lastSummary:${deck.projectId}:${deck.deckId}`;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (requestedKey: string) =>
          requestedKey === key
            ? JSON.stringify({
                completedAt: createdAt,
                coveragePercent: 75,
                deckId: deck.deckId,
                durationSeconds: 270,
                missedKeywordCount: 1,
                projectId: deck.projectId,
                targetSeconds: 300,
              })
            : null,
      },
    });

    const html = renderToStaticMarkup(
      <RehearsalWorkspace initialDeck={deck} />,
    );

    expect(html).toContain("지난 리허설은 4:30였습니다.");
    expect(html).not.toContain("지난번보다 30초");
  });

  it("creates occurrence animation cue events with occurrence id and display text separated", () => {
    expect(
      createKeywordOccurrenceAnimationCueEvent({
        slideId: "slide_1",
        match: {
          keywordId: "kw_ai",
          occurrenceId: "kwo_slide_1_kw_ai_47_49",
          text: "AI",
          matchedScriptOffset: 47,
          currentCharOffset: 55,
        },
      }),
    ).toEqual({
      type: "animation-cue",
      slideId: "slide_1",
      keywordId: "kw_ai",
      occurrenceId: "kwo_slide_1_kw_ai_47_49",
      cue: "emphasis",
      text: "AI",
    });
  });

  it("keeps keyword checklist coverage separate from occurrence trigger progress", () => {
    const targetOccurrenceId = "kwo_slide_1_kw_ai_47_49";
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      speakerNotes:
        "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다. 마지막에 AI를 말하면 이미지가 나타납니다.",
      keywords: [
        {
          keywordId: "kw_ai",
          text: "AI",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
    };
    const initialOccurrenceState = createLiveKeywordOccurrenceState(
      slide.slideId,
    );
    const earlyTranscript = "오늘은 AI 덱 생성 파이프라인을 소개합니다.";
    const earlyAnalysis = evaluateLiveTranscript(slide, earlyTranscript);
    const earlyMatches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: [targetOccurrenceId],
      transcript: earlyTranscript,
      latestTranscript: "AI",
      confidence: 0.95,
      confirmedOccurrenceIds: initialOccurrenceState.confirmedOccurrenceIds,
    });
    const earlyOccurrenceState = confirmKeywordOccurrenceMatches(
      initialOccurrenceState,
      earlyMatches,
    );

    expect(earlyAnalysis.coverage).toBe(1);
    expect(earlyMatches).toEqual([]);
    expect(
      getOccurrenceTriggerProgress({
        targetOccurrenceIds: [targetOccurrenceId],
        confirmedOccurrenceIds: earlyOccurrenceState.confirmedOccurrenceIds,
      }),
    ).toEqual({
      targetOccurrenceIds: [targetOccurrenceId],
      confirmedOccurrenceIds: [],
      coverage: 0,
    });

    const lateTranscript =
      "오늘은 AI 덱 생성 파이프라인을 소개합니다. 중간에도 AI를 언급합니다. 마지막에 AI를 말하면";
    const lateMatches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds: [targetOccurrenceId],
      transcript: lateTranscript,
      latestTranscript: "AI",
      confidence: 0.95,
      confirmedOccurrenceIds: earlyOccurrenceState.confirmedOccurrenceIds,
    });
    const lateOccurrenceState = confirmKeywordOccurrenceMatches(
      earlyOccurrenceState,
      lateMatches,
    );

    expect(lateMatches.map((match) => match.occurrenceId)).toEqual([
      targetOccurrenceId,
    ]);
    expect(
      getOccurrenceTriggerProgress({
        targetOccurrenceIds: [targetOccurrenceId],
        confirmedOccurrenceIds: lateOccurrenceState.confirmedOccurrenceIds,
      }),
    ).toEqual({
      targetOccurrenceIds: [targetOccurrenceId],
      confirmedOccurrenceIds: [targetOccurrenceId],
      coverage: 1,
    });
  });

  it("highlights required occurrence IDs alongside targeted trigger occurrences", () => {
    const speakerNotes = "keyword occurrence class는 keyword";
    const targetStart = speakerNotes.lastIndexOf("keyword");
    const targetOccurrenceId = createKeywordOccurrenceId(
      "slide_1",
      "kw_keyword",
      targetStart,
      targetStart + "keyword".length,
    );
    const occurrenceStart = speakerNotes.indexOf("occurrence");
    const classStart = speakerNotes.indexOf("class는");
    const requiredOccurrenceId = createKeywordOccurrenceId(
      "slide_1",
      "kw_occurrence",
      occurrenceStart,
      occurrenceStart + "occurrence".length,
    );
    const requiredClassOccurrenceId = createKeywordOccurrenceId(
      "slide_1",
      "kw_class",
      classStart,
      classStart + "class는".length,
    );
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      speakerNotes,
      keywords: [
        {
          keywordId: "kw_keyword",
          text: "keyword",
          synonyms: [],
          abbreviations: [],
          required: false,
        },
        {
          keywordId: "kw_occurrence",
          text: "occurrence",
          synonyms: [],
          abbreviations: [],
          required: true,
          requiredOccurrenceIds: [requiredOccurrenceId],
        },
        {
          keywordId: "kw_class",
          text: "class는",
          synonyms: [],
          abbreviations: [],
          required: true,
          requiredOccurrenceIds: [requiredClassOccurrenceId],
        },
      ],
      actions: [
        {
          actionId: "act_keyword",
          trigger: {
            kind: "keyword-occurrence" as const,
            keywordId: "kw_keyword",
            occurrenceId: targetOccurrenceId,
          },
          effect: {
            kind: "go-to-next-slide" as const,
          },
        },
      ],
    };

    expect(
      (getHighlightedKeywordOccurrencesForSlide(slide) ?? []).map(
        (occurrence) => occurrence.occurrenceId,
      ),
    ).toEqual([
      requiredOccurrenceId,
      requiredClassOccurrenceId,
      targetOccurrenceId,
    ]);
  });

  it("does not highlight every occurrence for a required keyword text", () => {
    const speakerNotes = "원인은 selected 판정은 occurrence 기준입니다 은";
    const selectedStart = speakerNotes.lastIndexOf("은");
    const selectedOccurrenceId = createKeywordOccurrenceId(
      "slide_1",
      "kw_eun",
      selectedStart,
      selectedStart + "은".length,
    );
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      speakerNotes,
      keywords: [
        {
          keywordId: "kw_eun",
          text: "은",
          synonyms: [],
          abbreviations: [],
          required: true,
          requiredOccurrenceIds: [selectedOccurrenceId],
        },
      ],
      actions: [],
    };

    expect(
      (getHighlightedKeywordOccurrencesForSlide(slide) ?? []).map(
        (occurrence) => occurrence.occurrenceId,
      ),
    ).toEqual([selectedOccurrenceId]);
  });

  it("does not derive broad highlights from legacy required keywords", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      speakerNotes: "원인은 selected 판정은 occurrence 기준입니다 은",
      keywords: [
        {
          keywordId: "kw_eun",
          text: "은",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
      actions: [],
    };

    expect(getHighlightedKeywordOccurrencesForSlide(slide)).toEqual([]);
  });

  it("builds the presenter window rehearsal URL with the shared session id", () => {
    expect(
      getRehearsalPresenterWindowPath("project demo/1", "session-presenter/1", {
        slideIndex: 2,
        stepIndex: 1,
      }),
    ).toBe(
      "/rehearsal/project%20demo%2F1?presenterSessionId=session-presenter%2F1&presenterWindow=1&slideIndex=2&stepIndex=1",
    );
  });

  it("renders a presenter remote window without the full rehearsal workspace", () => {
    const html = renderToStaticMarkup(
      <RehearsalWorkspace
        initialDeck={p0AnimationDeck}
        presenterSessionId="session-presenter-1"
        presenterWindow={true}
      />,
    );

    expect(html).toContain("발표자 제어");
    expect(html).toContain("대본");
    expect(html).toContain("현재 슬라이드");
    expect(html).toContain("다음 슬라이드");
    expect(html).toContain('aria-label="발표 진행 패널"');
    expect(html).toContain('aria-label="키워드 체크리스트"');
    expect(html).toContain("타이머");
    expect(html).not.toContain("슬라이드 목표");
    expect(html).toContain("첫 문장입니다");
    expect(html).not.toContain("Live STT 시작");
    expect(html).not.toContain("Report AI");
  });

  it("uses the neutral scrim behind report generation progress", () => {
    const css = readCssBundle(globalStylesPath);

    expect(css).toMatch(
      /\.rehearsal-completion-modal-backdrop \{[^}]*background: var\(--redesign-color-scrim\);/s,
    );
  });
});
