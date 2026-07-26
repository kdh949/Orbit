import type { Deck } from "@orbit/shared/deck";
import { IconArrowRight, IconArrowsMaximize, IconX } from "@tabler/icons-react";
import { ReadOnlySlideCanvas } from "../../../slides/rendering";
import {
  canApplyDesignProposal,
  type DesignProposalLifecycle,
} from "../designProposalLifecycle";

type DesignProposalCompareCardProps = {
  afterDeck: Deck;
  beforeDeck: Deck;
  lifecycle: DesignProposalLifecycle;
  onApply: () => void;
  onClose: () => void;
  onPreview: () => void;
  slideId: string;
  summary: string;
  warnings: string[];
};

export function DesignProposalCompareCard(props: DesignProposalCompareCardProps) {
  const beforeSlide = props.beforeDeck.slides.find(
    (slide) => slide.slideId === props.slideId
  );
  const afterSlide = props.afterDeck.slides.find(
    (slide) => slide.slideId === props.slideId
  );
  if (!beforeSlide || !afterSlide) {
    return <p role="alert">비교할 슬라이드를 찾지 못했습니다. 제안을 다시 생성해 주세요.</p>;
  }

  const beforeScale = Math.min(0.12, 128 / props.beforeDeck.canvas.width);
  const afterScale = Math.min(0.12, 128 / props.afterDeck.canvas.width);
  const isApplying = props.lifecycle === "applying";
  const isStale = props.lifecycle === "stale";
  const canApply = canApplyDesignProposal(props.lifecycle);

  return (
    <section className="design-proposal-compare-card" aria-label="디자인 제안 Before/After">
      <header className="design-proposal-compare-header">
        <div>
          <strong>
            {isStale
              ? "원본이 변경된 제안"
              : props.lifecycle === "failed"
                ? "제안 적용 실패"
                : "디자인 제안 준비됨"}
          </strong>
          <span>{props.summary}</span>
        </div>
        <button aria-label="디자인 제안 닫기" type="button" onClick={props.onClose}>
          <IconX aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="design-proposal-inline-comparison">
        <figure>
          <figcaption>Before</figcaption>
          <div className="design-proposal-inline-slide">
            <ReadOnlySlideCanvas
              deck={props.beforeDeck}
              scale={beforeScale}
              slide={beforeSlide}
            />
          </div>
        </figure>
        <IconArrowRight
          aria-hidden="true"
          className="design-proposal-compare-arrow"
          size={18}
        />
        <figure>
          <figcaption>After</figcaption>
          <div className="design-proposal-inline-slide after">
            <ReadOnlySlideCanvas
              deck={props.afterDeck}
              scale={afterScale}
              slide={afterSlide}
            />
          </div>
        </figure>
      </div>

      {isStale ? (
        <p className="design-proposal-stale-message" role="status">
          제안 생성 후 슬라이드가 변경되었습니다. 적용하려면 다시 생성해 주세요.
        </p>
      ) : null}
      {props.lifecycle === "failed" ? (
        <p className="design-proposal-failed-message" role="alert">
          제안을 적용하지 못했습니다. 다시 적용할 수 있습니다.
        </p>
      ) : null}
      {props.warnings.length ? (
        <p className="design-proposal-inline-warning">{props.warnings.join(" ")}</p>
      ) : null}

      <footer className="design-proposal-inline-actions">
        <button type="button" onClick={props.onPreview}>
          <IconArrowsMaximize aria-hidden="true" size={16} />
          미리보기
        </button>
        <button
          className="primary"
          disabled={!canApply}
          type="button"
          onClick={props.onApply}
        >
          {isApplying
            ? "적용 중..."
            : props.lifecycle === "failed"
              ? "다시 적용"
              : "적용"}
        </button>
      </footer>
    </section>
  );
}
