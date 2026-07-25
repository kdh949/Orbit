import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createDemoDeck } from "@orbit/editor-core";
import type { Job, RehearsalReport, RehearsalRun } from "@orbit/shared";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LiveSttAdapterError,
  RehearsalReportPage,
  RehearsalFlowError,
  RehearsalWorkspace,
  SherpaLiveSttAdapter,
  applyLiveTranscriptBias,
  applyLiveTranscriptEvent,
  buildLiveSttBiasContext,
  createLiveTranscriptBuffer,
  createRecordingFile,
  createRecordingSession,
  evaluateLiveTranscript,
  fetchRehearsalReport,
  fetchOrCreateRehearsalDeck,
  getRehearsalFinishPath,
  getRehearsalPresenterWindowPath,
  getRehearsalReportPath,
  getLiveAudioLevelLabel,
  getLiveAudioLevelPercent,
  getLiveSttDebugDecodingMethod,
  getRehearsalMicrophoneAudioConstraints,
  getRemainingTriggerStepsForSlide,
  normalizeRecordingMimeType,
  rehearsalMicrophoneAudioConstraints,
  rehearsalRawMicrophoneAudioConstraints,
  renderLiveTranscriptBuffer,
  requestRehearsalMicrophoneStream,
  resetRehearsalTimerState,
  resolveRehearsalReportLoadState,
  runRehearsalUploadFlow,
  selectRecordingMimeType,
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
    expect(html).toContain(`슬라이드 ${deck.slides.length}장 로드됨`);
    expect(html).toContain("음성 트리거");
    expect(html).toContain("리허설 시작");
    expect(html).toContain("음성 없이 연습하기");
    expect(html).toContain("이번 목표는");
    expect(html).not.toContain("지난번보다");
    expect(html).toContain("Live STT");
    expect(html).not.toContain(deck.slides[0]?.title);
    expect(html).not.toContain("Partial transcript");
    expect(html).toContain("Report AI");
    expect(html).toContain("Speaker notes");
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
    expect(commandBody).toContain("void startLiveDemo()");
    expect(commandBody).toContain('command.action === "timer-pause"');
    expect(commandBody).toContain("stopLiveDemo()");
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
    expect(resultBody).toContain("if (!p3SessionRef.current)");
    expect(resultBody.indexOf("if (!p3SessionRef.current)")).toBeLessThan(
      resultBody.indexOf("handleLivePartialTranscript"),
    );
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

  it("routes the top timer play button through report recording", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("async function handleTimePrimaryAction");
    const end = source.indexOf("function commitElapsedTimeInput");
    const handleTimePrimaryActionBody = source.slice(start, end);

    expect(handleTimePrimaryActionBody).toContain("await startRecording()");
    expect(handleTimePrimaryActionBody).toContain('if (phase === "recording")');
    expect(handleTimePrimaryActionBody).toContain("stopRecording()");
    expect(handleTimePrimaryActionBody).toContain("stopLiveDemo()");
  });

  it("stops report recording before falling back to standalone Live STT stop", () => {
    const source = fs.readFileSync(
      rehearsalWorkspaceSourcePath,
      "utf8"
    );
    const start = source.indexOf("function handleSideTimerPrimaryAction");
    const end = source.indexOf("function commitElapsedTimeInput");
    const handleSideTimerPrimaryActionBody = source.slice(start, end);

    expect(handleSideTimerPrimaryActionBody).toContain('if (phase === "recording")');
    expect(handleSideTimerPrimaryActionBody).toContain("stopRecording()");
    expect(handleSideTimerPrimaryActionBody).toContain("if (canStopLiveDemo)");
    expect(handleSideTimerPrimaryActionBody).toContain(
      "stopLiveDemo({ showCompletionModal: true })"
    );
    expect(handleSideTimerPrimaryActionBody.indexOf('if (phase === "recording")'))
      .toBeLessThan(handleSideTimerPrimaryActionBody.indexOf("if (canStopLiveDemo)"));
  });

  it("starts report recording from the side timer play button", () => {
    const source = fs.readFileSync(
      rehearsalWorkspaceSourcePath,
      "utf8"
    );
    const start = source.indexOf("function handleSideTimerPrimaryAction");
    const end = source.indexOf("function commitElapsedTimeInput");
    const handleSideTimerPrimaryActionBody = source.slice(start, end);

    expect(handleSideTimerPrimaryActionBody).toContain("if (canRecord)");
    expect(handleSideTimerPrimaryActionBody).toContain("void startRecording()");
    expect(handleSideTimerPrimaryActionBody).not.toContain("void startLiveDemo()");
  });

  it("creates fallback Live STT ports from the selected presenter engine", () => {
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
      "cachedPort?.engineId === presenterSettings.sttEngine",
    );
    expect(getOrCreateLiveSttPortBody).toContain(
      'cachedPort.engineId !== "openai-realtime"',
    );
    expect(getOrCreateLiveSttPortBody).toContain("activeProjectId");
    expect(getOrCreateLiveSttPortBody).toContain("cachedPort?.dispose()");
    expect(getOrCreateLiveSttPortBody).toContain(
      "engineId: presenterSettings.sttEngine",
    );
  });

  it("routes report recording through the P3 tracking session", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const recordingStart = source.indexOf("async function startRecording");
    const recordingEnd = source.indexOf("async function startLiveDemo");
    const startRecordingBody = source.slice(recordingStart, recordingEnd);
    const stopStart = source.indexOf("function stopRecording");
    const stopEnd = source.indexOf("function handleTimePrimaryAction");
    const stopRecordingBody = source.slice(stopStart, stopEnd);

    expect(startRecordingBody).toContain("void startP3Tracking(stream)");
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
    expect(html).toContain("26.06.29.");
    expect(html).toContain("1:30");
    expect(html).toContain(String(deck.slides.length));
    expect(html).toContain("120");
    expect(html).toContain("75%");
    expect(html).toContain("키워드 커버리지");
    expect(html).toContain("불필요한 표현");
    expect(html).toContain("긴 멈춤");
    expect(html).toContain("서버 리포트가 확인한 누락 키워드만 표시합니다.");
    expect(html).toContain("슬라이드별 시간");
    expect(html).toContain("QnA 피드백");
    expect(html).toContain("질문 수");
    expect(html).not.toContain("종합 발표 점수");
    expect(html).not.toContain("/ 100");
    expect(html).not.toContain("속도 안정성");
    expect(html).not.toContain("민감한 전사 원문");
    expect(html).not.toContain("dB");
  });

  it("calculates completion percent from official slide timings", () => {
    const deck = createDemoDeck();
    const completedSlide = deck.slides[0]!;
    const expectedPercent = `${Math.round((1 / deck.slides.length) * 100)}%`;
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

    expect(html).toContain(
      `<span>완료율</span><strong>${expectedPercent}</strong>`,
    );
  });

  it("does not describe an extreme speaking speed as stable", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          metrics: {
            durationSeconds: 0,
            wordsPerMinute: 3600,
            fillerWordCount: 0,
            pauseCount: 0,
            keywordCoverage: 1,
          },
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("확인 필요");
    expect(html).toContain(
      "발표 시간 데이터가 불안정해 속도 판단을 확인해야 합니다.",
    );
    expect(html).not.toContain("3600");
    expect(html).not.toContain("권장 범위 안에서 안정적인 속도로 발표했어요.");
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
            durationSeconds: 90,
            wordsPerMinute: 120,
            fillerWordCount: 0,
            pauseCount: 0,
            keywordCoverage: 1,
          },
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("공식 누락 키워드 상세 데이터가 없습니다.");
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

    expect(html).toContain("총 3개");
    expect(html).toContain("<strong>슬라이드1</strong>");
    expect(html).toMatch(
      /<strong>슬라이드1<\/strong>\s*<span>컴포넌트<\/span>\s*<span>설계<\/span>\s*<span>상태관리<\/span>/,
    );
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

    expect(html).toContain("총 24개");
    expect(html).toContain("매우긴누락키워드0발표흐름핵심데이터");
    expect(html).toContain("매우긴누락키워드23발표흐름핵심데이터");
    expect(html).toContain("서버 리포트가 확인한 누락 키워드만 표시합니다.");
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

    const blocked = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 0.7,
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

  it("records audio through a MediaRecorder-compatible session", () => {
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

    session.stop();
    expect(errors).toEqual([]);
    expect(stoppedFiles).toHaveLength(1);
    expect(stoppedFiles[0]?.name).toBe(
      "rehearsal-2026-06-29T00-00-00-000Z.webm",
    );
    expect(stoppedFiles[0]?.type).toBe("audio/webm");
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

describe("runRehearsalUploadFlow", () => {
  it("creates a run, uploads audio, completes it, polls the job, and fetches final run", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        if (url === "/api/v1/projects/project-a/rehearsals") {
          return jsonResponse({ run: runFixture("created") });
        }

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
      projectId: "project-a",
      deckId: "deck-a",
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
      "/api/v1/projects/project-a/rehearsals",
      "/api/v1/rehearsals/run-1/audio/upload-url",
      "http://storage.local/rehearsal.webm",
      "/api/v1/rehearsals/run-1/meta",
      "/api/v1/rehearsals/run-1/audio/complete",
      "/api/jobs/job-1",
      "/api/jobs/job-1",
      "/api/v1/rehearsals/run-1",
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      deckId: "deck-a",
    });
    expect(calls[2]?.init).toMatchObject({
      method: "PUT",
      headers: { "content-type": "audio/webm" },
      body: audioFile,
    });
    expect(calls[3]?.init).toMatchObject({
      method: "PATCH",
      headers: { "content-type": "application/json" },
    });
  });

  it("stops before complete when storage upload is interrupted", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url === "/api/v1/projects/project-a/rehearsals") {
        return jsonResponse({ run: runFixture("created") });
      }

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
        projectId: "project-a",
        deckId: "deck-a",
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
      "/api/v1/projects/project-a/rehearsals",
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
    status,
    error: null,
    rawAudioDeletedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...patch,
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
    metrics: {
      durationSeconds: 90,
      wordsPerMinute: 120,
      fillerWordCount: 2,
      pauseCount: 1,
      keywordCoverage: 0.75,
    },
    speedSamples: [{ startSecond: 0, endSecond: 10, wordsPerMinute: 120 }],
    fillerWordDetails: [{ word: "음", count: 2 }],
    pauseDetails: [{ startSecond: 12, endSecond: 14, durationSeconds: 2 }],
    missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1", text: "ORBIT" }],
    slideTimings: [
      { slideId: "slide_1", targetSeconds: 60, actualSeconds: 52 },
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

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}
