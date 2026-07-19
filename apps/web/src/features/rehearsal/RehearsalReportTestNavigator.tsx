import type { Deck } from "@orbit/shared";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RehearsalSlideCanvasPreview } from "./RehearsalSlideCanvasPreview";

type Props = {
  deck: Deck;
  onSelect: (slideId: string | null) => void;
  selectedSlideId: string | null;
};

type ScrollState = {
  canScrollBackward: boolean;
  canScrollForward: boolean;
  hasOverflow: boolean;
};

const initialScrollState: ScrollState = {
  canScrollBackward: false,
  canScrollForward: false,
  hasOverflow: false,
};

export function RehearsalReportTestNavigator({
  deck,
  onSelect,
  selectedSlideId,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] =
    useState<ScrollState>(initialScrollState);

  const updateScrollState = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const remaining = scroller.scrollWidth - scroller.clientWidth;
    const hasOverflow = remaining > 2;
    setScrollState({
      canScrollBackward: hasOverflow && scroller.scrollLeft > 2,
      canScrollForward: hasOverflow && scroller.scrollLeft < remaining - 2,
      hasOverflow,
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    updateScrollState();
    scroller.addEventListener("scroll", updateScrollState, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollState);
    observer?.observe(scroller);
    Array.from(scroller.children).forEach((child) => observer?.observe(child));
    window.addEventListener("resize", updateScrollState);

    return () => {
      scroller.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      observer?.disconnect();
    };
  }, [deck.slides.length, updateScrollState]);

  function scrollByPage(direction: -1 | 1) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(220, scroller.clientWidth * 0.72),
    });
  }

  return (
    <section
      className={`rrd-test-navigator${scrollState.hasOverflow ? " has-overflow" : ""}`}
      aria-label="리포트 슬라이드 탐색"
    >
      <div className="rrd-test-navigator-head">
        <div>
          <strong>슬라이드 탐색</strong>
          <span>전체 또는 슬라이드를 선택하세요.</span>
        </div>
        <small>{deck.slides.length}장</small>
      </div>
      <div className="rrd-test-navigator-controls">
        {scrollState.hasOverflow ? (
          <button
            type="button"
            className="rrd-test-navigator-arrow is-previous"
            aria-label="이전 슬라이드 목록"
            disabled={!scrollState.canScrollBackward}
            onClick={() => scrollByPage(-1)}
          >
            <ChevronLeft aria-hidden="true" size={20} />
          </button>
        ) : null}
        <div className="rrd-test-filmstrip" ref={scrollerRef}>
          <button
            type="button"
            className={`rrd-test-filmstrip-all${selectedSlideId === null ? " is-selected" : ""}`}
            aria-current={selectedSlideId === null ? "true" : undefined}
            onClick={() => onSelect(null)}
          >
            <span className="rrd-test-filmstrip-all-icon">
              <LayoutGrid aria-hidden="true" size={24} />
            </span>
            <span>
              <b>전체</b>
              <small>{deck.slides.length}장 한눈에 보기</small>
            </span>
          </button>
          {deck.slides.map((slide, index) => (
            <button
              type="button"
              className={
                slide.slideId === selectedSlideId ? "is-selected" : undefined
              }
              aria-current={
                slide.slideId === selectedSlideId ? "true" : undefined
              }
              aria-label={`${index + 1}번 슬라이드 ${slide.title || "제목 없음"}`}
              key={slide.slideId}
              onClick={() => onSelect(slide.slideId)}
            >
              <span className="rrd-test-filmstrip-canvas">
                <RehearsalSlideCanvasPreview
                  ariaHidden
                  deck={deck}
                  slide={slide}
                />
              </span>
              <span className="rrd-test-filmstrip-meta">
                <b>{index + 1}</b>
                <span>{slide.title || "제목 없음"}</span>
              </span>
            </button>
          ))}
        </div>
        {scrollState.hasOverflow ? (
          <button
            type="button"
            className="rrd-test-navigator-arrow is-next"
            aria-label="다음 슬라이드 목록"
            disabled={!scrollState.canScrollForward}
            onClick={() => scrollByPage(1)}
          >
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        ) : null}
      </div>
    </section>
  );
}
