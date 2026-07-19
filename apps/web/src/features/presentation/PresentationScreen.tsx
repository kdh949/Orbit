import type { Deck, DeckElement, Slide } from "@orbit/shared";
import { Presentation } from "lucide-react";
import { ActivityPresenterPanel } from "../activity-slides";
import { RehearsalPanel } from "../rehearsal/panel/RehearsalPanel";
import type { RehearsalTimingSnapshot, TimingAdviceState } from "../rehearsal/panel/rehearsalTiming";
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
  deck: Deck | null;
  currentSlide: Slide | null;
  currentSlideIndex: number;
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
}) {
  const nextSlideTitle = props.nextSlide
    ? getSlideTitle(props.nextSlide)
    : "다음 슬라이드 없음";

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

      <section className="rehearsal-presenter-layout">
        <PresenterStageSection
          currentIndex={props.currentSlideIndex}
          emptyStageLabel={props.stageEmptyLabel}
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
              projectId={props.deck.projectId}
              slide={props.currentSlide}
            />
          ) : (
            <RehearsalPanel
              adviceState={props.adviceState}
              highlightedKeywordOccurrences={props.highlightedKeywordOccurrences}
              keywords={props.keywords ?? []}
              mode="rehearsal"
              sentences={props.sentences}
              showAdvicePanel={false}
              snapshot={props.panelSnapshot}
              speakerNotes={props.currentSlide?.speakerNotes ?? ""}
              timing={props.timing}
              wordsPerMinute={0}
            />
          )}
        </aside>
      </section>
    </main>
  );
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
