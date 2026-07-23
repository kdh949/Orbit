import {
  createMorphTransitionPlan,
  getMorphMatchKey,
  isMorphGeometryEligible
} from "@orbit/editor-core";
import {
  morphTransitionDefaultDurationMs,
  type Deck,
  type DeckElement,
  type Slide,
  type SlideTransition
} from "@orbit/shared";
import { useEffect, useMemo, useState } from "react";

import { SlideshowRenderer } from "../../../../../rehearsal/presenter/SlideshowRenderer";
import { useReducedMotion } from "../../../../../rehearsal/presenter/useReducedMotion";
import { prepareSlideAssets } from "../../../../../slides/rendering/slideImageCache";
import { AnimationPanelSection } from "./AnimationPanelSection";
import { AnimationRangeField } from "./AnimationRangeField";
import { getAnimationElementLabel } from "../utils/animationUi";

const defaultFadeDurationMs = 700;

export function AnimationSlideTransitionEditor(props: {
  deck: Deck;
  morphDisabledReason?: string | null;
  mutationDisabledReason?: string | null;
  previousSlide?: Slide;
  selectedElement?: DeckElement | null;
  slide: Slide;
  transition?: SlideTransition;
  onBeforePreview?: () => void;
  onUpdateMorphKey: (elementId: string, morphKey: string | null) => void;
  onUpdateTransition: (transition: SlideTransition | null) => void;
}) {
  const {
    deck,
    morphDisabledReason = null,
    mutationDisabledReason = null,
    previousSlide,
    selectedElement = null,
    slide,
    transition,
    onBeforePreview,
    onUpdateMorphKey,
    onUpdateTransition
  } = props;
  const [pendingMorphKey, setPendingMorphKey] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const plan = useMemo(
    () =>
      previousSlide
        ? createMorphTransitionPlan(previousSlide, slide)
        : null,
    [previousSlide, slide]
  );
  const selectedElementEligible = Boolean(
    selectedElement && isMorphGeometryEligible(selectedElement)
  );
  const occupiedMatchKeys = new Set(
    slide.elements
      .filter((element) => element.elementId !== selectedElement?.elementId)
      .map(getMorphMatchKey)
  );
  const sourceOptions = (previousSlide?.elements ?? []).filter(
    (element) =>
      isMorphGeometryEligible(element) &&
      !occupiedMatchKeys.has(getMorphMatchKey(element))
  );
  const selectedMatchKey = selectedElement
    ? getMorphMatchKey(selectedElement)
    : null;
  const linkedSource = sourceOptions.find(
    (element) => getMorphMatchKey(element) === selectedMatchKey
  );

  useEffect(() => {
    setPendingMorphKey(linkedSource ? getMorphMatchKey(linkedSource) : "");
  }, [linkedSource?.elementId, selectedElement?.elementId, slide.slideId]);

  useEffect(() => {
    setPreviewOpen(false);
  }, [slide.slideId]);

  return (
    <section className="property-panel animation-transition-panel">
      <AnimationPanelSection
        action={
          <span
            className={`animation-inspector-status-pill ${transition ? "active" : "muted"}`}
          >
            {transition?.type === "morph"
              ? "모핑"
              : transition?.type === "fade"
                ? "페이드"
                : "없음"}
          </span>
        }
        className="animation-panel-form-card"
        title="슬라이드 전환"
      >
        {mutationDisabledReason ? (
          <div className="animation-editor-warning" role="status">
            {mutationDisabledReason}
          </div>
        ) : null}
        <fieldset
          disabled={Boolean(mutationDisabledReason)}
          style={{ display: "contents" }}
          title={mutationDisabledReason ?? undefined}
        >
          <label className="animation-start-mode-field">
            <strong>전환 효과</strong>
            <select
              aria-label="슬라이드 전환 효과"
              value={transition?.type ?? "none"}
              onChange={(event) =>
                onUpdateTransition(
                  event.currentTarget.value === "fade"
                    ? {
                        type: "fade",
                        durationMs:
                          transition?.type === "fade"
                            ? transition.durationMs
                            : defaultFadeDurationMs
                      }
                    : event.currentTarget.value === "morph"
                      ? {
                          type: "morph",
                          durationMs:
                            transition?.type === "morph"
                              ? transition.durationMs
                              : morphTransitionDefaultDurationMs,
                          mode: "object"
                        }
                    : null
                )
              }
            >
              <option value="none">전환 없음</option>
              <option value="fade">페이드</option>
              <option disabled={Boolean(morphDisabledReason)} value="morph">
                모핑
              </option>
            </select>
          </label>
          {morphDisabledReason ? (
            <div className="animation-editor-warning" role="status">
              {morphDisabledReason}
            </div>
          ) : null}
          {transition ? (
            <AnimationRangeField
              label="전환 시간"
              max={3000}
              min={100}
              value={transition.durationMs}
              onCommit={(durationMs) =>
                onUpdateTransition(
                  transition.type === "morph"
                    ? { type: "morph", durationMs, mode: "object" }
                    : { type: "fade", durationMs }
                )
              }
            />
          ) : null}
          {transition?.type === "morph" ? (
            <div className="animation-panel-form-card">
              <strong>객체 연결</strong>
              <p role="status">연결된 객체 {plan?.pairs.length ?? 0}개</p>
              {selectedElementEligible && selectedElement ? (
                <>
                  <label className="animation-start-mode-field">
                    <span>이전 슬라이드 객체</span>
                    <select
                      aria-label="모핑 연결 객체"
                      value={pendingMorphKey}
                      onChange={(event) =>
                        setPendingMorphKey(event.currentTarget.value)
                      }
                    >
                      <option value="">객체 선택</option>
                      {sourceOptions.map((element) => (
                        <option
                          key={element.elementId}
                          value={getMorphMatchKey(element)}
                        >
                          {getAnimationElementLabel(element)} · {element.elementId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="animation-panel-timing-actions">
                    <button
                      disabled={!pendingMorphKey}
                      type="button"
                      onClick={() =>
                        onUpdateMorphKey(
                          selectedElement.elementId,
                          pendingMorphKey
                        )
                      }
                    >
                      연결
                    </button>
                    <button
                      disabled={!linkedSource && !selectedElement.morphKey}
                      type="button"
                      onClick={() =>
                        onUpdateMorphKey(selectedElement.elementId, null)
                      }
                    >
                      연결 해제
                    </button>
                  </div>
                </>
              ) : (
                <p>연결할 객체 하나를 선택해 주세요.</p>
              )}
              <button
                disabled={Boolean(morphDisabledReason) || !previousSlide}
                type="button"
                onClick={() => {
                  onBeforePreview?.();
                  setPreviewOpen(true);
                }}
              >
                모핑 미리보기
              </button>
            </div>
          ) : null}
          <div className="animation-panel-timing-actions">
            <button
              className="animation-panel-danger-button"
              disabled={!transition}
              type="button"
              onClick={() => onUpdateTransition(null)}
            >
              전환 제거
            </button>
          </div>
        </fieldset>
      </AnimationPanelSection>
      {previewOpen && previousSlide && transition?.type === "morph" ? (
        <MorphTransitionPreview
          deck={deck}
          destinationSlide={slide}
          previousSlide={previousSlide}
          transition={transition}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </section>
  );
}

function MorphTransitionPreview(props: {
  deck: Deck;
  destinationSlide: Slide;
  previousSlide: Slide;
  transition: Extract<SlideTransition, { type: "morph" }>;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [previewSlideId, setPreviewSlideId] = useState(
    props.previousSlide.slideId
  );
  const scale = Math.min(0.42, 800 / props.deck.canvas.width);

  useEffect(() => {
    let disposed = false;
    let frameRequest: number | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    void Promise.all([
      prepareSlideAssets(props.deck, props.previousSlide),
      prepareSlideAssets(props.deck, props.destinationSlide)
    ]).then(() => {
      if (disposed) return;
      const start = () => {
        setPreviewSlideId(props.destinationSlide.slideId);
        closeTimer = setTimeout(
          props.onClose,
          reducedMotion ? 180 : props.transition.durationMs + 180
        );
      };
      if (reducedMotion) start();
      else frameRequest = requestAnimationFrame(start);
    });

    return () => {
      disposed = true;
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      if (closeTimer !== null) clearTimeout(closeTimer);
    };
  }, [
    props.deck,
    props.destinationSlide,
    props.previousSlide,
    props.transition.durationMs,
    reducedMotion
  ]);

  return (
    <div
      aria-label="모핑 미리보기"
      aria-modal="true"
      role="dialog"
      style={{
        alignItems: "center",
        background: "rgba(15, 23, 42, 0.72)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        position: "fixed",
        zIndex: 1000
      }}
    >
      <div style={{ position: "relative" }}>
        <button
          aria-label="모핑 미리보기 닫기"
          onClick={props.onClose}
          style={{ position: "absolute", right: 0, top: -40, zIndex: 1 }}
          type="button"
        >
          닫기
        </button>
        <SlideshowRenderer
          deck={props.deck}
          playInitialEntryAnimations={false}
          renderMode="single-screen"
          scale={scale}
          slideId={previewSlideId}
          stepIndex={0}
        />
      </div>
    </div>
  );
}
