import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createDemoDeck } from "@orbit/editor-core";
import {
  createKeywordOccurrenceId,
  createRehearsalEvaluationSnapshot,
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSlideSpeakingRate,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type Job,
  type RehearsalReport,
  type RehearsalRun,
} from "@orbit/shared";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RehearsalReportDocument } from "./RehearsalReportDocument";
import {
  LiveSttAdapterError,
  RehearsalFailureScreen,
  RehearsalCompletionScreen,
  RehearsalReportPage,
  RehearsalFlowError,
  RehearsalWorkspace,
  SherpaLiveSttAdapter,
  applyLiveTranscriptBias,
  applyLiveTranscriptEvent,
  buildP3SessionSlides,
  buildLiveSttBiasContext,
  cancelRehearsalRun,
  confirmKeywordOccurrenceMatches,
  createRehearsalRun,
  createRehearsalRunForUpload,
  createKeywordOccurrenceAnimationCueEvent,
  createLiveKeywordOccurrenceState,
  createLiveTranscriptBuffer,
  createRecordingFile,
  createRecordingSession,
  evaluateLiveTranscript,
  fetchRehearsalReport,
  fetchOrCreateRehearsalDeck,
  getRehearsalFinishPath,
  getHighlightedKeywordOccurrencesForSlide,
  getRehearsalPresenterWindowPath,
  getRehearsalReportPath,
  getLiveAudioLevelLabel,
  getLiveAudioLevelPercent,
  getLiveSttDebugDecodingMethod,
  getOccurrenceTriggerProgress,
  getRehearsalMicrophoneAudioConstraints,
  getPreflightMicrophonePermissionHint,
  getRehearsalPrompterRows,
  getRehearsalTeleprompterScrollBehavior,
  getRehearsalTimingProgress,
  isReusableRehearsalMediaStream,
  getRemainingTriggerStepsForSlide,
  normalizeRecordingMimeType,
  prepareRehearsalEvaluationRun,
  rehearsalMicrophoneAudioConstraints,
  rehearsalRawMicrophoneAudioConstraints,
  renderLiveTranscriptBuffer,
  requestRehearsalMicrophoneStream,
  resetRehearsalTimerState,
  resolveRehearsalReportLoadState,
  retryRehearsalSemanticEvaluation,
  runRehearsalPauseSequence,
  runRehearsalUploadFlow,
  selectRecordingMimeType,
  setMediaStreamTracksEnabled,
  shouldLoadPracticeGoalSummary,
  shouldRenderRehearsalThumbnailImage,
  shouldShowLiveSttDebugPcmDownload,
} from "./RehearsalWorkspace";
import {
  defaultAutoAdvanceConfig,
  defaultAutoAdvancePolicy,
} from "./advance/autoAdvanceConfig";
import {
  cancelAdvanceCountdown,
  createInitialAdvanceControllerState,
  evaluateAdvanceController,
} from "./advance/advanceController";
import { p0AnimationDeck } from "./presenter/__fixtures__/animationDeck";
import { getNextPresenterStepState } from "./presenter/presenterStepNavigation";
import { normalizeLiveTranscriptText } from "./stt/liveTranscriptText";
import { createPauseDetector } from "./speech/pauseDetector";
import { matchKeywordOccurrenceTriggers } from "./speech/keywordOccurrenceRuntime";
import {
  confirmRehearsalCommandCandidate,
  createRehearsalCommandConfirmationState,
  detectRehearsalCommandCandidate,
} from "./rehearsalCommands";
import { resolveEditorAssetUrl } from "../editor/shared/editorAssetUrl";

