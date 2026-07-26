import type { Deck, Slide } from "@orbit/shared";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  createSlideshowAnimationPlan,
  type PlannedSlideshowAnimation,
} from "../../../runtime/presentation/slideshow/slideshowStepModel";
import { getTriggerAnimationIdsForSlide } from "../../../runtime/presentation/playback/triggeredActionPlayback";

export type AnimationFlowNavigation = {
  kind: "animation-step" | "slide";
  stepIndex: number;
  targetSlideIndex: number;
};

export type AnimationFlowStep = {
  effectsLabel: string;
  stepIndex: number;
  triggerLabel: string;
};

export type AnimationFlowSlide = {
  entryEffectsLabel: string | null;
  isActivity: boolean;
  slideId: string;
  slideIndex: number;
  steps: AnimationFlowStep[];
  title: string;
};

export function createAnimationFlowModel(deck: Deck): AnimationFlowSlide[] {
  return deck.slides.map((slide, slideIndex) => {
    if (slide.kind === "activity" || slide.kind === "activity-results") {
      return {
        entryEffectsLabel: null,
        isActivity: true,
        slideId: slide.slideId,
        slideIndex,
        steps: [],
        title: getSlideTitle(slide),
      };
    }

    const animationPlan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide),
    });

    return {
      entryEffectsLabel: formatEffects(animationPlan.entryAnimations),
      isActivity: false,
      slideId: slide.slideId,
      slideIndex,
      steps: animationPlan.triggerSteps.map((step, index) => ({
        effectsLabel: formatEffects(step.animations) ?? "효과",
        stepIndex: index + 1,
        triggerLabel: getTriggerLabel(slide, step.animations),
      })),
      title: getSlideTitle(slide),
    };
  });
}

