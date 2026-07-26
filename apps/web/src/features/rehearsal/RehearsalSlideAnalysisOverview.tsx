import { ChevronLeft, ChevronRight, FileText, Layers } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Deck } from "@orbit/shared/deck";
import type { RehearsalReport } from "@orbit/shared/rehearsals";
import { buildRehearsalSlideAnalysisCards } from "./rehearsalSlideAnalysisModel";
import { getSlideAnalysisAnchor } from "./rehearsalRunComparisonModel";

const PAGE_SIZE = 3;

type Props = {
  deck: Deck | null;
  formatDelta: (diff: number) => string;
  formatDuration: (totalSeconds: number) => string;
  prevReports: RehearsalReport[];
  report: RehearsalReport;
};

type SortMode = "priority" | "slide";
type SlidePriority = "high" | "medium" | "low";

const PRIORITY_META: Record<
  SlidePriority,
  { label: string; className: string }
> = {
  high: { label: "개선 필요", className: "is-high" },
  medium: { label: "주의 필요", className: "is-medium" },
  low: { label: "양호", className: "is-low" },
};

export function RehearsalSlideAnalysisOverview({
  deck,
  formatDelta,
  formatDuration,
  prevReports,
  report,
}: Props) {
  const [page, setPage] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("priority");

  const problemCards = useMemo(
    () => buildRehearsalSlideAnalysisCards(deck, prevReports, report),
    [deck, prevReports, report],
  );
  const priorityItems = useMemo(() => {
    const cardBySlideId = new Map(
      problemCards.map((card) => [card.slideId, card]),
    );
    const timings = report.slideTimings.length
      ? report.slideTimings
      : problemCards.map((card) => ({
          actualSeconds: card.actualSeconds,
          slideId: card.slideId,
        }));

    return timings.map((timing, index) => {
      const slide = deck?.slides.find(
        (item) => item.slideId === timing.slideId,
      );
      const card = cardBySlideId.get(timing.slideId);
      const order = slide?.order ?? index + 1;
      const title = slide?.title.trim() || "장표 내용 확인";

      return {
        card,
        order,
        priority: (card ? getSlidePriority(card) : "low") as SlidePriority,
        slideId: timing.slideId,
        title,
      };
    });
  }, [deck, problemCards, report.slideTimings]);
  const sortedCards = useMemo(() => {
    const slideOrder = new Map(
      priorityItems.map((item) => [item.slideId, item.order]),
    );

    return [...problemCards].sort((a, b) => {
      if (sortMode === "slide") {
        return (
          (slideOrder.get(a.slideId) ?? Number.MAX_SAFE_INTEGER) -
          (slideOrder.get(b.slideId) ?? Number.MAX_SAFE_INTEGER)
        );
      }

      return (
        getPriorityRank(getSlidePriority(b)) -
          getPriorityRank(getSlidePriority(a)) ||
        (slideOrder.get(a.slideId) ?? Number.MAX_SAFE_INTEGER) -
          (slideOrder.get(b.slideId) ?? Number.MAX_SAFE_INTEGER)
      );
    });
  }, [problemCards, priorityItems, sortMode]);
  const totalPages = Math.max(1, Math.ceil(sortedCards.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleCards = sortedCards.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [sortMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const targetIndex = sortedCards.findIndex(
      (card) =>
        `#${getSlideAnalysisAnchor(card.slideId)}` === window.location.hash,
    );
    if (targetIndex < 0) return;

    setPage(Math.floor(targetIndex / PAGE_SIZE));
    const targetId = window.location.hash.slice(1);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
  }, [sortedCards]);

  return (
    <section className="rrd-card">
      <header className="rrd-card-head rrd-slide-analysis-head">
        <Layers size={20} className="rrd-card-icon" />
        <div className="rrd-slide-analysis-heading">
          <h2>장표별 분석</h2>
          <span>우선순위가 높은 장표부터 확인하세요.</span>
        </div>
        <div className="rrd-slide-analysis-controls">
          {problemCards.length > 0 && (
            <span className="rrd-card-count">{problemCards.length}장</span>
          )}
          <label htmlFor="rrd-slide-analysis-sort">정렬</label>
          <select
            id="rrd-slide-analysis-sort"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="priority">우선순위순</option>
            <option value="slide">장표 순서</option>
          </select>
        </div>
      </header>

      {priorityItems.length > 0 && (
        <section
          className="rrd-slide-priority"
          aria-label="슬라이드별 우선순위"
        >
          <header className="rrd-slide-priority-head">
            <div>
              <span>SLIDE PRIORITY</span>
              <strong>먼저 볼 장표</strong>
            </div>
            <div
              className="rrd-slide-priority-legend"
              aria-label="우선순위 범례"
            >
              {Object.entries(PRIORITY_META).map(([key, meta]) => (
                <span key={key}>
                  <i className={`rrd-slide-priority-dot ${meta.className}`} />
                  {meta.label}
                </span>
              ))}
            </div>
          </header>
          <div className="rrd-slide-priority-track" role="list">
            {priorityItems.map((item) => {
              const priorityMeta = PRIORITY_META[item.priority];
              const content = (
                <>
                  <span
                    className={`rrd-slide-priority-number ${priorityMeta.className}`}
                  >
                    {item.order}
                  </span>
                  <small>{item.title}</small>
                </>
              );

              return item.card ? (
                <a
                  className={`rrd-slide-priority-item ${priorityMeta.className}`}
                  href={`#${getSlideAnalysisAnchor(item.slideId)}`}
                  key={item.slideId}
                  role="listitem"
                  title={`슬라이드 ${item.order} · ${item.title} · ${priorityMeta.label}`}
                >
                  {content}
                </a>
              ) : (
                <span
                  className={`rrd-slide-priority-item ${priorityMeta.className}`}
                  key={item.slideId}
                  role="listitem"
                  title={`슬라이드 ${item.order} · ${priorityMeta.label}`}
                >
                  {content}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {problemCards.length === 0 ? (
        <p className="rrd-empty-hint">
          현재 리허설에서 별도 개선이 필요한 장표가 없습니다.
        </p>
      ) : (
        <>
          <div className="rrd-slide-analysis-list">
            {visibleCards.map((card) => (
              <div
                key={card.slideId}
                className="rrd-slide-analysis-item"
                id={getSlideAnalysisAnchor(card.slideId)}
              >
                <div className="rrd-slide-analysis-thumb">
                  {card.thumbnailUrl ? (
                    <img
                      src={card.thumbnailUrl}
                      alt=""
                      className="rrd-slide-thumb-img"
                    />
                  ) : (
                    <div className="rrd-slide-thumb-placeholder">
                      <FileText size={18} />
                    </div>
                  )}
                </div>

                <div className="rrd-slide-analysis-body">
                  <div className="rrd-slide-analysis-title-row">
                    <strong className="rrd-slide-analysis-title">
                      {card.slideLabel}
                    </strong>
                    <span
                      className={`rrd-slide-analysis-priority ${PRIORITY_META[getSlidePriority(card)].className}`}
                    >
                      {PRIORITY_META[getSlidePriority(card)].label}
                    </span>
                  </div>

                  <div className="rrd-slide-row rrd-slide-row-priority">
                    <span className="rrd-slide-row-label">개선 피드백</span>
                    <ul className="rrd-slide-feedback-list">
                      {card.feedbackItems.map((item) => (
                        <li key={item} className="rrd-slide-feedback-item">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rrd-slide-row">
                    <span className="rrd-slide-row-label">
                      놓친 핵심 메시지
                    </span>
                    {card.missedKeywords.length > 0 ? (
                      <div className="rrd-keyword-chips">
                        {card.missedKeywords.map((keyword) => (
                          <span key={keyword} className="rrd-keyword-chip">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="rrd-muted">
                        직접 누락된 핵심 메시지는 없습니다.
                      </span>
                    )}
                  </div>

                  <div className="rrd-slide-row">
                    <span className="rrd-slide-row-label">문제 신호</span>
                    {card.signalTags.length > 0 ? (
                      <div className="rrd-recurring-tags">
                        {card.signalTags.map((tag) => (
                          <span key={tag} className="rrd-recurring-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="rrd-muted">
                        반복 신호는 크지 않습니다.
                      </span>
                    )}
                  </div>

                  <div className="rrd-slide-row rrd-slide-row-secondary">
                    <span className="rrd-slide-row-label">참고 시간</span>
                    <div className="rrd-slide-metric-summary">
                      <span>이번 {formatDuration(card.actualSeconds)}</span>
                      <span>
                        평균{" "}
                        {card.averageSeconds != null
                          ? formatDuration(card.averageSeconds)
                          : "집계 중"}
                      </span>
                      <span>
                        대비{" "}
                        {card.diffSeconds != null
                          ? formatDelta(card.diffSeconds)
                          : "집계 중"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {problemCards.length > PAGE_SIZE && (
            <div className="rrd-slide-pagination">
              <button
                type="button"
                className="rrd-slide-page-button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft size={14} />
                이전
              </button>
              <span className="rrd-slide-page-status">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="rrd-slide-page-button"
                onClick={() =>
                  setPage((current) => Math.min(totalPages - 1, current + 1))
                }
                disabled={currentPage >= totalPages - 1}
              >
                다음
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function getSlidePriority(
  card: ReturnType<typeof buildRehearsalSlideAnalysisCards>[number],
): SlidePriority {
  if (
    card.missedKeywords.length > 0 ||
    card.feedbackItems.length >= 2 ||
    card.signalTags.some((tag) => /긴 침묵|메시지 누락|시간 초과/.test(tag))
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