const createdAt = "2026-06-29T00:00:00.000Z";
const rehearsalWorkspaceSourcePath = fileURLToPath(
  new URL("./RehearsalWorkspace.tsx", import.meta.url),
);
const rehearsalWorkspaceCssPath = fileURLToPath(
  new URL("./rehearsal-workspace-orbit.css", import.meta.url),
);
const rehearsalPanelSourcePath = fileURLToPath(
  new URL("./panel/RehearsalPanel.tsx", import.meta.url),
);
const rehearsalTeleprompterSourcePath = fileURLToPath(
  new URL("./presenter/RehearsalScriptTeleprompter.tsx", import.meta.url),
);
const presenterScaffoldSourcePath = fileURLToPath(
  new URL("../presenter-shell/PresenterScaffold.tsx", import.meta.url),
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

describe("RehearsalWorkspace", () => {
  it("measures the presenter stage before painting the slide at an incorrect scale", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const hookStart = source.indexOf("function usePresenterStageScale");
    const hookEnd = source.indexOf(
      "function getRehearsalPaceSummaryLabel",
      hookStart,
    );
    const hookBody = source.slice(hookStart, hookEnd);
    const stageRenderStart = source.indexOf("renderStage={");
    const stageRenderEnd = source.indexOf("stageIndexLabel=", stageRenderStart);
    const stageRenderBody = source.slice(stageRenderStart, stageRenderEnd);

    expect(hookBody).toContain("useState<number | null>(null)");
    expect(hookBody).toContain("useLayoutEffect(() => {");
    expect(hookBody).toContain(
      "const observer = new ResizeObserver(updateScale)",
    );
    expect(hookBody).toContain(
      'window.addEventListener("resize", updateScale)',
    );
    expect(hookBody).not.toContain("scheduleScaleUpdate");
    expect(hookBody).not.toContain("useState(0.44)");
    expect(stageRenderBody).toContain("presenterScale !== null");
  });

  it("keeps the presenter layout width and responsive stage height stable", () => {
    const css = fs.readFileSync(rehearsalWorkspaceCssPath, "utf8");

    expect(css).toMatch(
      /\.rehearsal-presenter-layout \{[^}]*--rehearsal-stage-block-size:[^;]+;[^}]*width: 100%;/s,
    );
    expect(css).toMatch(
      /@media \(max-width:1120px\)[\s\S]*?\.rehearsal-presenter-main \{[^}]*grid-template-rows: var\(--rehearsal-stage-block-size\) 44px;/,
    );
  });

  it("keeps the audience controls inside the presenter topbar", () => {
    const css = fs.readFileSync(rehearsalWorkspaceCssPath, "utf8");

    expect(css).toMatch(
      /main\.rehearsal-presenter-shell \{[^}]*grid-template-rows: auto minmax\(0, 1fr\);/s,
    );
    expect(css).toMatch(
      /\.rehearsal-presenter-shell \.rehearsal-presenter-topbar \{[^}]*height: auto;/s,
    );
    expect(css).toMatch(
      /\.rehearsal-display-toolbar\s*> \.audience-output-controls \{[^}]*padding: 0;/s,
    );
    expect(css).toMatch(
      /\.rehearsal-display-toolbar[\s\S]*?> \.audience-output-controls[\s\S]*?button \{[^}]*min-height: 34px;/,
    );
  });

  it("keeps rehearsal assistance mounted while hiding the annotated presenter chrome", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const css = fs.readFileSync(rehearsalWorkspaceCssPath, "utf8");
    const panelSource = fs.readFileSync(rehearsalPanelSourcePath, "utf8");
    const teleprompterSource = fs.readFileSync(
      rehearsalTeleprompterSourcePath,
      "utf8",
    );
    const presenterScaffoldSource = fs.readFileSync(
      presenterScaffoldSourcePath,
      "utf8",
    );

    expect(source).toContain(
      'className="rehearsal-assist-card checklist-card"',
    );
    expect(teleprompterSource).toContain(
      'className="rehearsal-teleprompter-progress"',
    );
    expect(panelSource).toContain(
      'className="rehearsal-panel-section rehearsal-panel-script"',
    );
    expect(presenterScaffoldSource).toContain(
      'className="rehearsal-side-audio-gauge"',
    );
    expect(css).toMatch(/\.rehearsal-stage-label,[^{]+\{[^}]*display: none;/s);
    expect(css).toMatch(
      /\.rehearsal-next-slide-preview \{[^}]*display: none;/s,
    );
    expect(css).toMatch(
      /\.rehearsal-teleprompter-progress \{[^}]*display: none;/s,
    );
    expect(css).toMatch(/\.rehearsal-panel-live-slot \{[^}]*display: none;/s);
    expect(css).toMatch(
      /\.rehearsal-side-audio-gauge,[^{]+\{[^}]*display: none;/s,
    );
    expect(css).toMatch(/\.rehearsal-panel-script \{[^}]*display: none;/s);
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
        onGoHome={() => undefined}
        onOpenProject={() => undefined}
        onPracticeAgain={() => undefined}
        onPrimaryAction={() => undefined}
        summary={{
          comparisonLabel: "",
          coverageLabel: "측정 안 됨",
          coveragePercent: 0,
          durationLabel: "01:00",
          durationSeconds: 60,
          hasSpeechTrackingData: false,
          missedKeywordRows: [],
          missedKeywordCount: 0,
          missedKeywordCountLabel: "-",
          missedKeywordEmptyLabel: "음성 추적 데이터가 없습니다.",
          targetDeltaLabel: "목표와 같음",
          targetLabel: "01:00",
          targetSeconds: 60,
        }}
      />,
    );

    expect(html).toContain("프로젝트 편집기로");
    expect(html).toContain("홈으로");
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

  it("opens a slide window while keeping presenter tools in the current window", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const slideWindowStart = source.indexOf(
      "const openSlideWindowForDisplay =",
    );
    const start = source.indexOf("const openSlideDisplay = async");
    const end = source.indexOf("const checklistKeywords");
    const openSlideWindowBody = source.slice(slideWindowStart, start);
    const openSlideDisplayBody = source.slice(start, end);

    expect(openSlideWindowBody).toContain("displayManager.openSlideWindow");
    expect(openSlideWindowBody).toContain(
      "target: `orbit-slide-${presentationChannel.sessionId}-${Date.now()}`",
    );
    expect(openSlideWindowBody).toContain("closeExistingSlideWindow()");
    expect(openSlideWindowBody).not.toContain("displayManager.placeOnScreen");
    expect(openSlideWindowBody).toContain(
      "publishSlideWindowSnapshot(options.startFromBeginning)",
    );
    expect(openSlideDisplayBody).toContain(
      "await openSlideWindowForDisplay(options)",
    );
    expect(openSlideDisplayBody).toContain("displayOpened");
    expect(openSlideDisplayBody).toContain('displayMode: "slide-window"');
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
    expect(html).toContain("핵심 키워드");
    expect(html).toContain("타이머");
    expect(html).toContain("슬라이드 목표");
    expect(html).toContain("첫 문장입니다");
    expect(html).not.toContain("Live STT 시작");
    expect(html).not.toContain("Report AI");
  });

  it("routes presenter remote timer controls through timer and Live STT state", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const commandStart = source.indexOf(
      "function handlePresenterRemoteCommand",
    );
    const commandEnd = source.indexOf("useEffect(() => {", commandStart);
    const stateStart = source.indexOf(
      "const presentationChannelState = useMemo",
    );
    const stateEnd = source.indexOf("const presentationChannel =", stateStart);
    const commandBody = source.slice(commandStart, commandEnd);
    const stateBody = source.slice(stateStart, stateEnd);

    expect(commandBody).toContain('command.action === "timer-start"');
    expect(commandBody).toContain("resumePausedRehearsal()");
    expect(commandBody).toContain("void startLiveDemo()");
    expect(commandBody).toContain('command.action === "timer-pause"');
    expect(commandBody).toContain("pauseActiveRehearsal()");
    expect(commandBody).toContain('command.action === "timer-reset"');
    expect(commandBody).toContain("resetRehearsalTimerState");
    expect(stateBody).toContain("timing:");
    expect(stateBody).toContain("currentSlideTargetSeconds");
    expect(stateBody).toContain("isLiveSttActive");
  });

  it("ignores late Live STT callbacks after the presenter timer stops tracking", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const errorStart = source.indexOf("function handleLiveSttError");
    const resultStart = source.indexOf("function handleLiveSttResult");
    const partialStart = source.indexOf("function handleLivePartialTranscript");
    const errorBody = source.slice(errorStart, resultStart);
    const resultBody = source.slice(resultStart, partialStart);

    expect(errorBody).toContain("if (!p3SessionRef.current)");
    expect(resultBody).toContain("!p3SessionRef.current");
    expect(resultBody).toContain(
      'rehearsalRuntimeStatusRef.current === "paused"',
    );
    expect(resultBody.indexOf("!p3SessionRef.current")).toBeLessThan(
      resultBody.indexOf("handleLivePartialTranscript"),
    );
  });

  it("Live STT runtime 오류가 나도 수동 발표와 타이머는 계속 유지한다", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const errorStart = source.indexOf("function handleLiveSttError");
    const resultStart = source.indexOf("function handleLiveSttResult");
    const errorBody = source.slice(errorStart, resultStart);

    expect(errorBody).not.toContain("setIsTimerRunning(false)");
    expect(errorBody).not.toContain('setRehearsalRuntimeStatus("idle")');
    expect(errorBody).toContain("resetAutoAdvanceRuntimeState");
  });

  it("requests Window Management screens for automatic slide-window placement", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const requestStart = source.indexOf("const requestDisplayScreens =");
    const resolveStart = source.indexOf("const resolveAutoPlacementScreen =");
    const openStart = source.indexOf("const openSlideWindowForDisplay =");
    const renderStart = source.indexOf("const checklistKeywords");
    const requestBody = source.slice(requestStart, resolveStart);
    const resolveBody = source.slice(resolveStart, openStart);
    const openBody = source.slice(openStart, renderStart);

    expect(requestBody).toContain("displayManager.listExternalScreens()");
    expect(resolveBody).toContain("options.targetScreen");
    expect(resolveBody).not.toContain("displayManager.listExternalScreens()");
    expect(openBody).toContain("screen: targetScreen");
    expect(openBody).toContain("placementTargetLabel: targetScreen?.label");
  });

  it("delegates slide-window fullscreen from the presenter window", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const requestStart = source.indexOf("const requestSlideWindowFullscreen =");
    const openStart = source.indexOf("const openSlideWindowForDisplay =");
    const renderStart = source.indexOf("<DisplayControls");
    const requestBody = source.slice(requestStart, openStart);
    const renderBody = source.slice(
      renderStart,
      source.indexOf("/>", renderStart),
    );

    expect(requestBody).toContain("slideWindowRef.current");
    expect(requestBody).toContain(
      "displayManager.delegateSlideWindowFullscreen",
    );
    expect(renderBody).toContain(
      "onRequestSlideWindowFullscreen={requestSlideWindowFullscreen}",
    );
  });

  it("wires audience output state, popup reattach, and receiver failure cleanup", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const publisherStart = source.indexOf(
      "const presentationChannel = usePresentationChannelPublisher",
    );
    const controllerStart = source.indexOf(
      "const audienceScreenShare = useAudienceScreenShare",
    );
    const controllerEnd = source.indexOf(
      "const displayManager = useMemo",
      controllerStart,
    );
    const integrationBody = source.slice(publisherStart, controllerEnd);

    expect(integrationBody).toContain("onPeerReady: (peer)");
    expect(integrationBody).toContain("reattachAudienceStreamRef.current()");
    expect(integrationBody).toContain("onScreenShareEnded:");
    expect(integrationBody).toContain("stopAudienceStreamRef.current()");
    expect(integrationBody).toContain("slideWindowRef.current");
    expect(integrationBody).toContain("setAudienceOutputMode");
    expect(integrationBody).toContain("handlePeerUnavailable");
  });

  it("supports Surface Swap fullscreen before opening the presenter remote popup", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const surfaceStart = source.indexOf("const openSurfaceSwapDisplay =");
    const openStart = source.indexOf(
      "const openSlideWindowForDisplay =",
      surfaceStart,
    );
    const publisherStart = source.indexOf(
      "const presentationChannel = usePresentationChannelPublisher",
    );
    const publisherBody = source.slice(
      publisherStart,
      source.indexOf("});", publisherStart),
    );
    const surfaceBody = source.slice(surfaceStart, openStart);

    expect(surfaceBody).toContain("displayManager.requestFullscreenOnScreen");
    expect(surfaceBody).toContain("displayManager.openPresenterRemoteWindow");
    expect(surfaceBody.indexOf("requestFullscreenOnScreen")).toBeLessThan(
      surfaceBody.indexOf("openPresenterRemoteWindow"),
    );
    expect(surfaceBody).toContain('setDisplayRole("slide-surface")');
    expect(publisherBody).toContain('displayRole === "slide-surface"');
    expect(publisherBody).toContain("onCommand: handlePresenterRemoteCommand");
  });

  it("keeps presenter controls active in the current-window slide receiver", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const keyboardStart = source.indexOf("usePresenterKeyboard({");
    const keyboardEnd = source.indexOf("});", keyboardStart);
    const keyboardBody = source.slice(keyboardStart, keyboardEnd);
    const receiverStart = source.indexOf('(displayRole === "slide-receiver"');
    const receiverEnd = source.indexOf("if (isSingleScreenOpen");
    const receiverBody = source.slice(receiverStart, receiverEnd);

    expect(keyboardBody).toContain('displayRole === "slide-receiver"');
    expect(receiverBody).toContain("controlOverlayMode={");
    expect(receiverBody).toContain('displayRole === "slide-receiver"');
    expect(receiverBody).toContain('"always" : "fallback"');
    expect(receiverBody).toContain("onNextStep={handleNextPresenterStep}");
    expect(receiverBody).toContain("onPreviousSlide={goPrevious}");
  });

  it("supports Google Slides style fullscreen in the current document", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const currentWindowStart = source.indexOf(
      "const openCurrentWindowSlideDisplay =",
    );
    const start = source.indexOf("const openSlideDisplay = async");
    const end = source.indexOf("const checklistKeywords");
    const openCurrentWindowBody = source.slice(currentWindowStart, start);
    const openSlideDisplayBody = source.slice(start, end);

    expect(openCurrentWindowBody).toContain("requestPresentWindowFullscreen");
    expect(openCurrentWindowBody).toContain("document.documentElement");
    expect(openCurrentWindowBody).toContain('setDisplayRole("slide-receiver")');
    expect(openCurrentWindowBody).toContain("setSlideReceiverMessage");
    expect(openSlideDisplayBody).toContain(
      'options.displayMode === "current-window"',
    );
    expect(openSlideDisplayBody).toContain(
      "openCurrentWindowSlideDisplay(options)",
    );
  });

  it("renders slide receiver mode without the presenter toolbar or notes", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf('if (\n    (displayRole === "slide-receiver"');
    const end = source.indexOf("if (isSingleScreenOpen");
    const slideReceiverRenderBody = source.slice(start, end);

    expect(slideReceiverRenderBody).toContain("PresentWindowReceiver");
    expect(slideReceiverRenderBody).toContain("controlOverlayMode=");
    expect(slideReceiverRenderBody).toContain(
      "initialSnapshot={slideReceiverSnapshot}",
    );
    expect(slideReceiverRenderBody).toContain(
      "onReconnectPresenter={(snapshot)",
    );
    expect(slideReceiverRenderBody).toContain(
      "slideIndex: snapshot.state.slideIndex",
    );
    expect(slideReceiverRenderBody).toContain(
      "stepIndex: snapshot.state.stepIndex",
    );
    expect(slideReceiverRenderBody).toContain('setDisplayRole("presenter")');
    expect(slideReceiverRenderBody).not.toContain("DisplayControls");
    expect(slideReceiverRenderBody).not.toContain("RehearsalPanel");
    expect(slideReceiverRenderBody).not.toContain("speakerNotes");
  });

  it("resets presenter step when P4 auto advance command completes", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("function runAdvanceControllerEvaluation");
    const end = source.indexOf("function handleLiveSttError");
    const autoAdvanceBody = source.slice(start, end);

    expect(autoAdvanceBody).toContain("evaluateAdvanceController");
    expect(autoAdvanceBody).toContain('command.type !== "advance-slide"');
    expect(autoAdvanceBody).toContain("setPresenterStepIndex(0)");
    expect(autoAdvanceBody.indexOf("setPresenterStepIndex(0)")).toBeLessThan(
      autoAdvanceBody.indexOf("setCurrentSlideIndex"),
    );
  });

  it("keeps the presenter step on the last slide when no next slide exists", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("const handleNextPresenterStep");
    const end = source.indexOf("const finishRehearsal");
    const handleNextPresenterStepBody = source.slice(start, end);

    expect(handleNextPresenterStepBody).toContain("getNextPresenterStepState");
    expect(handleNextPresenterStepBody).toContain(
      "slideCount: deck.slides.length",
    );
    expect(handleNextPresenterStepBody).toContain(
      "setPresenterStepIndex(nextState.stepIndex)",
    );
    expect(handleNextPresenterStepBody).toContain(
      "setCurrentSlideIndex(nextState.slideIndex)",
    );
  });

  it("moves slides outside of the presenter step state updater", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("const handleNextPresenterStep");
    const end = source.indexOf("const finishRehearsal");
    const handleNextPresenterStepBody = source.slice(start, end);

    expect(handleNextPresenterStepBody).not.toContain(
      "setPresenterStepIndex((currentStep)",
    );
    expect(
      handleNextPresenterStepBody.indexOf(
        "setPresenterStepIndex(nextState.stepIndex)",
      ),
    ).toBeLessThan(handleNextPresenterStepBody.indexOf("setCurrentSlideIndex"));
  });

  it("routes the top timer play button through report recording pause and resume", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("async function handleTimePrimaryAction");
    const end = source.indexOf("function commitElapsedTimeInput");
    const handleTimePrimaryActionBody = source.slice(start, end);

    expect(handleTimePrimaryActionBody).toContain("await startRecording()");
    expect(handleTimePrimaryActionBody).toContain(
      'if (rehearsalRuntimeStatus === "paused")',
    );
    expect(handleTimePrimaryActionBody).toContain(
      "await resumePausedRehearsal()",
    );
    expect(handleTimePrimaryActionBody).toContain(
      "await pauseActiveRehearsal()",
    );
  });

  it("pauses report recording before falling back to standalone Live STT pause", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("function handleSideTimerPrimaryAction");
    const end = source.indexOf("function commitElapsedTimeInput");
    const handleSideTimerPrimaryActionBody = source.slice(start, end);

    expect(handleSideTimerPrimaryActionBody).toContain(
      'if (phase === "recording")',
    );
    expect(handleSideTimerPrimaryActionBody).toContain(
      "pauseActiveRehearsal()",
    );
    expect(handleSideTimerPrimaryActionBody).toContain("if (canStopLiveDemo)");
    expect(handleSideTimerPrimaryActionBody).not.toContain(
      "stopLiveDemo({ showCompletionModal: true })",
    );
    expect(
      handleSideTimerPrimaryActionBody.indexOf('if (phase === "recording")'),
    ).toBeLessThan(
      handleSideTimerPrimaryActionBody.indexOf("if (canStopLiveDemo)"),
    );
  });

  it("녹음 pause 완료 후 STT와 마이크를 멈추고 역순으로 재시작한다", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const pauseStart = source.indexOf("async function pauseActiveRehearsal");
    const resumeStart = source.indexOf("async function resumePausedRehearsal");
    const actionStart = source.indexOf(
      "async function handleTimePrimaryAction",
    );
    const pauseBody = source.slice(pauseStart, resumeStart);
    const resumeBody = source.slice(resumeStart, actionStart);

    expect(pauseBody.indexOf("await sessionRef.current?.pause()")).toBeLessThan(
      pauseBody.indexOf("await p3Session.pause()"),
    );
    expect(pauseBody.indexOf("await p3Session.pause()")).toBeLessThan(
      pauseBody.indexOf('if (pauseResult.status === "paused")'),
    );
    expect(
      pauseBody.indexOf('if (pauseResult.status === "paused")'),
    ).toBeLessThan(pauseBody.indexOf("setMediaStreamTracksEnabled("));
    expect(
      resumeBody.indexOf("setMediaStreamTracksEnabled(stream, true)"),
    ).toBeLessThan(resumeBody.indexOf("await sessionRef.current?.resume()"));
    expect(
      resumeBody.indexOf("await sessionRef.current?.resume()"),
    ).toBeLessThan(resumeBody.indexOf("await p3Session.resume"));
  });

  it("starts report recording from the side timer play button", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("function handleSideTimerPrimaryAction");
    const end = source.indexOf("function commitElapsedTimeInput");
    const handleSideTimerPrimaryActionBody = source.slice(start, end);

    expect(handleSideTimerPrimaryActionBody).toContain("if (canRecord)");
    expect(handleSideTimerPrimaryActionBody).toContain("void startRecording()");
    expect(handleSideTimerPrimaryActionBody).not.toContain(
      "void startLiveDemo()",
    );
  });

  it("creates fallback Live STT ports from the runtime-configured engine", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const defaultStart = source.indexOf("function createDefaultLiveSttPort");
    const defaultEnd = source.indexOf("export function RehearsalWorkspace");
    const createDefaultLiveSttPortBody = source.slice(defaultStart, defaultEnd);
    const start = source.indexOf("function getOrCreateLiveSttPort");
    const end = source.indexOf("async function startP3Tracking");
    const getOrCreateLiveSttPortBody = source.slice(start, end);

    expect(createDefaultLiveSttPortBody).toContain(
      'const shouldUseSherpaCompatibility = !engineId || engineId === "sherpa"',
    );
    expect(createDefaultLiveSttPortBody).toContain(
      "shouldUseSherpaCompatibility && legacyAdapter",
    );
    expect(createDefaultLiveSttPortBody).toContain(
      "return createLiveSttPort(engineId,",
    );
    expect(createDefaultLiveSttPortBody).toContain("projectId");
    expect(getOrCreateLiveSttPortBody).toContain("props.liveSttPort");
    expect(getOrCreateLiveSttPortBody).toContain(
      "cachedPort?.engineId === engineId",
    );
    expect(getOrCreateLiveSttPortBody).toContain(
      'cachedPort.engineId !== "openai-realtime"',
    );
    expect(getOrCreateLiveSttPortBody).toContain("activeProjectId");
    expect(getOrCreateLiveSttPortBody).toContain("cachedPort?.dispose()");
    expect(getOrCreateLiveSttPortBody).toContain("engineId");
    expect(source).toContain("await fetchLiveSttRuntimeConfig()");
    expect(source).toContain("return presenterSettings.sttEngine");
    expect(source).toContain("props.resolveLiveSttEngine()");
    expect(source).toContain("props.createLiveSttPort(engineId)");
  });

  it("routes report recording through the P3 tracking session", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const recordingStart = source.indexOf("async function startRecording");
    const recordingEnd = source.indexOf("async function startLiveDemo");
    const startRecordingBody = source.slice(recordingStart, recordingEnd);
    const stopStart = source.indexOf("function stopRecording");
    const stopEnd = source.indexOf("function handleTimePrimaryAction");
    const stopRecordingBody = source.slice(stopStart, stopEnd);

    expect(startRecordingBody).toContain(
      "const evaluationSnapshot = await prepareEvaluationSnapshot(activeDeck)",
    );
    expect(startRecordingBody).toContain(
      "void startP3Tracking(stream, evaluationSnapshot)",
    );
    expect(
      startRecordingBody.indexOf("prepareEvaluationSnapshot"),
    ).toBeLessThan(startRecordingBody.indexOf("startP3Tracking"));
    expect(startRecordingBody).not.toContain("startLiveStt(stream)");
    expect(stopRecordingBody).toContain(
      "const p3Session = p3SessionRef.current",
    );
    expect(stopRecordingBody).toContain("p3Session");
    expect(stopRecordingBody).toContain(".stop()");
    expect(stopRecordingBody).toContain(".then((meta)");
    expect(stopRecordingBody).toContain(".catch(() => null)");
    expect(stopRecordingBody).toContain("setP3RunMeta(meta)");
  });

  it("reuses prepared slide snapshots when practicing again", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const prepareStart = source.indexOf(
      "async function prepareEvaluationSnapshot",
    );
    const prepareEnd = source.indexOf(
      "function cancelPendingEvaluationRun",
      prepareStart,
    );
    const prepareBody = source.slice(prepareStart, prepareEnd);

    expect(prepareBody).toContain(
      "preparedSlideSnapshotsRef.current ??\n      readPreparedRehearsalSlideSnapshots",
    );
    expect(prepareBody).toContain(
      "preparedSlideSnapshotsRef.current = slideSnapshots",
    );
  });

  it("continues report upload when optional P3 run meta fails", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const stopStart = source.indexOf("function stopRecording");
    const stopEnd = source.indexOf("function handleTimePrimaryAction");
    const stopRecordingBody = source.slice(stopStart, stopEnd);
    const submitStart = source.indexOf("async function submitRecording");
    const submitEnd = source.indexOf(
      "function handleTimePrimaryAction",
      submitStart,
    );
    const submitRecordingBody = source.slice(submitStart, submitEnd);

    expect(stopRecordingBody).toContain(".catch(() => null)");
    expect(submitRecordingBody).toContain("await pendingP3RunMetaRef.current");
    expect(submitRecordingBody).toContain("runRehearsalUploadFlow");
  });

  it("resynchronizes P3 tracking when the slide changes while STT is starting", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const effectStart = source.indexOf(
      "pendingP3SlideIndexRef.current = currentSlideIndex",
    );
    const trackingStart = source.indexOf("async function startP3Tracking");
    const trackingEnd = source.indexOf("function syncP3AdviceState");
    const startP3TrackingBody = source.slice(trackingStart, trackingEnd);

    expect(source.slice(effectStart - 120, effectStart + 120)).toContain(
      'p3State.status === "starting"',
    );
    expect(startP3TrackingBody).toContain(
      "pendingP3SlideIndexRef.current ?? currentSlideIndexRef.current",
    );
    expect(startP3TrackingBody).toContain(
      "session.enterSlide(latestSlideIndex)",
    );
  });

  it("passes live STT bias phrases on slide changes from the shared bias context", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const effectStart = source.indexOf("const nextBiasContext =");
    const effectEnd = source.indexOf(
      "const p3Session = p3SessionRef.current",
      effectStart,
    );
    const slideChangeEffectBody = source.slice(effectStart, effectEnd);
    const compactEffectBody = slideChangeEffectBody.replace(/\s+/g, "");

    expect(compactEffectBody).toContain(
      "voidliveSttPortRef.current?.updateBiasPhrases(",
    );
    expect(compactEffectBody).toContain(
      "getBiasPhrasesFromContext(nextBiasContext)",
    );
    expect(slideChangeEffectBody).toContain("const nextBiasContext =");
    expect(slideChangeEffectBody).toContain(
      "buildLiveSttBiasContext(currentSlide",
    );
    expect(slideChangeEffectBody).toContain("nearbySlides: getNearbySlides");
  });

  it("syncs current P3 advice state into the session log", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("function syncP3AdviceState");
    const end = source.indexOf("function handleLiveSttError");
    const syncP3AdviceStateBody = source.slice(start, end);

    expect(syncP3AdviceStateBody).toContain(
      'p3Session.setAdviceState("slide-overtime", p3AdviceState.slideOvertime)',
    );
    expect(syncP3AdviceStateBody).toContain(
      'p3Session.setAdviceState(\n      "pace-too-fast"',
    );
    expect(syncP3AdviceStateBody).toContain(
      'p3Session.setAdviceState(\n      "pace-too-slow"',
    );
  });

  it("P3 capability event를 bounded 상태 UI로 연결한다", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("session = createP3RehearsalSession");
    const end = source.indexOf("p3SessionRef.current = session", start);
    const sessionBody = source.slice(start, end);

    expect(sessionBody).toContain("onSemanticCapabilityEvent");
    expect(sessionBody).toContain("slice(-100)");
    expect(source).toContain("createSemanticCapabilityStatusItems");
    expect(source).toContain(
      "semanticCapabilityItems={semanticCapabilityItems}",
    );
    expect(source).toContain("capabilityEvents={semanticCapabilityEvents}");
  });

  it("requests microphone audio with live STT input quality constraints", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);

    const result = await requestRehearsalMicrophoneStream({
      getUserMedia,
    } as unknown as Pick<MediaDevices, "getUserMedia">);

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: rehearsalMicrophoneAudioConstraints,
    });
  });

  it("requests raw microphone audio constraints when Live STT raw mic debug is enabled", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === "orbit.liveStt.debugRawMic" ? "1" : null,
        ),
      },
    });
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);

    const result = await requestRehearsalMicrophoneStream({
      getUserMedia,
    } as unknown as Pick<MediaDevices, "getUserMedia">);

    expect(result).toBe(stream);
    expect(getRehearsalMicrophoneAudioConstraints()).toBe(
      rehearsalRawMicrophoneAudioConstraints,
    );
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: rehearsalRawMicrophoneAudioConstraints,
    });
  });

  it("falls back to default microphone constraints when localStorage is blocked", async () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    vi.stubGlobal("window", blockedWindow);
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);

    await expect(
      requestRehearsalMicrophoneStream({
        getUserMedia,
      } as unknown as Pick<MediaDevices, "getUserMedia">),
    ).resolves.toBe(stream);

    expect(getRehearsalMicrophoneAudioConstraints()).toBe(
      rehearsalMicrophoneAudioConstraints,
    );
    expect(getLiveSttDebugDecodingMethod()).toBeNull();
    expect(
      shouldShowLiveSttDebugPcmDownload(
        {
          blob: new Blob([]),
          filename: "orbit-live-stt-model-input.wav",
          sampleRate: 16000,
          durationMs: 1000,
          peak: 0.5,
          rms: 0.2,
        },
        undefined,
      ),
    ).toBe(false);
  });

  it("parses Live STT debug decoding method overrides defensively", () => {
    expect(
      getLiveSttDebugDecodingMethod({
        getItem: vi.fn(() => "modified_beam_search"),
      }),
    ).toBe("modified_beam_search");
    expect(
      getLiveSttDebugDecodingMethod({
        getItem: vi.fn(() => "beam_search"),
      }),
    ).toBeNull();
    expect(
      getLiveSttDebugDecodingMethod({
        getItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
      }),
    ).toBeNull();
  });

  it("shows the model input WAV download only when PCM debug has a recording", () => {
    const recording = {
      blob: new Blob([]),
      filename: "orbit-live-stt-model-input.wav",
      sampleRate: 16000,
      durationMs: 1000,
      peak: 0.5,
      rms: 0.2,
    };

    expect(
      shouldShowLiveSttDebugPcmDownload(recording, {
        getItem: vi.fn((key: string) =>
          key === "orbit.liveStt.debugPcmDump" ? "1" : null,
        ),
      }),
    ).toBe(true);
    expect(
      shouldShowLiveSttDebugPcmDownload(null, {
        getItem: vi.fn(() => "1"),
      }),
    ).toBe(false);
    expect(
      shouldShowLiveSttDebugPcmDownload(recording, {
        getItem: vi.fn(() => null),
      }),
    ).toBe(false);
  });

  it("labels live STT microphone input levels", () => {
    expect(getLiveAudioLevelLabel(null)).toBe("입력 대기");
    expect(getLiveAudioLevelPercent(null)).toBe(0);
    expect(
      getLiveAudioLevelLabel({
        type: "audio-level",
        rms: 0.001,
        peak: 0.01,
        rmsDb: -60,
        peakDb: -40,
        isLikelySilence: true,
      }),
    ).toBe("입력 낮음");
    expect(
      getLiveAudioLevelLabel({
        type: "audio-level",
        rms: 0.08,
        peak: 0.3,
        rmsDb: -22,
        peakDb: -10,
        isLikelySilence: false,
      }),
    ).toBe("입력 적정");
    expect(
      getLiveAudioLevelLabel({
        type: "audio-level",
        rms: 0.5,
        peak: 0.9,
        rmsDb: -6,
        peakDb: -2,
        isLikelySilence: false,
      }),
    ).toBe("입력 과대");
    expect(
      getLiveAudioLevelPercent({
        type: "audio-level",
        rms: 0.08,
        peak: 0.3,
        rmsDb: -22,
        peakDb: -10,
        isLikelySilence: false,
      }),
    ).toBe(60);
  });

  it("keeps final report content out of the presenter workspace", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalWorkspace initialDeck={deck} />,
    );

    expect(html).not.toContain("리허설 보고서");
    expect(html).not.toContain("120 wpm");
    expect(html).not.toContain("민감한 전사 원문");
  });

  it("renders the dedicated report page from official report data", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          transcriptRetained: false,
          transcript: null,
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("1회차 리허설 리포트");
    expect(html).toContain("2026.06.29");
    expect(html).toContain("1분 30초");
    expect(html).toContain(String(deck.slides.length));
    expect(html).toContain("말버릇 총량");
    expect(html).toContain("긴 침묵");
    expect(html).toContain("긴 침묵 구간 분석");
    expect(html).toContain("음");
    expect(html).toContain("2회 · 100%");
    expect(html).toContain("놓친 핵심 메시지");
    expect(html).toContain("문제 신호");
    expect(html).toContain("습관어 2회");
    expect(html).toContain("개선 피드백");
    expect(html).toContain("참고 시간");
    expect(html).toContain("슬라이드별 소요 시간");
    expect(html).toContain("rrd-cumulative-chart");
    expect(html).toContain("1번 슬라이드");
    expect(html).toContain("rrd-timing-slide-option-times");
    expect(html).toContain("소요</small><strong>0분 52초");
    expect(html).toContain("권장</small><strong>1분 00초");
    expect(html).not.toContain("이번 시간");
    expect(html).not.toContain("계속 문제였던 장표");
    expect(html).not.toContain("종합 발표 점수");
    expect(html).not.toContain("/ 100");
    expect(html).not.toContain("속도 안정성");
    expect(html).not.toContain("전체 말버릇 중");
    expect(html).not.toContain("민감한 전사 원문");
    expect(html).not.toContain("dB");
  });

  it("formats filler-word deltas as counts in the summary change list", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={createDemoDeck()}
        prevReports={[
          reportFixture({
            metrics: {
              ...legacyRehearsalReportMetricsDefaults,
              durationSeconds: 90,
              wordsPerMinute: 120,
              fillerWordCount: 0,
              longSilenceCount: 1,
              keywordCoverage: 0.75,
              keywordCoverageMeasurement: { state: "measured" },
            },
          }),
        ]}
        projectId="project-a"
        report={reportFixture({
          metrics: {
            ...legacyRehearsalReportMetricsDefaults,
            durationSeconds: 90,
            wordsPerMinute: 120,
            fillerWordCount: 18,
            longSilenceCount: 1,
            keywordCoverage: 0.75,
            keywordCoverageMeasurement: { state: "measured" },
          },
        })}
        run={runFixture("succeeded")}
        runNumber={2}
        totalRunCount={2}
      />,
    );

    expect(html).toContain("+18회");
    expect(html).not.toContain("18초회");
  });

  it("integrates slide priority sorting into the slide analysis viewer", () => {
    const baseDeck = createDemoDeck();
    const deck = {
      ...baseDeck,
      slides: Array.from({ length: 4 }, (_, index) => {
        const originalSlide = baseDeck.slides[index] ?? baseDeck.slides[0]!;
        return {
          ...originalSlide,
          slideId: `slide_${index + 1}`,
          order: index + 1,
          title: `${originalSlide.title} ${index + 1}`,
        };
      }),
    };
    const [slide1, slide2, slide3, slide4] = deck.slides;
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        prevReports={[
          reportFixture({
            slideTimings: [
              {
                slideId: slide1!.slideId,
                targetSeconds: 60,
                actualSeconds: 35,
              },
              {
                slideId: slide2!.slideId,
                targetSeconds: 60,
                actualSeconds: 66,
              },
              {
                slideId: slide3!.slideId,
                targetSeconds: 60,
                actualSeconds: 68,
              },
              {
                slideId: slide4!.slideId,
                targetSeconds: 60,
                actualSeconds: 72,
              },
            ],
            missedKeywords: [
              {
                slideId: slide2!.slideId,
                keywordId: "prev_kw_2",
                text: "동시 접근",
              },
              {
                slideId: slide3!.slideId,
                keywordId: "prev_kw_3",
                text: "세마포어",
              },
            ],
          }),
        ]}
        projectId="project-a"
        report={reportFixture({
          missedKeywords: [
            { slideId: slide1!.slideId, keywordId: "kw_1", text: "ORBIT" },
            {
              slideId: slide2!.slideId,
              keywordId: "kw_2",
              text: "Race Condition",
            },
          ],
          slideTimings: [
            { slideId: slide1!.slideId, targetSeconds: 60, actualSeconds: 52 },
            { slideId: slide2!.slideId, targetSeconds: 60, actualSeconds: 88 },
            { slideId: slide3!.slideId, targetSeconds: 60, actualSeconds: 43 },
            { slideId: slide4!.slideId, targetSeconds: 60, actualSeconds: 84 },
          ],
          slideInsights: [
            {
              slideId: slide1!.slideId,
              fillerWordCount: 2,
              longSilenceCount: 1,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
            {
              slideId: slide2!.slideId,
              fillerWordCount: 1,
              longSilenceCount: 0,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
            {
              slideId: slide3!.slideId,
              fillerWordCount: 0,
              longSilenceCount: 1,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
            {
              slideId: slide4!.slideId,
              fillerWordCount: 3,
              longSilenceCount: 0,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
          ],
        })}
        run={runFixture("succeeded")}
        runNumber={2}
        totalRunCount={2}
      />,
    );

    expect(html).toContain("슬라이드별 분석");
    expect(html).toContain("우선순위가 높은 장표부터 확인하세요.");
    expect(html).toContain("우선순위순");
    expect(html).toContain(slide1!.title);
    expect(html).toContain("개선 필요");
    expect(html).toContain("놓친 핵심 메시지");
    expect(html).toContain("참고 시간");
  });

  it("renders a report loading shell before report data is ready", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("보고서를 불러오는 중입니다.");
    expect(html).toContain("report-loading-shell");
    expect(html).not.toContain("report-page-state");
  });

  it("renders retained transcript controls without exposing raw text by default", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          transcriptRetained: true,
          transcript: "민감한 전사 원문",
          generatedAt: new Date().toISOString(),
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("발표 전사본");
    expect(html).toContain("DOCX 내려받기");
    expect(html).toContain("펼치기");
    expect(html).not.toContain("민감한 전사 원문");
  });

  it("hides the transcript controls after the 30-minute retention window", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          transcriptRetained: true,
          transcript: "만료된 전사 원문",
          generatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).not.toContain("발표 전사본");
    expect(html).not.toContain("DOCX 내려받기");
    expect(html).not.toContain("만료된 전사 원문");
  });

  it("calculates completion percent from official slide timings", () => {
    const deck = createDemoDeck();
    const completedSlide = deck.slides[0]!;
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          slideTimings: [
            {
              slideId: completedSlide.slideId,
              targetSeconds: 60,
              actualSeconds: 52,
            },
          ],
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("슬라이드별 분석");
    expect(html).toContain("0분 52초");
  });

  it("does not describe an extreme speaking speed as stable", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          metrics: {
            ...legacyRehearsalReportMetricsDefaults,
            durationSeconds: 0,
            wordsPerMinute: 3600,
            fillerWordCount: 0,
            longSilenceCount: null,
            keywordCoverage: 1,
            keywordCoverageMeasurement: { state: "measured" },
          },
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("전체 발표 시간");
    expect(html).not.toContain("3600");
  });

  it("does not infer missing keyword candidates from deck data", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          missedKeywords: [],
          metrics: {
            ...legacyRehearsalReportMetricsDefaults,
            durationSeconds: 90,
            wordsPerMinute: 120,
            fillerWordCount: 0,
            longSilenceCount: null,
            keywordCoverage: 1,
            keywordCoverageMeasurement: { state: "measured" },
          },
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).not.toContain(
      "핵심 키워드 커버리지가 낮을 때만 누락 후보를 표시합니다.",
    );
  });

  it("groups official missing keywords by slide in a single row", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          missedKeywords: [
            {
              slideId: deck.slides[0]!.slideId,
              keywordId: "kw_component",
              text: "컴포넌트",
            },
            {
              slideId: deck.slides[0]!.slideId,
              keywordId: "kw_design",
              text: "설계",
            },
            {
              slideId: deck.slides[0]!.slideId,
              keywordId: "kw_state",
              text: "상태관리",
            },
          ],
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("컴포넌트");
    expect(html).toContain("설계");
    expect(html).toContain("상태관리");
  });

  it("renders a dense official missing keyword list without dropping entries", () => {
    const missedKeywords = Array.from({ length: 24 }, (_, index) => ({
      slideId: `slide_${(index % 3) + 1}`,
      keywordId: `kw_dense_${index}`,
      text: `매우긴누락키워드${index}발표흐름핵심데이터`,
    }));
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({ missedKeywords })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("매우긴누락키워드0발표흐름핵심데이터");
    expect(html).toContain("매우긴누락키워드21발표흐름핵심데이터");
    expect(html).toContain("놓친 핵심 메시지");
  });

  it("maps failed and mismatched report responses to failed page state", () => {
    expect(
      resolveRehearsalReportLoadState(
        {
          run: runFixture("failed", {
            error: { code: "REPORT_FAILED", message: "분석 실패" },
          }),
          report: null,
        },
        "project-a",
      ),
    ).toEqual({
      error: "분석 실패",
      status: "failed",
    });

    expect(
      resolveRehearsalReportLoadState(
        {
          run: runFixture("succeeded", { projectId: "project-b" }),
          report: reportFixture(),
        },
        "project-a",
      ),
    ).toEqual({
      error: "요청한 프로젝트와 리허설 실행 정보가 일치하지 않습니다.",
      status: "failed",
    });
  });

  it("loads practice goals for succeeded runs even when the report body is unavailable", () => {
    expect(shouldLoadPracticeGoalSummary(runFixture("succeeded"))).toBe(true);
    expect(shouldLoadPracticeGoalSummary(runFixture("failed"))).toBe(false);
    expect(shouldLoadPracticeGoalSummary(null)).toBe(false);
  });

  it("stops report progress when a succeeded run has no report job or body", () => {
    expect(
      resolveRehearsalReportLoadState(
        {
          run: runFixture("succeeded", { jobId: null }),
          report: null,
        },
        "project-a",
      ),
    ).toEqual({
      error: "",
      status: "unavailable",
    });
  });

  it("builds the dedicated report route for a completed rehearsal run", () => {
    expect(getRehearsalReportPath("project a", "run/1")).toBe(
      "/rehearsal/project%20a/report/run%2F1",
    );
  });

  it("opens the report only from finish when the run has succeeded", () => {
    expect(getRehearsalFinishPath("project-a", null)).toBe(
      "/project/project-a",
    );
    expect(getRehearsalFinishPath("project-a", runFixture("processing"))).toBe(
      "/rehearsal/project-a/report/run-1",
    );
    expect(getRehearsalFinishPath("project-a", runFixture("succeeded"))).toBe(
      "/rehearsal/project-a/report/run-1",
    );
  });

  it("falls back to slide labels when a thumbnail image has failed to load", () => {
    const failedThumbnailUrls = new Set(["/files/thumbnails/slide_1.png"]);

    expect(
      shouldRenderRehearsalThumbnailImage(
        "/files/thumbnails/slide_1.png",
        failedThumbnailUrls,
      ),
    ).toBe(false);
    expect(
      shouldRenderRehearsalThumbnailImage(
        "/files/thumbnails/slide_2.png",
        failedThumbnailUrls,
      ),
    ).toBe(true);
    expect(shouldRenderRehearsalThumbnailImage("", failedThumbnailUrls)).toBe(
      false,
    );
  });

  it("resets total and current-slide timer state together", () => {
    const setElapsedSeconds = vi.fn();
    const setSlideElapsedSeconds = vi.fn();
    const setIsTimerRunning = vi.fn();

    resetRehearsalTimerState({
      setElapsedSeconds,
      setSlideElapsedSeconds,
      setIsTimerRunning,
    });

    expect(setElapsedSeconds).toHaveBeenCalledWith(0);
    expect(setSlideElapsedSeconds).toHaveBeenCalledWith(0);
    expect(setIsTimerRunning).toHaveBeenCalledWith(false);
  });

  it("fills expected-time progress and applies the five-second warning window", () => {
    expect(getRehearsalTimingProgress(44, 50)).toEqual({
      percent: 88,
      tone: "default",
    });
    expect(getRehearsalTimingProgress(45, 50)).toEqual({
      percent: 90,
      tone: "warning",
    });
    expect(getRehearsalTimingProgress(55, 50)).toEqual({
      percent: 100,
      tone: "warning",
    });
    expect(getRehearsalTimingProgress(56, 50)).toEqual({
      percent: 100,
      tone: "danger",
    });
  });

  it("matches live STT keywords with normalized Korean aliases", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_1",
          text: "ORBIT",
          synonyms: ["오르빗"],
          abbreviations: [],
          required: true,
        },
        {
          keywordId: "kw_2",
          text: "Live STT",
          synonyms: ["실시간 음성 인식"],
          abbreviations: ["stt"],
          required: true,
        },
      ],
    };

    const analysis = evaluateLiveTranscript(
      slide,
      "오늘은 오르빗 실시간음성인식 흐름을 확인합니다",
    );

    expect(normalizeLiveTranscriptText("실시간 음성 인식")).toBe(
      "실시간음성인식",
    );
    expect(analysis.coverage).toBe(1);
    expect(
      analysis.detectedKeywords.map((keyword) => keyword.keywordId),
    ).toEqual(["kw_1", "kw_2"]);
    expect(analysis.missingKeywordIds).toEqual([]);
  });

  it("matches generated Korean pronunciations and exposes them to live STT bias", () => {
    const deck = createDemoDeck();
    deck.slides[0]!.speakerNotes = "OpenAI API를 활용했습니다.";
    deck.slides[0]!.keywords = [
      {
        keywordId: "kw_openai",
        text: "OpenAI",
        synonyms: [],
        abbreviations: [],
        required: true,
      },
      {
        keywordId: "kw_api",
        text: "API",
        synonyms: [],
        abbreviations: [],
        required: true,
      },
    ];
    const snapshot = createRehearsalEvaluationSnapshot(deck);
    const lexicon = snapshot.pronunciationLexicon;

    const analysis = evaluateLiveTranscript(
      deck.slides[0]!,
      "오픈 에이아이 에이피아이를 활용했습니다.",
      lexicon,
    );
    const biasContext = buildLiveSttBiasContext(deck.slides[0]!, {
      pronunciationLexicon: lexicon,
    });
    const sessionSlide = buildP3SessionSlides(deck, snapshot)[0];

    expect(analysis.coverage).toBe(1);
    expect(
      analysis.detectedKeywords.map((keyword) => keyword.matchedText),
    ).toEqual(["오픈 에이아이", "에이피아이"]);
    expect(biasContext.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "오픈에이아이",
          source: "pronunciation-alias",
        }),
        expect.objectContaining({
          text: "에이피아이",
          source: "pronunciation-alias",
        }),
      ]),
    );
    expect(
      sessionSlide?.pronunciationEntries?.map((entry) => entry.canonicalKey),
    ).toEqual(["openai", "api"]);
  });

  it("builds current-slide live STT bias terms from keywords and slide context", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      slideId: "slide_1",
      title: "ORBIT Live STT",
      speakerNotes: "오프닝, 브라우저 온디바이스 인식",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "ORBIT",
          synonyms: ["오르빗"],
          abbreviations: ["OBT"],
          required: true,
        },
      ],
      elements: [
        ...deck.slides[0]!.elements,
        {
          elementId: "el_body",
          type: "text" as const,
          role: "body" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            text: "온디바이스 STT와 키워드 진행률",
            fontSize: 24,
            fontWeight: 400,
            align: "left" as const,
            verticalAlign: "top" as const,
            lineHeight: 1.2,
          },
        },
      ],
    };

    const nearbySlide = {
      ...deck.slides[1]!,
      slideId: "slide_nearby",
      title: "다음 장표 요약",
      elements: [
        {
          elementId: "el_nearby",
          type: "text" as const,
          role: "body" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            text: "후속 액션 플랜",
            fontSize: 24,
            fontWeight: 400,
            align: "left" as const,
            verticalAlign: "top" as const,
            lineHeight: 1.2,
          },
        },
      ],
    };

    const biasContext = buildLiveSttBiasContext(slide, {
      nearbySlides: [nearbySlide],
    });

    expect(biasContext.slideId).toBe("slide_1");
    expect(biasContext.terms.slice(0, 3).map((term) => term.text)).toEqual([
      "ORBIT",
      "오르빗",
      "OBT",
    ]);
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "ORBIT Live STT",
        source: "title",
      }),
    );
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "브라우저 온디바이스 인식",
        source: "speaker-notes",
      }),
    );
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "다음 슬라이드",
        source: "control-phrase",
      }),
    );
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "후속 액션 플랜",
        source: "nearby-slide-text",
      }),
    );
  });

  it("uses fuzzy live STT bias only for keyword matching transcripts", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "오르빗",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
    };
    const biasContext = buildLiveSttBiasContext(slide);
    const rawTranscript = "오늘은 오르비트 리허설을 시작합니다";
    const rawAnalysis = evaluateLiveTranscript(slide, rawTranscript);
    const biasedTranscript = applyLiveTranscriptBias(
      rawTranscript,
      biasContext,
    );
    const biasedAnalysis = evaluateLiveTranscript(slide, biasedTranscript);

    expect(rawAnalysis.coverage).toBe(0);
    expect(biasedTranscript).toBe(`${rawTranscript} 오르빗`);
    expect(biasedAnalysis.coverage).toBe(1);
  });

  it("does not fuzzy-correct Korean prefix-only keyword fragments into coverage", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "오르빗",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
    };
    const biasContext = buildLiveSttBiasContext(slide);

    for (const rawTranscript of [
      "오늘은 오르 리허설을 시작합니다",
      "오늘은 오르비 리허설을 시작합니다",
    ]) {
      const biasedTranscript = applyLiveTranscriptBias(
        rawTranscript,
        biasContext,
      );
      const biasedAnalysis = evaluateLiveTranscript(slide, biasedTranscript);

      expect(biasedTranscript).toBe(rawTranscript);
      expect(biasedAnalysis.coverage).toBe(0);
    }
  });

  it("does not fuzzy-correct short ascii abbreviations into coverage", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_stt",
          text: "음성 인식",
          synonyms: [],
          abbreviations: ["STT"],
          required: true,
        },
      ],
    };
    const biasContext = buildLiveSttBiasContext(slide);
    const rawTranscript = "오늘은 start 단계를 진행합니다";
    const biasedTranscript = applyLiveTranscriptBias(
      rawTranscript,
      biasContext,
    );
    const biasedAnalysis = evaluateLiveTranscript(slide, biasedTranscript);

    expect(biasedTranscript).toBe(rawTranscript);
    expect(biasedAnalysis.coverage).toBe(0);
  });

  it("reserves control-phrase slots when keyword aliases exceed the cap", () => {
    const keywords = Array.from({ length: 12 }, (_, index) => ({
      keywordId: `kw_${index}`,
      text: `키워드${index}`,
      synonyms: [`동의어${index}`],
      abbreviations: [`약어${index}`],
      required: true,
    }));
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_dense",
      keywords,
    };
    const biasContext = buildLiveSttBiasContext(slide);

    expect(biasContext.terms.length).toBeLessThanOrEqual(32);
    expect(
      biasContext.terms.some((term) => term.source === "control-phrase"),
    ).toBe(true);
  });

  it("resolves slide thumbnails to same-origin asset URLs", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:5173",
      },
    });

    expect(
      resolveEditorAssetUrl("/api/v1/projects/p1/assets/file_1/content"),
    ).toBe("http://localhost:5173/api/v1/projects/p1/assets/file_1/content");
    expect(
      resolveEditorAssetUrl(
        "http://localhost:9000/orbit-local/projects/project_real_1/assets/file_real_1/slide_1.png",
      ),
    ).toBe(
      "http://localhost:5173/api/v1/projects/project_real_1/assets/file_real_1/content",
    );
    expect(resolveEditorAssetUrl("https://cdn.example.com/thumb.png")).toBe(
      "https://cdn.example.com/thumb.png",
    );
  });

  it("composes committed live STT finals with the current draft", () => {
    let buffer = createLiveTranscriptBuffer();

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오늘은",
      isFinal: false,
    });
    expect(renderLiveTranscriptBuffer(buffer)).toBe("오늘은");

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오늘은",
      isFinal: true,
    });
    expect(renderLiveTranscriptBuffer(buffer)).toBe("오늘은");

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오르빗",
      isFinal: false,
    });

    expect(renderLiveTranscriptBuffer(buffer)).toBe("오늘은 오르빗");
    expect(renderLiveTranscriptBuffer(buffer)).not.toContain("오늘은 오늘은");
  });

  it("evaluates keywords across multiple committed live STT utterances", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_1",
          text: "ORBIT",
          synonyms: ["오르빗"],
          abbreviations: [],
          required: true,
        },
        {
          keywordId: "kw_2",
          text: "Live STT",
          synonyms: ["실시간 음성 인식"],
          abbreviations: ["stt"],
          required: true,
        },
      ],
    };
    let buffer = createLiveTranscriptBuffer();

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오늘은 오르빗을 소개합니다",
      isFinal: true,
    });
    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "실시간 음성 인식 흐름입니다",
      isFinal: true,
    });

    const transcript = renderLiveTranscriptBuffer(buffer);
    const analysis = evaluateLiveTranscript(slide, transcript);

    expect(transcript).toBe(
      "오늘은 오르빗을 소개합니다 실시간 음성 인식 흐름입니다",
    );
    expect(analysis.coverage).toBe(1);
    expect(
      analysis.detectedKeywords.map((keyword) => keyword.keywordId),
    ).toEqual(["kw_1", "kw_2"]);
  });

  it("starts a fresh live STT transcript buffer after reset", () => {
    let buffer = createLiveTranscriptBuffer();
    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "이전 슬라이드 오르빗",
      isFinal: true,
    });

    buffer = createLiveTranscriptBuffer();
    expect(renderLiveTranscriptBuffer(buffer)).toBe("");

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "새 슬라이드",
      isFinal: false,
    });
    expect(renderLiveTranscriptBuffer(buffer)).toBe("새 슬라이드");
  });

  it("keeps the current prompter sentence when coaching coverage comes from a partial transcript", () => {
    const rows = getRehearsalPrompterRows(
      [
        {
          sentenceId: "sentence_1",
          text: "첫 문장은 아직 끝까지 읽지 않았습니다.",
          index: 0,
          isFinalTrigger: false,
          matchable: true,
          candidates: [],
        },
        {
          sentenceId: "sentence_2",
          text: "다음 문장입니다.",
          index: 1,
          isFinalTrigger: true,
          matchable: true,
          candidates: [],
        },
      ],
      ["sentence_1"],
      "",
      {
        slideId: "slide_1",
        revision: 0,
        phase: "candidate",
        currentSentenceId: "sentence_1",
        candidateSentenceId: "sentence_1",
        candidateSinceMs: 1_000,
        committedSentenceIds: [],
        lastCommittedSentenceId: null,
        lastCommitSource: null,
        finalSentenceCommitted: false,
      },
    );

    expect(rows.current).toBe("첫 문장은 아직 끝까지 읽지 않았습니다.");
    expect(rows.previous).toBe("");
    expect(rows.next).toBe("다음 문장입니다.");
  });

  it("moves the prompter after the current sentence is committed", () => {
    const rows = getRehearsalPrompterRows(
      [
        {
          sentenceId: "sentence_1",
          text: "첫 문장입니다.",
          index: 0,
          isFinalTrigger: false,
          matchable: true,
          candidates: [],
        },
        {
          sentenceId: "sentence_2",
          text: "다음 문장입니다.",
          index: 1,
          isFinalTrigger: true,
          matchable: true,
          candidates: [],
        },
      ],
      [],
      "",
      {
        slideId: "slide_1",
        revision: 1,
        phase: "tracking",
        currentSentenceId: "sentence_2",
        candidateSentenceId: null,
        candidateSinceMs: null,
        committedSentenceIds: ["sentence_1"],
        lastCommittedSentenceId: "sentence_1",
        lastCommitSource: "lexical",
        finalSentenceCommitted: false,
      },
    );

    expect(rows.current).toBe("다음 문장입니다.");
    expect(rows.previous).toBe("첫 문장입니다.");
    expect(rows.next).toBe("");
  });

  it("recenters the lower prompter only when its focused sentence changes", () => {
    expect(
      getRehearsalTeleprompterScrollBehavior(undefined, "sentence_1"),
    ).toBe("auto");
    expect(
      getRehearsalTeleprompterScrollBehavior("sentence_1", "sentence_1"),
    ).toBeNull();
    expect(
      getRehearsalTeleprompterScrollBehavior("sentence_1", "sentence_2"),
    ).toBe("smooth");
    expect(
      getRehearsalTeleprompterScrollBehavior(
        "slide_1:sentence_1",
        "slide_2:sentence_1",
      ),
    ).toBe("smooth");
    expect(
      getRehearsalTeleprompterScrollBehavior("sentence_2", null),
    ).toBeNull();
  });

  it("returns current prompter sentence as a single sentence block", () => {
    const rows = getRehearsalPrompterRows(
      [
        {
          sentenceId: "sentence_1",
          text: "첫 문장입니다.",
          index: 0,
          isFinalTrigger: false,
          matchable: true,
          candidates: [],
        },
        {
          sentenceId: "sentence_2",
          text: "두 번째 문장입니다.",
          index: 1,
          isFinalTrigger: true,
          matchable: true,
          candidates: [],
        },
      ],
      [],
      "",
    );

    expect(rows).toMatchObject({
      previous: "",
      current: "첫 문장입니다.",
      next: "두 번째 문장입니다.",
      focusSentenceId: "sentence_1",
      items: [
        expect.objectContaining({
          sentenceId: "sentence_1",
          status: "current",
        }),
        expect.objectContaining({
          sentenceId: "sentence_2",
          status: "next",
        }),
      ],
    });
  });

  it("uses E5 script alignment in rehearsal while keeping the NLI runtime out of the live path", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");

    expect(source).toContain("const ENABLE_REHEARSAL_NLI = false");
    expect(source).toContain("showScriptPanel={true}");
    expect(source).toContain(
      'import.meta.env.MODE === "test" || !ENABLE_REHEARSAL_NLI',
    );
  });

  it("delegates auto-advance policy to the P4 controller instead of keyword coverage timers", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("function handleLivePartialTranscript");
    const end = source.indexOf("function resetLiveTranscriptForSlide");
    const handlerBody = source.slice(start, end);

    expect(handlerBody).not.toContain("shouldAutoAdvanceLiveSlide");
    expect(handlerBody).not.toContain("scheduleAutoAdvance");
    expect(source).toContain("evaluateAdvanceController");
    expect(source).toContain("remainingTriggerSteps");
  });

  it("derives production trigger animations from slide actions", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");

    expect(source).toContain("const triggerAnimationIds = useMemo(");
    expect(source).toContain(
      "() => (currentSlide ? getTriggerAnimationIdsForSlide(currentSlide) : [])",
    );
    expect(source).toContain("import {");
    expect(source).toContain("getTriggerAnimationIdsForSlide,");
  });

  it("computes remaining trigger steps when P4 fixtures inject cue-referenced animations", () => {
    const slide = p0AnimationDeck.slides[0]!;
    const triggerAnimationIds = [
      "anim_image_zoom_in",
      "anim_group_fade_out",
      "anim_chart_zoom_out",
    ];

    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 0,
        triggerAnimationIds: [],
      }),
    ).toBe(0);
    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 0,
        triggerAnimationIds,
      }),
    ).toBe(2);
    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 1,
        triggerAnimationIds,
      }),
    ).toBe(1);
    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 2,
        triggerAnimationIds,
      }),
    ).toBe(0);
  });

  it("proves P4 auto-advance gates with fixture speech, pause, and build steps", () => {
    const slide = p0AnimationDeck.slides[0]!;
    const triggerAnimationIds = [
      "anim_image_zoom_in",
      "anim_group_fade_out",
      "anim_chart_zoom_out",
    ];
    const pauseDetector = createPauseDetector({
      config: { silenceThresholdDb: -55 },
      pauseMs: defaultAutoAdvancePolicy.pauseMs,
    });
    pauseDetector.accept({ type: "audio-level", atMs: 0, rmsDb: -60 });
    pauseDetector.accept({ type: "tick", atMs: 700 });
    const pause = pauseDetector.snapshot(700);

    const premature = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 1,
        finalSentenceCommitted: false,
        finalSentenceCommittedAtMs: null,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: 0,
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(premature.commands).toEqual([]);
    expect(premature.state.status).toBe("tracking");

    const blocked = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 0.7,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: getRemainingTriggerStepsForSlide({
          slide,
          stepIndex: 0,
          triggerAnimationIds,
        }),
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(blocked.commands).toContainEqual({
      type: "show-builds-remaining",
      remainingTriggerSteps: 2,
    });
    expect(blocked.commands).not.toContainEqual({
      type: "advance-slide",
      slideId: slide.slideId,
    });
    expect(
      getNextPresenterStepState({
        currentSlideIndex: 0,
        currentStepIndex: 0,
        maxStepIndex: 2,
        slideCount: p0AnimationDeck.slides.length,
      }),
    ).toMatchObject({ slideIndex: 0, stepIndex: 1 });

    const countdown = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 0.7,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: getRemainingTriggerStepsForSlide({
          slide,
          stepIndex: 2,
          triggerAnimationIds,
        }),
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );
    const advanced = evaluateAdvanceController(
      countdown.state,
      {
        effectiveCoverage: 0.7,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 2700,
        pause: { isPaused: true, silenceDurationMs: 2700 },
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: 0,
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(countdown.state.status).toBe("countdown");
    expect(advanced.commands).toEqual([
      { type: "advance-slide", slideId: slide.slideId },
    ]);
    expect(
      evaluateAdvanceController(
        countdown.state,
        {
          effectiveCoverage: 0.7,
          finalSentenceCommitted: true,
          finalSentenceCommittedAtMs: 100,
          finalSentenceSpoken: true,
          finalSentenceSpokenAtMs: 100,
          isLastSlide: false,
          mode: "rehearsal",
          nowMs: 900,
          pause: { isPaused: false, silenceDurationMs: 0 },
          policy: defaultAutoAdvancePolicy,
          remainingTriggerSteps: 0,
          slideId: slide.slideId,
        },
        defaultAutoAdvanceConfig,
      ).commands,
    ).toEqual([{ type: "cancel-countdown", reason: "speech-resumed" }]);
    expect(cancelAdvanceCountdown(countdown.state, "manual").state.status).toBe(
      "tracking",
    );

    const finalSlide = p0AnimationDeck.slides[1]!;
    const finish = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 1,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: true,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: 0,
        slideId: finalSlide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(finish.commands).toEqual([
      { type: "suggest-finish", slideId: finalSlide.slideId },
    ]);
    expect(finish.state.status).toBe("finish-suggested");
  });

  it("treats spoken advance commands as manual overrides", () => {
    const state = createRehearsalCommandConfirmationState();
    const confirmedCommand = confirmRehearsalCommandCandidate(
      state,
      detectRehearsalCommandCandidate({
        transcript: "다음 슬라이드",
        isFinal: true,
        confidence: null,
      }),
    );

    expect(confirmedCommand).toMatchObject({ action: "advance-slide" });
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf(
      "if (isAdvanceSlideCommand(confirmedCommand))",
    );
    const commandBody = source.slice(start, start + 180);

    expect(commandBody).toContain("cancelAutoAdvanceForManualCommand()");
    expect(commandBody).toContain("goNext()");
    expect(
      detectRehearsalCommandCandidate({
        transcript: "안녕하세요. 다음 슬라이드는.",
        isFinal: true,
        confidence: null,
      }),
    ).toBeNull();
  });

  it("keeps the sherpa adapter as an explicit unavailable shell", async () => {
    await expect(
      new SherpaLiveSttAdapter().start(
        { getTracks: () => [] } as unknown as MediaStream,
        {
          onPartialTranscript: () => undefined,
          onError: () => undefined,
        },
      ),
    ).rejects.toMatchObject({
      code: "LIVE_STT_MODEL_UNAVAILABLE",
    } satisfies Partial<LiveSttAdapterError>);
  });

  it("records audio through a MediaRecorder-compatible session", async () => {
    const stoppedFiles: File[] = [];
    const errors: Error[] = [];
    const session = createRecordingSession(
      { getTracks: () => [] } as unknown as MediaStream,
      {
        recorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
        now: () => new Date("2026-06-29T00:00:00.000Z"),
        onStop: (file) => stoppedFiles.push(file),
        onError: (error) => errors.push(error),
      },
    );

    session.start();
    expect(session.recorder.state).toBe("recording");

    await session.pause();
    expect(session.recorder.state).toBe("paused");

    await session.pause();
    expect(session.recorder.state).toBe("paused");

    await session.resume();
    expect(session.recorder.state).toBe("recording");

    await session.resume();
    expect(session.recorder.state).toBe("recording");

    session.stop();
    expect(errors).toEqual([]);
    expect(stoppedFiles).toHaveLength(1);
    expect(stoppedFiles[0]?.name).toBe(
      "rehearsal-2026-06-29T00-00-00-000Z.webm",
    );
    expect(stoppedFiles[0]?.type).toBe("audio/webm");
  });

  it("pauses recording before speech and settles in paused state", async () => {
    const order: string[] = [];

    const result = await runRehearsalPauseSequence({
      pauseRecording: async () => {
        order.push("recording");
      },
      pauseSpeech: async () => {
        order.push("speech");
      },
    });

    expect(order).toEqual(["recording", "speech"]);
    expect(result).toEqual({ error: null, status: "paused" });
  });

  it("restores running state when recorder pause fails", async () => {
    const pauseSpeech = vi.fn(async () => undefined);
    const failure = new Error("recorder pause failed");

    const result = await runRehearsalPauseSequence({
      pauseRecording: async () => {
        throw failure;
      },
      pauseSpeech,
    });

    expect(pauseSpeech).not.toHaveBeenCalled();
    expect(result).toEqual({ error: failure, status: "running" });
  });

  it("keeps paused state when speech stop fails after recording pause", async () => {
    const failure = new Error("speech stop failed");

    const result = await runRehearsalPauseSequence({
      pauseRecording: async () => undefined,
      pauseSpeech: async () => {
        throw failure;
      },
    });

    expect(result).toEqual({ error: failure, status: "paused" });
  });

  it("keeps live rehearsal paused when speech stop fails", async () => {
    const failure = new Error("speech stop failed");

    const result = await runRehearsalPauseSequence({
      pauseSpeech: async () => {
        throw failure;
      },
    });

    expect(result).toEqual({ error: failure, status: "paused" });
  });

  it("비활성화한 live 오디오 트랙을 재사용하고 다시 활성화한다", () => {
    const track = { enabled: true, readyState: "live" } as MediaStreamTrack;
    const stream = {
      active: true,
      getAudioTracks: () => [track],
    } as unknown as MediaStream;

    setMediaStreamTracksEnabled(stream, false);
    expect(track.enabled).toBe(false);
    expect(isReusableRehearsalMediaStream(stream)).toBe(true);

    setMediaStreamTracksEnabled(stream, true);
    expect(track.enabled).toBe(true);
  });

  it("selects the first supported recording MIME type", () => {
    const recorderCtor = {
      isTypeSupported: vi.fn((mimeType: string) => mimeType === "audio/mp4"),
    } as unknown as typeof MediaRecorder;

    expect(selectRecordingMimeType(recorderCtor)).toBe("audio/mp4");
  });

  it("does not select unsupported OpenAI report STT MIME fallbacks", () => {
    const recorderCtor = {
      isTypeSupported: vi.fn((mimeType: string) => mimeType === "audio/ogg"),
    } as unknown as typeof MediaRecorder;

    expect(selectRecordingMimeType(recorderCtor)).toBe("audio/webm");
  });

  it("normalizes recorder codec MIME types before upload", () => {
    const file = createRecordingFile(
      new Blob(["audio"], { type: "audio/webm;codecs=opus" }),
      "audio/webm;codecs=opus",
      new Date("2026-06-29T00:00:00.000Z"),
    );

    expect(normalizeRecordingMimeType("audio/webm;codecs=opus")).toBe(
      "audio/webm",
    );
    expect(file.type).toBe("audio/webm");
    expect(file.name).toBe("rehearsal-2026-06-29T00-00-00-000Z.webm");
  });

  it("persists a fallback demo deck when rehearsal entry has no stored deck", async () => {
    const fallbackDeck = createDemoDeck();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        if (!init) {
          return new Response("missing", { status: 404 });
        }

        return jsonResponse({
          projectId: fallbackDeck.projectId,
          deck: fallbackDeck,
          updatedAt: createdAt,
          snapshot: null,
        });
      },
    );

    const deck = await fetchOrCreateRehearsalDeck({
      fallbackDeck,
      fetcher,
    });

    expect(deck.deckId).toBe(fallbackDeck.deckId);
    expect(calls.map((call) => call.url)).toEqual([
      `/api/v1/projects/${fallbackDeck.projectId}/deck`,
      `/api/v1/projects/${fallbackDeck.projectId}/deck`,
    ]);
    expect(calls[1]?.init).toMatchObject({
      method: "PUT",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      deck: fallbackDeck,
      snapshotReason: "deck-replaced",
    });
  });

  it("uses the fallback demo deck when rehearsal deck fetch is unauthorized", async () => {
    const fallbackDeck = createDemoDeck();
    const fetcher = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    );

    const deck = await fetchOrCreateRehearsalDeck({
      fallbackDeck,
      fetcher,
    });

    expect(deck.deckId).toBe(fallbackDeck.deckId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/projects/${fallbackDeck.projectId}/deck`,
    );
  });
});

describe("rehearsal evaluation run lifecycle", () => {
  it("creates a full run with the client deck version before tracking", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        run: runFixture("created", {
          deckVersion: 3,
          evaluationSnapshot:
            createRehearsalEvaluationSnapshot(createDemoDeck()),
        }),
      }),
    );

    await createRehearsalRun("project-a", "deck-a", fetcher, {
      expectedDeckVersion: 3,
      semanticEvaluationMode: "full",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project-a/rehearsals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          deckId: "deck-a",
          expectedDeckVersion: 3,
          semanticEvaluationMode: "full",
        }),
      }),
    );
  });

  it("passes prepared slide snapshot file IDs to run creation", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ run: runFixture("created") }),
    );

    await createRehearsalRun("project-a", "deck-a", fetcher, {
      slideSnapshots: [{ slideId: "slide_1", fileId: "file-slide-1" }],
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project-a/rehearsals",
      expect.objectContaining({
        body: JSON.stringify({
          deckId: "deck-a",
          slideSnapshots: [{ slideId: "slide_1", fileId: "file-slide-1" }],
        }),
      }),
    );
  });

  it("cancels a run that exits before upload processing", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ run: runFixture("cancelled") }),
    );

    const run = await cancelRehearsalRun("run-1", fetcher);

    expect(run.status).toBe("cancelled");
    expect(fetcher).toHaveBeenCalledWith("/api/v1/rehearsals/run-1/cancel", {
      method: "POST",
    });
  });

  it("creates a delivery-only run after an offline rehearsal deck version mismatch", async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1) {
          return new Response("deck version mismatch", { status: 409 });
        }
        return jsonResponse({
          run: runFixture("created", {
            semanticEvaluationMode: "delivery-only",
            deckVersion: null,
            evaluationSnapshot: null,
          }),
        });
      },
    );

    const result = await createRehearsalRunForUpload(
      "project-a",
      "deck-a",
      3,
      fetcher,
    );

    expect(result).toMatchObject({
      evaluationSnapshotMismatch: true,
      run: { semanticEvaluationMode: "delivery-only" },
    });
    expect(bodies).toEqual([
      {
        deckId: "deck-a",
        expectedDeckVersion: 3,
        semanticEvaluationMode: "full",
      },
      {
        deckId: "deck-a",
        expectedDeckVersion: 3,
        semanticEvaluationMode: "delivery-only",
      },
    ]);
  });

  it("continues with a provisional snapshot when initial server run creation is offline", async () => {
    const deck = createDemoDeck();
    const result = await prepareRehearsalEvaluationRun(
      deck,
      vi.fn(async () => {
        throw new TypeError("network offline");
      }),
    );

    expect(result.run).toBeNull();
    expect(result.evaluationSnapshot).toMatchObject({
      deckId: deck.deckId,
      deckVersion: deck.version,
    });
    expect(result.serverEvaluation).toEqual({
      state: "unavailable",
      reason: "network_error",
    });
  });

  it("builds P3 cue and keyword inputs from the immutable snapshot", () => {
    const deck = createDemoDeck();
    deck.slides[0]!.speakerNotes = "현재 로컬 발표자 노트";
    deck.slides[0]!.keywords = [
      {
        keywordId: "kw_snapshot",
        text: "SNAPSHOT",
        synonyms: ["고정 키워드"],
        abbreviations: [],
        required: true,
      },
    ];
    const snapshot = createRehearsalEvaluationSnapshot(deck);
    deck.slides[0]!.keywords[0]!.text = "LIVE EDIT";

    const slides = buildP3SessionSlides(deck, snapshot);

    expect(slides[0]?.keywords[0]?.text).toBe("SNAPSHOT");
    expect(slides[0]?.speakerNotes).toBe("현재 로컬 발표자 노트");
  });
});

describe("runRehearsalUploadFlow", () => {
  it("reuses the pre-created run while uploading, completing, and polling", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        if (url === "/api/v1/rehearsals/run-1/audio/upload-url") {
          return jsonResponse({
            run: runFixture("uploading", { audioFileId: "file-audio" }),
            upload: {
              fileId: "file-audio",
              projectId: "project-a",
              uploadUrl: "http://storage.local/rehearsal.webm",
              method: "PUT",
              headers: { "content-type": "audio/webm" },
              expiresAt: "2026-06-29T00:15:00.000Z",
              purpose: "rehearsal-audio",
            },
          });
        }

        if (url === "http://storage.local/rehearsal.webm") {
          return new Response(null, { status: 200 });
        }

        if (url === "/api/v1/rehearsals/run-1/meta") {
          return jsonResponse({ run: runFixture("uploading") });
        }

        if (url === "/api/v1/rehearsals/run-1/audio/complete") {
          return jsonResponse({
            run: runFixture("processing", {
              audioFileId: "file-audio",
              jobId: "job-1",
            }),
            job: jobFixture("queued", 0),
          });
        }

        if (url === "/api/jobs/job-1") {
          const count = calls.filter(
            (call) => call.url === "/api/jobs/job-1",
          ).length;
          return jsonResponse(
            count === 1
              ? jobFixture("running", 40)
              : jobFixture("succeeded", 100),
          );
        }

        if (url === "/api/v1/rehearsals/run-1") {
          return jsonResponse({
            run: runFixture("succeeded", {
              audioFileId: "file-audio",
              jobId: "job-1",
              rawAudioDeletedAt: "2026-06-29T00:00:10.000Z",
            }),
          });
        }

        return new Response("unexpected", { status: 500 });
      },
    );
    const audioFile = new File(["audio"], "rehearsal.webm", {
      type: "audio/webm",
    });

    const result = await runRehearsalUploadFlow({
      runId: "run-1",
      audioFile,
      slideTimeline: [
        { slideId: "slide_1", enteredAt: "2026-06-29T00:00:00.000Z" },
      ],
      fetcher,
      pollDelayMs: 0,
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.job.status).toBe("succeeded");
    expect(calls.map((call) => call.url)).toEqual([
      "/api/v1/rehearsals/run-1/audio/upload-url",
      "http://storage.local/rehearsal.webm",
      "/api/v1/rehearsals/run-1/meta",
      "/api/v1/rehearsals/run-1/audio/complete",
      "/api/jobs/job-1",
      "/api/jobs/job-1",
      "/api/v1/rehearsals/run-1",
    ]);
    expect(calls[1]?.init).toMatchObject({
      method: "PUT",
      headers: { "content-type": "audio/webm" },
      body: audioFile,
    });
    expect(calls[2]?.init).toMatchObject({
      method: "PATCH",
      headers: { "content-type": "application/json" },
    });
  });

  it("stops before complete when storage upload is interrupted", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url === "/api/v1/rehearsals/run-1/audio/upload-url") {
        return jsonResponse({
          run: runFixture("uploading", { audioFileId: "file-audio" }),
          upload: {
            fileId: "file-audio",
            projectId: "project-a",
            uploadUrl: "http://storage.local/rehearsal.webm",
            method: "PUT",
            headers: { "content-type": "audio/webm" },
            expiresAt: "2026-06-29T00:15:00.000Z",
            purpose: "rehearsal-audio",
          },
        });
      }

      if (url === "http://storage.local/rehearsal.webm") {
        return new Response("network interrupted", { status: 503 });
      }

      return new Response("unexpected", { status: 500 });
    });

    await expect(
      runRehearsalUploadFlow({
        runId: "run-1",
        audioFile: new File(["audio"], "rehearsal.webm", {
          type: "audio/webm",
        }),
        fetcher,
        pollDelayMs: 0,
      }),
    ).rejects.toMatchObject({
      stage: "storage-put",
    } satisfies Partial<RehearsalFlowError>);

    expect(calls).toEqual([
      "/api/v1/rehearsals/run-1/audio/upload-url",
      "http://storage.local/rehearsal.webm",
    ]);
  });
});

describe("fetchRehearsalReport", () => {
  it("loads the official report for a rehearsal run", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        run: runFixture("succeeded"),
        report: reportFixture(),
      }),
    );

    const result = await fetchRehearsalReport("run-1", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/v1/rehearsals/run-1/report");
    expect(result.report?.transcriptRetained).toBe(false);
    expect(result.report?.transcript).toBeNull();
  });

  it("queues a semantic evaluation retry without sending report data", async () => {
    const job = jobFixture("queued", 0);
    const fetcher = vi.fn(async () => jsonResponse({ job }));

    const result = await retryRehearsalSemanticEvaluation("run-1", fetcher);

    expect(result).toEqual(job);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/rehearsals/run-1/semantic-evaluation/retry",
      { method: "POST" },
    );
  });

  it("uses presenter-facing copy when retry evidence has expired", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          code: "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED",
          message: "internal retry detail",
          retryable: false,
        },
        409,
      ),
    );

    await expect(
      retryRehearsalSemanticEvaluation("run-1", fetcher),
    ).rejects.toMatchObject({
      message: "재평가 가능 시간이 지났습니다. 새 리허설을 시작해 주세요.",
      stage: "semantic-retry",
      status: 409,
    });
  });
});

class FakeMediaRecorder {
  static isTypeSupported(mimeType: string) {
    return mimeType === "audio/webm";
  }

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    readonly options?: MediaRecorderOptions,
  ) {}

  start() {
    this.state = "recording";
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio"], {
        type: this.options?.mimeType ?? "audio/webm",
      }),
    } as BlobEvent);
    this.onstop?.(new Event("stop"));
  }
}

function runFixture(
  status: RehearsalRun["status"],
  patch: Partial<RehearsalRun> = {},
): RehearsalRun {
  return {
    runId: "run-1",
    projectId: "project-a",
    deckId: "deck-a",
    audioFileId: null,
    jobId: null,
    deckVersion: null,
    evaluationSnapshot: null,
    semanticEvaluationMode: "full",
    status,
    error: null,
    rawAudioDeletedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...patch,
    analysisRevision: patch.analysisRevision ?? 0,
    analysisFinalizedAt: patch.analysisFinalizedAt ?? null,
  };
}

function jobFixture(status: Job["status"], progress: number): Job {
  return {
    jobId: "job-1",
    projectId: "project-a",
    type: "rehearsal-stt",
    status,
    progress,
    message: status,
    result: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function reportFixture(patch: Partial<RehearsalReport> = {}): RehearsalReport {
  return {
    reportId: "report_run-1",
    runId: "run-1",
    projectId: "project-a",
    deckId: "deck-a",
    transcriptRetained: false,
    transcript: null,
    volumeAnalysis: legacyRehearsalVolumeAnalysis,
    silenceAnalysis: {
      ...legacyRehearsalSilenceAnalysis,
      measurementState: "measured",
      reasonCode: null,
      detectorVersion: "test-vad",
      analysisWindowStartSeconds: 0,
      analysisWindowEndSeconds: 90,
      totalSilenceSeconds: 2,
      silenceRatio: 0.0222,
      longSilenceCount: 1,
      detectedSegmentCount: 1,
      segments: [
        {
          category: "long",
          startSeconds: 12,
          endSeconds: 14,
          durationSeconds: 2,
        },
      ],
    },
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 90,
      wordsPerMinute: 120,
      fillerWordCount: 2,
      longSilenceCount: 1,
      keywordCoverage: 0.75,
      measurements: {
        ...legacyRehearsalReportMetricsDefaults.measurements,
        longSilenceCount: {
          measurementState: "measured",
          metricDefinitionVersion: 1,
          reasonCode: null,
        },
      },
      keywordCoverageMeasurement: { state: "measured" },
    },
    speedSamples: [{ startSecond: 0, endSecond: 10, wordsPerMinute: 120 }],
    fillerWordDetails: [{ word: "음", count: 2 }],
    missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1", text: "ORBIT" }],
    utteranceOutcomes: [],
    semanticCueDecisions: [],
    semanticEvaluation: {
      state: "unavailable",
      measurementMode: "none",
      reasons: ["evaluation_not_run"],
      retryable: false,
    },
    semanticCueOutcomes: [],
    slideTimings: [
      { slideId: "slide_1", targetSeconds: 60, actualSeconds: 52 },
    ],
    slideInsights: [
      {
        slideId: "slide_1",
        fillerWordCount: 2,
        longSilenceCount: 1,
        speakingRate: legacyRehearsalSlideSpeakingRate,
      },
    ],
    qnaSummary: {
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    },
    coaching: {
      status: "succeeded",
      summary: "핵심 메시지가 분명합니다.",
      strengths: ["키워드를 언급했습니다."],
      improvements: ["불필요한 filler를 줄이세요."],
      nextPracticeFocus: "도입부를 더 짧게 연습하세요.",
      message: "",
    },
    generatedAt: "2026-06-29T00:00:10.000Z",
    ...patch,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