export function AnimationFlowNavigator(props: {
  currentSlideIndex: number;
  currentStepIndex: number;
  deck: Deck | null;
  navigationPending?: boolean;
  onNavigate: (navigation: AnimationFlowNavigation) => void;
  placement?: "drawer" | "side";
}) {
  const placement = props.placement ?? "side";
  const [isOpen, setIsOpen] = useState(placement === "side");
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [drawerPosition, setDrawerPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [expandedSlideIds, setExpandedSlideIds] = useState<Set<string>>(
    () => new Set(),
  );
  const flowSlides = props.deck ? createAnimationFlowModel(props.deck) : [];
  const currentSlide = flowSlides[props.currentSlideIndex];

  useEffect(() => {
    if (!currentSlide) return;
    setExpandedSlideIds((current) => {
      if (current.has(currentSlide.slideId)) return current;
      return new Set([...current, currentSlide.slideId]);
    });
  }, [currentSlide]);

  useEffect(() => {
    const stopDragging = () => {
      drawerDragRef.current = null;
    };
    const moveDrawer = (event: PointerEvent) => {
      const drag = drawerDragRef.current;
      const drawer = drawerRef.current;
      if (!drag || !drawer) return;

      const bounds = drawer.getBoundingClientRect();
      const viewportPadding = 8;
      setDrawerPosition({
        left: clamp(
          event.clientX - drag.offsetX,
          viewportPadding,
          Math.max(viewportPadding, window.innerWidth - bounds.width - viewportPadding),
        ),
        top: clamp(
          event.clientY - drag.offsetY,
          viewportPadding,
          Math.max(viewportPadding, window.innerHeight - bounds.height - viewportPadding),
        ),
      });
    };

    window.addEventListener("pointermove", moveDrawer);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", moveDrawer);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  const startDrawerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    const bounds = drawer.getBoundingClientRect();
    drawerDragRef.current = {
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  if (flowSlides.length === 0) {
    return null;
  }

  return (
    <section
      ref={drawerRef}
      className={`animation-flow-navigator animation-flow-navigator-${placement} ${
        isOpen ? "animation-flow-navigator-open" : ""
      } ${placement === "drawer" && isOpen ? "animation-flow-navigator-drawer-open" : ""}`}
      aria-label="애니메이션 타임라인"
      style={placement === "drawer" && drawerPosition ? drawerPosition : undefined}
    >
      {placement === "drawer" ? (
        <button
          aria-expanded={isOpen}
          aria-label={`애니메이션 타임라인 ${isOpen ? "닫기" : "열기"}`}
          className="animation-flow-drawer-toggle"
          type="button"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          <span>애니메이션 타임라인</span>
        </button>
      ) : null}
      {placement === "drawer" && !isOpen ? null : (
        <>
      {placement === "drawer" ? (
        <header className="animation-flow-navigator-header">
          <button
            aria-label="애니메이션 타임라인 위치 이동"
            className="animation-flow-drawer-drag-handle"
            type="button"
            onPointerDown={startDrawerDrag}
          >
            <GripVertical aria-hidden="true" size={18} />
          </button>
        </header>
      ) : null}
      <p className="animation-flow-navigator-description">
        장표 또는 효과를 선택하면 해당 시점으로 이동합니다.
      </p>
      <div className="animation-flow-navigator-list">
        {flowSlides.map((slide) => {
          const isCurrentSlide = slide.slideIndex === props.currentSlideIndex;
          const isExpanded = expandedSlideIds.has(slide.slideId);
          return (
            <section
              className={`animation-flow-slide ${
                isCurrentSlide ? "animation-flow-slide-current" : ""
              }`}
              key={slide.slideId}
            >
              <div className="animation-flow-slide-header">
                <button
                  className="animation-flow-slide-target"
                  disabled={props.navigationPending}
                  type="button"
                  onClick={() =>
                    props.onNavigate({
                      kind: "slide",
                      stepIndex: 0,
                      targetSlideIndex: slide.slideIndex,
                    })
                  }
                >
                  <span>장표 {slide.slideIndex + 1}</span>
                  <strong>{slide.title}</strong>
                </button>
                <button
                  aria-expanded={isExpanded}
                  aria-label={`${slide.title} 애니메이션 목록 ${
                    isExpanded ? "접기" : "펼치기"
                  }`}
                  className="animation-flow-slide-toggle"
                  type="button"
                  onClick={() =>
                    setExpandedSlideIds((current) => {
                      const next = new Set(current);
                      if (next.has(slide.slideId)) next.delete(slide.slideId);
                      else next.add(slide.slideId);
                      return next;
                    })
                  }
                >
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
              </div>
              {isExpanded ? (
                <div className="animation-flow-steps">
                  {slide.isActivity ? (
                    <p className="animation-flow-empty">운영 상태를 유지한 채 장표만 이동합니다.</p>
                  ) : (
                    <>
                      {slide.entryEffectsLabel ? (
                        <div className="animation-flow-entry">
                          <span>슬라이드 시작</span>
                          <strong>{slide.entryEffectsLabel}</strong>
                        </div>
                      ) : null}
                      {slide.steps.length === 0 ? (
                        <p className="animation-flow-empty">애니메이션 없음</p>
                      ) : (
                        slide.steps.map((step) => (
                          <button
                            className={`animation-flow-step ${getStepState({
                              currentSlideIndex: props.currentSlideIndex,
                              currentStepIndex: props.currentStepIndex,
                              slideIndex: slide.slideIndex,
                              stepIndex: step.stepIndex,
                            })}`}
                            disabled={props.navigationPending}
                            key={`${slide.slideId}-${step.stepIndex}`}
                            type="button"
                            onClick={() =>
                              props.onNavigate({
                                kind: "animation-step",
                                stepIndex: step.stepIndex,
                                targetSlideIndex: slide.slideIndex,
                              })
                            }
                          >
                            <span className="animation-flow-step-index">{step.stepIndex}</span>
                            <span>
                              <strong>{step.triggerLabel}</strong>
                              <small>{step.effectsLabel}</small>
                            </span>
                            {isCurrentSlide ? (
                              <em>
                                {getStepState({
                                  currentSlideIndex: props.currentSlideIndex,
                                  currentStepIndex: props.currentStepIndex,
                                  slideIndex: slide.slideIndex,
                                  stepIndex: step.stepIndex,
                                }) === "current"
                                  ? "현재"
                                  : step.stepIndex < props.currentStepIndex
                                    ? "완료"
                                    : "예정"}
                              </em>
                            ) : null}
                          </button>
                        ))
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
        </>
      )}
    </section>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSlideTitle(slide: Slide) {
  return slide.title.trim() || `슬라이드 ${slide.order}`;
}

function getTriggerLabel(
  slide: Slide,
  animations: readonly PlannedSlideshowAnimation[],
) {
  const animationIds = new Set(animations.map((animation) => animation.animationId));
  const action = slide.actions.find(
    (candidate) =>
      candidate.effect.kind === "play-animation" &&
      animationIds.has(candidate.effect.animationId),
  );
  if (!action) return "클릭";
  if (action.trigger.kind === "cue") return `“${action.trigger.cue}” 발화`;
  const keywordId = action.trigger.keywordId;
  const keyword = slide.keywords.find((candidate) => candidate.keywordId === keywordId);
  return keyword ? `“${keyword.text}” 발화` : "키워드 발화";
}

function formatEffects(animations: readonly PlannedSlideshowAnimation[]) {
  const labels = Array.from(
    new Set(animations.map((animation) => formatAnimationType(animation.type))),
  );
  return labels.length > 0 ? labels.join(" · ") : null;
}

function formatAnimationType(type: PlannedSlideshowAnimation["type"]) {
  const labels: Record<PlannedSlideshowAnimation["type"], string> = {
    appear: "나타나기",
    disappear: "사라지기",
    "fade-in": "페이드 인",
    "fade-out": "페이드 아웃",
    rotate: "회전",
    "zoom-in": "확대",
    "zoom-out": "축소",
  };
  return labels[type];
}

function getStepState(input: {
  currentSlideIndex: number;
  currentStepIndex: number;
  slideIndex: number;
  stepIndex: number;
}) {
  if (input.slideIndex !== input.currentSlideIndex) return "available";
  if (input.stepIndex === input.currentStepIndex) return "current";
  return input.stepIndex < input.currentStepIndex ? "completed" : "upcoming";
}
