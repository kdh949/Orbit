import {
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";

export type EditorCommandScrollMetrics = {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
};

export type EditorCommandScrollState = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  hasOverflow: boolean;
};

const scrollEdgeTolerance = 2;

export function getEditorCommandScrollState(
  metrics: EditorCommandScrollMetrics,
): EditorCommandScrollState {
  const maximumScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const hasOverflow = maximumScrollLeft > scrollEdgeTolerance;
  return {
    canScrollLeft: hasOverflow && metrics.scrollLeft > scrollEdgeTolerance,
    canScrollRight:
      hasOverflow && metrics.scrollLeft < maximumScrollLeft - scrollEdgeTolerance,
    hasOverflow,
  };
}

export function getEditorCommandScrollTarget(
  metrics: EditorCommandScrollMetrics,
  direction: -1 | 1,
): number {
  const maximumScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const pageDistance = Math.max(160, metrics.clientWidth - 40);
  return Math.min(
    maximumScrollLeft,
    Math.max(0, metrics.scrollLeft + direction * pageDistance),
  );
}

export function EditorCommandScroller(props: {
  children: ReactNode;
  contextKey: string;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState<EditorCommandScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
    hasOverflow: false,
  });

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setScrollState(
      getEditorCommandScrollState({
        clientWidth: viewport.clientWidth,
        scrollLeft: viewport.scrollLeft,
        scrollWidth: viewport.scrollWidth,
      }),
    );
  }, []);

  const revealElement = useCallback((element: HTMLElement, behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    let nextScrollLeft = viewport.scrollLeft;
    if (elementRect.left < viewportRect.left) {
      nextScrollLeft -= viewportRect.left - elementRect.left;
    } else if (elementRect.right > viewportRect.right) {
      nextScrollLeft += elementRect.right - viewportRect.right;
    }
    if (Math.abs(nextScrollLeft - viewport.scrollLeft) <= scrollEdgeTolerance) return;
    viewport.scrollTo({ behavior, left: nextScrollLeft });
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    updateScrollState();
    viewport.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollState);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(track);
    window.addEventListener("resize", updateScrollState);
    return () => {
      viewport.removeEventListener("scroll", updateScrollState);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let secondFrame: number | null = null;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (props.contextKey === "insert") {
          viewport.scrollTo({ behavior: "auto", left: 0 });
        } else {
          const context = viewport.querySelector<HTMLElement>(
            `[data-context-kind="${props.contextKey}"]`,
          );
          if (context) revealElement(context, "auto");
        }
        updateScrollState();
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    };
  }, [props.contextKey, revealElement, updateScrollState]);

  function scrollByPage(direction: -1 | 1) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const target = getEditorCommandScrollTarget(
      {
        clientWidth: viewport.clientWidth,
        scrollLeft: viewport.scrollLeft,
        scrollWidth: viewport.scrollWidth,
      },
      direction,
    );
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ behavior: reduceMotion ? "auto" : "smooth", left: target });
  }

  function handleFocusCapture(event: FocusEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement)) return;
    revealElement(event.target, "auto");
  }

  return (
    <div
      className={`editor-command-scroll-shell${scrollState.hasOverflow ? " has-overflow" : ""}${scrollState.canScrollLeft ? " can-scroll-left" : ""}${scrollState.canScrollRight ? " can-scroll-right" : ""}`}
    >
      {scrollState.hasOverflow ? (
        <button
          aria-label="이전 편집 도구 보기"
          className="editor-command-scroll-button"
          disabled={!scrollState.canScrollLeft}
          title="이전 편집 도구 보기"
          type="button"
          onClick={() => scrollByPage(-1)}
        >
          <IconChevronsLeft aria-hidden="true" size={16} />
        </button>
      ) : null}
      <div
        className="editor-command-scroll-viewport"
        onFocusCapture={handleFocusCapture}
        ref={viewportRef}
      >
        <div className="editor-command-scroll-track" ref={trackRef}>
          {props.children}
        </div>
      </div>
      {scrollState.hasOverflow ? (
        <button
          aria-label="다음 편집 도구 보기"
          className="editor-command-scroll-button"
          disabled={!scrollState.canScrollRight}
          title="다음 편집 도구 보기"
          type="button"
          onClick={() => scrollByPage(1)}
        >
          <IconChevronsRight aria-hidden="true" size={16} />
        </button>
      ) : null}
    </div>
  );
}
