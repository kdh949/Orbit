import type { Deck, DeckElement, Slide } from "@orbit/shared";
import { Presentation } from "lucide-react";
import type { ReactNode } from "react";
import { ActivityPresenterPanel } from "../activity-slides";
import { RehearsalPanel } from "../rehearsal/panel/RehearsalPanel";
import { createRehearsalScriptPrompterRows } from "../rehearsal/panel/rehearsalScriptPrompter";
import type { RehearsalTimingSnapshot, TimingAdviceState } from "../rehearsal/panel/rehearsalTiming";
import { RehearsalScriptTeleprompter } from "../rehearsal/presenter/RehearsalScriptTeleprompter";
import {
  AnimationFlowNavigator,
  type AnimationFlowNavigation,
} from "../rehearsal/presenter/AnimationFlowNavigator";
import { SlideshowRenderer } from "../rehearsal/presenter/SlideshowRenderer";
import type { SpeechTrackerSnapshot } from "../rehearsal/speech/speechTrackingEvents";
import {
  PresenterStageSection,
  PresenterTimerCard,
  PresenterTopbar,
  type PresenterTimeMode,
  type PresenterInfoCardItem,
} from "../presenter-shell/PresenterScaffold";

export function PresentationScreen(props: {
  adviceState: TimingAdviceState;
  animationTriggerDebug?: ReactNode;
  autoAdvanceStatus?: ReactNode;
  deck: Deck | null;
  currentSlide: Slide | null;
  currentSlideIndex: number;
  displayToolbar?: ReactNode;
  elapsedTimeInput: string;
  highlightedKeywordOccurrences?: Parameters<typeof RehearsalPanel>[0]["highlightedKeywordOccurrences"];
  infoCards: readonly PresenterInfoCardItem[];
  isTimerRunning: boolean;
  keywords: NonNullable<Slide["keywords"]>;
  miniSlideScale: number;
  nextHint: string;
  nextSlide: Slide | null;
  onDurationInputBlur: (value: string) => void;
  onDurationInputChange: (value: string) => void;
  onDurationInputFocus: () => void;
  onAnimationFlowNavigate: (navigation: AnimationFlowNavigation) => void;
  onElapsedInputBlur: (value: string) => void;
  onElapsedInputChange: (value: string) => void;
  onElapsedInputFocus: () => void;
  onExit: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onPrimaryAction: () => void;
  onReset: () => void;
  onTimeModeChange: (value: PresenterTimeMode) => void;
  panelSnapshot: SpeechTrackerSnapshot;
  presentationSession?: {
    audienceUrl: string | null;
    sessionId: string;
  };
  presenterScale: number;
  presenterStageRef: (node: HTMLDivElement | null) => void;
  presenterStepIndex: number;
  progressPercent: number;
  stageEmptyLabel: string;
  stageIndexLabel?: string;
  statusLabel: string;
  sentences: Parameters<typeof RehearsalPanel>[0]["sentences"];
  timeInputValue: string;
  timeMetaLeft: string;
  timeMetaRight: string;
  timeMode: PresenterTimeMode;
  timing: RehearsalTimingSnapshot;
  timerDurationInput: string;
  totalSlides: number;
  triggerAnimationIds: string[];
  wordsPerMinute: number;
}) {
  const nextSlideTitle = props.nextSlide
    ? getSlideTitle(props.nextSlide)
    : "다음 슬라이드 없음";
  const teleprompterRows = getPresentationTeleprompterRows({
    sentences: props.sentences,
    snapshot: props.panelSnapshot,
    speakerNotes: props.currentSlide?.speakerNotes ?? "",
  });

  return (
    <main className="rehearsal-presenter-shell">
      <PresenterTopbar
        exitButtonContent={
          <>
            <Presentation size={16} />
            발표 종료
          </>
        }
        onExit={props.onExit}
        onDurationInputBlur={props.onDurationInputBlur}
        onDurationInputChange={props.onDurationInputChange}
        onDurationInputFocus={props.onDurationInputFocus}
        onElapsedInputBlur={props.onElapsedInputBlur}
        onElapsedInputChange={props.onElapsedInputChange}
        onElapsedInputFocus={props.onElapsedInputFocus}
        onPrimaryAction={props.onPrimaryAction}
        onReset={props.onReset}
        onTimeModeChange={props.onTimeModeChange}
        primaryActionAriaLabel={props.isTimerRunning ? "Pause time" : "Start time"}
        primaryActionDisabled={!props.currentSlide}
        primaryActionRunning={props.isTimerRunning}
        statusActive={props.isTimerRunning}
        statusLabel={props.statusLabel}
        subtitle="발표 · 스크립트와 타이머"
        timeMode={props.timeMode}
        timerDurationInput={props.timerDurationInput}
        title="발표"
        totalElapsedInput={props.elapsedTimeInput}
      />

      {props.displayToolbar ? (
        <div className="rehearsal-display-toolbar">
          {props.displayToolbar}
        </div>
      ) : null}

      <section className="rehearsal-presenter-layout">
        <PresenterStageSection
          currentIndex={props.currentSlideIndex}
          emptyStageLabel={props.stageEmptyLabel}
          leftPanel={
            <AnimationFlowNavigator
              currentSlideIndex={props.currentSlideIndex}
              currentStepIndex={props.presenterStepIndex}
              deck={props.deck}
              onNavigate={props.onAnimationFlowNavigate}
              placement="drawer"
            />
          }
          nextHint={props.nextHint}
          nextSlideContent={
            props.deck && props.nextSlide ? (
              <SlideshowRenderer
                deck={props.deck}
                playInitialEntryAnimations={false}
                renderMode="presenter"
                scale={props.miniSlideScale}
                slideId={props.nextSlide.slideId}
                stepIndex={0}
              />
            ) : undefined
          }
          nextSlideTitle={nextSlideTitle}
          onNext={props.onNext}
          onPrevious={props.onPrevious}
          onStageAdvance={props.onNext}
          previousDisabled={props.currentSlideIndex === 0}
          renderStage={
            props.deck && props.currentSlide ? (
              <SlideshowRenderer
                deck={props.deck}
                scale={props.presenterScale}
                slideId={props.currentSlide.slideId}
                stepIndex={props.presenterStepIndex}
                triggerAnimationIds={props.triggerAnimationIds}
              />
            ) : null
          }
          stageIndexLabel={props.stageIndexLabel}
          stageAdvanceDisabled={
            props.currentSlide?.kind === "activity" ||
            props.currentSlide?.kind === "activity-results"
          }
          stageRef={props.presenterStageRef}
          totalSlides={props.totalSlides}
        />

        <aside className="rehearsal-presenter-side">
          <PresenterTimerCard
            ariaLabel="발표 타이머"
            currentTimeLabel="발표 시간 설정"
            infoCards={props.infoCards}
            meterPercent={props.progressPercent}
            onPrimaryAction={props.onPrimaryAction}
            onReset={props.onReset}
            onTimeInputBlur={props.onDurationInputBlur}
            onTimeInputChange={props.onDurationInputChange}
            onTimeInputFocus={props.onDurationInputFocus}
            primaryActionAriaLabel={props.isTimerRunning ? "타이머 일시정지" : "타이머 시작"}
            primaryActionDisabled={!props.currentSlide}
            primaryActionRunning={props.isTimerRunning}
            progressPercent={props.progressPercent}
            timeInputValue={props.timeInputValue}
            timeMetaLeft={props.timeMetaLeft}
            timeMetaRight={props.timeMetaRight}
            title="발표 시간"
          />

          {props.currentSlide?.kind === "activity" && props.deck ? (
            <ActivityPresenterPanel
              autoStart
              deckId={props.deck.deckId}
              deckVersion={props.deck.version}
              presentationSession={props.presentationSession}
              projectId={props.deck.projectId}
              slide={props.currentSlide}
            />
          ) : (
            <RehearsalPanel
              adviceState={props.adviceState}
              highlightedKeywordOccurrences={props.highlightedKeywordOccurrences}
              keywords={props.keywords ?? []}
              liveSlot={props.autoAdvanceStatus}
              mode="live"
              sentences={props.sentences}
              showAdvicePanel={false}
              snapshot={props.panelSnapshot}
              speakerNotes={props.currentSlide?.speakerNotes ?? ""}
              timing={props.timing}
              wordsPerMinute={props.wordsPerMinute}
            />
          )}
        </aside>

        <RehearsalScriptTeleprompter
          focusScopeId={props.currentSlide?.slideId ?? "presentation-empty"}
          progressPercent={Math.round(
            (props.panelSnapshot.scriptProgress?.ratio ?? 0) * 100,
          )}
          rows={teleprompterRows}
        />
      </section>
      {props.animationTriggerDebug}
    </main>
  );
}

