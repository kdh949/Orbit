import type { Deck, RehearsalReport } from "@orbit/shared";
import { ChevronLeft, ChevronRight, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RehearsalSlideCanvasPreview } from "./RehearsalSlideCanvasPreview";
import { buildRehearsalSlideAnalysisCards } from "./rehearsalSlideAnalysisModel";
import "./rehearsal-slide-coaching-viewer.css";

type Props = {
  deck: Deck | null;
  formatDelta: (diff: number) => string;
  formatDuration: (totalSeconds: number) => string;
  prevReports: RehearsalReport[];
  report: RehearsalReport;
};

type SortMode = "priority" | "slide";
type AnalysisCard = ReturnType<typeof buildRehearsalSlideAnalysisCards>[number];
type SlidePriority = "high" | "medium" | "low";

const PRIORITY_META: Record<SlidePriority, { label: string; className: string }> = {
  high: { label: "개선 필요", className: "is-high" },
  medium: { label: "주의 필요", className: "is-medium" },
  low: { label: "양호", className: "is-low" },
};

export function RehearsalSlideCoachingViewer({
  deck,
  formatDelta,
  formatDuration,
  prevReports,
  report,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const analysisCards = useMemo(
    () => buildRehearsalSlideAnalysisCards(deck, prevReports, report),
    [deck, prevReports, report],
  );
  const analysisBySlideId = useMemo(
    () => new Map(analysisCards.map((card) => [card.slideId, card])),
    [analysisCards],
  );
  const slides = useMemo(() => {
    const orderedSlides = [...(deck?.slides ?? [])].sort((a, b) => a.order - b.order);
    if (sortMode === "slide") return orderedSlides;

    return orderedSlides.sort((a, b) => {
      const priorityDiff =
        getPriorityRank(getSlidePriority(analysisBySlideId.get(b.slideId))) -
        getPriorityRank(getSlidePriority(analysisBySlideId.get(a.slideId)));
      return priorityDiff || a.order - b.order;
    });
  }, [analysisBySlideId, deck, sortMode]);

  useEffect(() => {
    setActiveIndex(0);
  }, [deck?.deckId, report.runId, sortMode]);

  if (!deck || slides.length === 0) return null;

  const boundedIndex = Math.min(activeIndex, slides.length - 1);
  const slide = slides[boundedIndex]!;
  const previousSlide = slides[boundedIndex - 1] ?? null;
  const nextSlide = slides[boundedIndex + 1] ?? null;
  const feedback = analysisBySlideId.get(slide.slideId);
  const feedbackItems = feedback?.feedbackItems ?? [];
  const priority = getSlidePriority(feedback);
  const priorityMeta = PRIORITY_META[priority];

  return (
    <section className="rrd-slide-coaching" aria-labelledby="rrd-slide-coaching-title">
      <div className="rrd-slide-coaching-stage">
        <header>
          <div>
            <span>SLIDE ANALYSIS</span>
            <h2 id="rrd-slide-coaching-title">슬라이드별 분석</h2>
            <p>우선순위가 높은 장표부터 확인하세요.</p>
          </div>
          <div className="rrd-slide-coaching-controls">
            {analysisCards.length > 0 && <strong>{analysisCards.length}장</strong>}
            <label htmlFor="rrd-slide-coaching-sort">정렬</label>
            <select
              id="rrd-slide-coaching-sort"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="priority">우선순위순</option>
              <option value="slide">장표 순서</option>
            </select>
          </div>
        </header>

        <div className="rrd-slide-coaching-preview-row">
          <button
            type="button"
            className="rrd-slide-coaching-nav"
            aria-label="이전 슬라이드"
            disabled={boundedIndex === 0}
            onClick={() => setActiveIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft aria-hidden="true" size={28} />
          </button>

          <div className="rrd-slide-coaching-carousel">
            <div className="rrd-slide-coaching-peek is-previous" aria-hidden="true">
              {previousSlide ? <SlidePreview deck={deck} slide={previousSlide} variant="peek" /> : null}
            </div>
            <SlidePreview deck={deck} slide={slide} variant="main" />
            <div className="rrd-slide-coaching-peek is-next" aria-hidden="true">
              {nextSlide ? <SlidePreview deck={deck} slide={nextSlide} variant="peek" /> : null}
            </div>
          </div>

          <button
            type="button"
            className="rrd-slide-coaching-nav"
            aria-label="다음 슬라이드"
            disabled={boundedIndex === slides.length - 1}
            onClick={() =>
              setActiveIndex((current) => Math.min(slides.length - 1, current + 1))
            }
          >
            <ChevronRight aria-hidden="true" size={28} />
          </button>
        </div>

        <footer>
          <span>슬라이드 {slide.order}</span>
          <strong>{slide.title || "제목 없는 슬라이드"}</strong>
          <em className={priorityMeta.className}>{priorityMeta.label}</em>
          <small>{boundedIndex + 1} / {slides.length}</small>
        </footer>
      </div>

      <aside className="rrd-slide-coaching-note" aria-live="polite">
        <header>
          <span className="rrd-slide-coaching-note-icon" aria-hidden="true">
            <StickyNote size={20} />
          </span>
          <div>
            <span>ANALYSIS NOTE</span>
            <h3>이 슬라이드의 분석</h3>
          </div>
        </header>

        <strong className="rrd-slide-coaching-feedback-label">
          개선 피드백
        </strong>
        {feedbackItems.length > 0 ? (
          <ol>
            {feedbackItems.map((item) => <li key={item}>{item}</li>)}
          </ol>
        ) : (
          <div className="rrd-slide-coaching-note-empty">
            <strong>좋은 흐름을 유지했어요</strong>
            <p>현재 리허설에서 이 장표에 별도 개선이 필요한 부분이 없습니다.</p>
          </div>
        )}

        {feedback && (
          <div className="rrd-slide-coaching-details">
            <section>
              <strong>놓친 핵심 메시지</strong>
              {feedback.missedKeywords.length > 0 ? (
                <div className="rrd-slide-coaching-keywords">
                  {feedback.missedKeywords.map((keyword) => (
                    <span key={keyword}>{keyword}</span>
                  ))}
                </div>
              ) : (
                <p>직접 누락된 핵심 메시지는 없습니다.</p>
              )}
            </section>

            <section>
              <strong>문제 신호</strong>
              {feedback.signalTags.length > 0 ? (
                <div className="rrd-slide-coaching-note-tags">
                  {feedback.signalTags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              ) : (
                <p>반복 신호는 크지 않습니다.</p>
              )}
            </section>

            <section>
              <strong>참고 시간</strong>
              <div className="rrd-slide-coaching-timing">
                <span>이번 {formatDuration(feedback.actualSeconds)}</span>
                <span>
                  평균{" "}
                  {feedback.averageSeconds != null
                    ? formatDuration(feedback.averageSeconds)
                    : "집계 중"}
                </span>
                <span>
                  대비{" "}
                  {feedback.diffSeconds != null
                    ? formatDelta(feedback.diffSeconds)
                    : "집계 중"}
                </span>
              </div>
            </section>
          </div>
        )}

        {analysisCards.length === 0 && (
          <p className="rrd-slide-coaching-overall-empty">
            현재 리허설에서 별도 개선이 필요한 장표가 없습니다.
          </p>
        )}
      </aside>
    </section>
  );
}

function getSlidePriority(card: AnalysisCard | undefined): SlidePriority {
  if (!card) return "low";
  if (
    card.missedKeywords.length > 0 ||
    card.feedbackItems.length >= 2 ||
    card.signalTags.some((tag) => /긴 멈춤|메시지 누락|시간 초과/.test(tag))
  ) {
    return "high";
  }
  return card.feedbackItems.length > 0 || card.signalTags.length > 0
    ? "medium"
    : "low";
}

function getPriorityRank(priority: SlidePriority) {
  return priority === "high" ? 3 : priority === "medium" ? 2 : 1;
}

function SlidePreview({
  deck,
  slide,
  variant,
}: {
  deck: Deck;
  slide: Deck["slides"][number];
  variant: "main" | "peek";
}) {
  const slideLabel = slide.title || `슬라이드 ${slide.order}`;

  return (
    <div className={`rrd-slide-coaching-preview is-${variant}`}>
      <RehearsalSlideCanvasPreview
        ariaHidden={variant === "peek"}
        deck={deck}
        label={`${slideLabel} 미리보기`}
        slide={slide}
      />
    </div>
  );
}
