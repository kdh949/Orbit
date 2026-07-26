import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmRehearsalCommandCandidate,
  createRehearsalCommandConfirmationState,
  detectRehearsalCommandCandidate,
} from "./rehearsalCommands";

const rehearsalWorkspaceSourcePath = fileURLToPath(
  new URL("./RehearsalWorkspaceController.tsx", import.meta.url),
);

const livePresentationOutputSourcePath = fileURLToPath(
  new URL("../presentation/useLivePresentationOutput.ts", import.meta.url),
);

const rehearsalWorkspaceCssPath = fileURLToPath(
  new URL("./rehearsal-workspace-orbit.css", import.meta.url),
);

const editorTopbarSourcePath = fileURLToPath(
  new URL("../editor/shell/components/EditorTopbar.tsx", import.meta.url),
);

const editorShellSourcePath = fileURLToPath(
  new URL("../editor/shell/EditorShellController.tsx", import.meta.url),
);

const rehearsalPanelSourcePath = fileURLToPath(
  new URL("../presenter-shell/panel/RehearsalPanel.tsx", import.meta.url),
);

const rehearsalTeleprompterSourcePath = fileURLToPath(
  new URL(
    "../presenter-shell/presenter/RehearsalScriptTeleprompter.tsx",
    import.meta.url,
  ),
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

describe("RehearsalWorkspace architecture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("isolates a rehearsal-purpose companion session from rehearsal runs", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");

    expect(source).toContain("ensurePresenterCompanionSession");
    expect(source).toContain('sessionPurpose: "rehearsal"');
    expect(source).toContain("closeRehearsalCompanionSession");
    expect(source).not.toContain(
      "startPresentationRuntime({\n      projectId: deck.projectId",
    );
  });

  it("does not create a rehearsal companion session while the feature is disabled", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const effectStart = source.indexOf(
      "if (!presenterCompanionEnabled || !deck || props.presenterWindow)",
    );
    const effectEnd = source.indexOf("useEffect(() => {", effectStart + 1);
    const effect = source.slice(effectStart, effectEnd);

    expect(effectStart).toBeGreaterThan(-1);
    expect(effect).toContain(
      "void ensureRehearsalCompanionSession().catch(() => undefined)",
    );
    expect(effect).toContain("presenterCompanionEnabled,");
  });

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
      /\.rehearsal-presenter-shell \.rehearsal-presenter-layout \{[^}]*--rehearsal-stage-block-size:[^;]+;[^}]*width: min\(100%, var\(--redesign-layout-content-max-width\)\);/s,
    );
    expect(css).toMatch(
      /@media \(max-width:1120px\)[\s\S]*?\.rehearsal-presenter-shell \.rehearsal-presenter-main \{[^}]*grid-template-rows: var\(--rehearsal-stage-block-size\);/,
    );
  });

  it("keeps remote presenter script rows readable on the light script surface", () => {
    const css = fs.readFileSync(rehearsalWorkspaceCssPath, "utf8");

    expect(css).toMatch(
      /\.presenter-remote-script \.presenter-script-row \{[^}]*color: var\(--redesign-color-on-light-variant\);/s,
    );
    expect(css).toMatch(
      /\.presenter-remote-script \.presenter-script-row--current \{[^}]*color: var\(--redesign-color-on-light\);/s,
    );
    expect(css).not.toContain(".presenter-script-row.current");
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
    expect(commandBody).toContain('command.action === "finish"');
    expect(commandBody).toContain("finishRehearsal()");
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
    const hostSource = fs.readFileSync(
      livePresentationOutputSourcePath,
      "utf8",
    );
    const publisherStart = source.indexOf(
      "const livePresentationOutput = useLivePresentationOutput",
    );
    const controllerEnd = source.indexOf(
      "const displayManager = useMemo",
      publisherStart,
    );
    const integrationBody = source.slice(publisherStart, controllerEnd);

    expect(integrationBody).toContain("onPeerReady: (peer)");
    expect(integrationBody).toContain("reattachAudienceStreamRef.current()");
    expect(integrationBody).toContain("onScreenShareEnded:");
    expect(integrationBody).toContain("stopAudienceStreamRef.current()");
    expect(integrationBody).toContain("slideWindowRef.current");
    expect(integrationBody).toContain("setAudienceOutputMode");
    expect(hostSource).toContain("screenShare.handlePeerUnavailable()");
  });

  it("supports Surface Swap fullscreen before opening the presenter remote popup", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const surfaceStart = source.indexOf("const openSurfaceSwapDisplay =");
    const openStart = source.indexOf(
      "const openSlideWindowForDisplay =",
      surfaceStart,
    );
    const publisherStart = source.indexOf(
      "const livePresentationOutput = useLivePresentationOutput",
    );
    const publisherBody = source.slice(
      publisherStart,
      source.indexOf("});", publisherStart),
    );
    const surfaceBody = source.slice(surfaceStart, openStart);
    const presenterScreenCapture = surfaceBody.indexOf(
      "const presenterScreen = displayManager.getCurrentScreen()",
    );
    const fullscreenRequest = surfaceBody.indexOf("requestFullscreenOnScreen");
    const presenterWindowOpen = surfaceBody.indexOf(
      "openPresenterRemoteWindow",
    );

    expect(presenterScreenCapture).toBeGreaterThanOrEqual(0);
    expect(presenterScreenCapture).toBeLessThan(fullscreenRequest);
    expect(fullscreenRequest).toBeLessThan(presenterWindowOpen);
    expect(surfaceBody).toContain("screen: presenterScreen");
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

  it("disables presenter keyboard shortcuts while the rehearsal completion dialog is visible", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const keyboardStart = source.indexOf("usePresenterKeyboard({");
    const keyboardEnd = source.indexOf("});", keyboardStart);
    const keyboardBody = source.slice(keyboardStart, keyboardEnd);

    expect(source).toContain("const isRehearsalCompletionVisible =");
    expect(keyboardBody).toContain("!isRehearsalCompletionVisible");
  });

  it("restarts a completed rehearsal from the beginning without showing preflight", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("const handleCompletionPracticeAgain =");
    const end = source.indexOf("const handleCompletionPrimaryAction =", start);
    const practiceAgainBody = source.slice(start, end);

    expect(practiceAgainBody).toContain("returnToPreflight()");
    expect(practiceAgainBody).toContain("resetRehearsalAttemptToBeginning()");
    expect(practiceAgainBody).toContain("startPracticeWithoutVoice()");
    expect(practiceAgainBody).toContain(
      "void startRecording({ allowDuringReport: true })",
    );
    expect(practiceAgainBody).toContain(
      'shouldAutoStartRef.current = "starting"',
    );
    expect(practiceAgainBody).toContain("shouldAutoStartRef.current = null");

    const resetStart = source.indexOf(
      "const resetRehearsalAttemptToBeginning =",
    );
    const resetEnd = source.indexOf(
      "const publishSlideWindowSnapshot =",
      resetStart,
    );
    const resetBody = source.slice(resetStart, resetEnd);

    expect(resetBody).toContain("resetSlideDisplayToBeginning()");
    expect(resetBody).toContain("speechTracking.resetSessionTranscript()");
    expect(resetBody).toContain("resetLivePlaybackForSlide(firstSlide)");
    expect(resetBody).toContain(
      "speechTracking.resetSlideTranscriptSnapshots(deck, 0)",
    );
  });

  it("keeps the presence avatar as the socket status dialog trigger", () => {
    const topbarSource = fs.readFileSync(editorTopbarSourcePath, "utf8");
    const shellSource = fs.readFileSync(editorShellSourcePath, "utf8");

    expect(topbarSource).toContain("onOpenPresenceDebug: () => void;");
    expect(topbarSource).toContain("onClick={onOpenPresenceDebug}");
    expect(topbarSource).toContain('type="button"');
    expect(shellSource).toContain("onOpenPresenceDebug={() => {");
    expect(shellSource).toContain("setIsPresenceDebugOpen(true);");
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

  it("removes single-screen entry and keeps safe Live STT recovery controls", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");

    expect(source).not.toContain("onClick={() => setIsSingleScreenOpen(true)}");
    expect(source).toContain("sanitizeLiveSttErrorMessage(liveError)");
    expect(source).toContain("retryInitialRecordingLiveStt()");
    expect(source).toContain("음성 인식 다시 연결");
  });

  it("resets presenter step when P4 auto advance command completes", () => {
    const source = fs.readFileSync(rehearsalWorkspaceSourcePath, "utf8");
    const start = source.indexOf("function runAdvanceControllerEvaluation");
    const end = source.indexOf("function handleLiveSttError");
    const autoAdvanceBody = source.slice(start, end);

    expect(autoAdvanceBody).toContain("evaluateAdvanceController");
    expect(autoAdvanceBody).toContain('command.type !== "advance-slide"');
    expect(autoAdvanceBody).toContain("requestPreparedSlideChange");
    expect(autoAdvanceBody).toContain('source: "auto"');
    expect(autoAdvanceBody).toContain("stepIndex: 0");
    expect(autoAdvanceBody).not.toContain("setCurrentSlideIndex");
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
    expect(handleNextPresenterStepBody).toContain("requestPreparedSlideChange");
    expect(handleNextPresenterStepBody).toContain(
      "stepIndex: nextState.stepIndex",
    );
    expect(handleNextPresenterStepBody).toContain(
      "targetSlideIndex: nextState.slideIndex",
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
    expect(handleNextPresenterStepBody).not.toContain("setPresenterStepIndex(");
    expect(handleNextPresenterStepBody).not.toContain("setCurrentSlideIndex(");
    expect(handleNextPresenterStepBody).toContain("requestPreparedSlideChange");
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
    const end = source.indexOf("function resetLivePlaybackForSlide");
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
});