function getPresentationTeleprompterRows(input: {
  sentences: Parameters<typeof RehearsalPanel>[0]["sentences"];
  snapshot: SpeechTrackerSnapshot;
  speakerNotes: string;
}) {
  if (input.sentences.length === 0) {
    return [
      {
        id: "presentation-fallback",
        isFocusTarget: true,
        status: "current" as const,
        text: input.speakerNotes.trim() || "발표자 노트가 없습니다.",
      },
    ];
  }

  return createRehearsalScriptPrompterRows({
    sentences: input.sentences,
    coveredSentenceIds: input.snapshot.coveredSentenceIds,
    coveredSentenceMatchKinds: input.snapshot.coveredSentenceMatchKinds,
    prompterProgress: input.snapshot.prompterProgress,
  }).map((row) => ({
    id: row.sentence.sentenceId,
    isFocusTarget: row.isFocusTarget,
    status: row.status,
    text: row.sentence.text,
  }));
}

function getSlideTitle(slide: Slide) {
  const title = slide.title.trim();
  if (title) {
    return title;
  }

  const titleElement = slide.elements.find(
    (element): element is Extract<DeckElement, { type: "text" }> =>
      element.type === "text" && element.role === "title",
  );
  return titleElement?.props.text || `Slide ${slide.order}`;
}
