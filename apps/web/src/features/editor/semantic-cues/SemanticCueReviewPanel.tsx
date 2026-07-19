import type { SemanticCue, Slide } from "@orbit/shared";
import type { FormEvent } from "react";

import {
  applySemanticCueReviewChoice,
  buildSemanticCueReviewModel,
  createManualSemanticCue,
  editSemanticCueMeaning,
  replaceSemanticCue,
  type SemanticCueReviewChoice
} from "./semanticCueReviewModel";
import { SemanticCueReviewCard } from "./SemanticCueReviewCard";

export function SemanticCueReviewPanel(props: {
  createCueId?: () => string;
  extractionState?: SemanticCueExtractionUiState;
  onChange: (semanticCues: SemanticCue[]) => void;
  onExtract?: (force: boolean) => void;
  slide: Slide | null;
}) {
  if (!props.slide) {
    return (
      <section className="semantic-cue-review-panel empty" role="status">
        <h3>발표 메시지 검토</h3>
        <p>검토할 슬라이드를 먼저 선택하세요.</p>
      </section>
    );
  }

  const { slide } = props;
  const model = buildSemanticCueReviewModel(slide);
  const extractionState = props.extractionState ?? {
    status: "idle" as const,
    message: ""
  };
  const isExtracting = extractionState.status === "running";

  function changeReviewChoice(
    cueId: string,
    choice: SemanticCueReviewChoice
  ) {
    props.onChange(
      replaceSemanticCue(slide.semanticCues, cueId, (cue) =>
        applySemanticCueReviewChoice(cue, choice)
      )
    );
  }

  function editMeaning(cueId: string, meaning: string) {
    props.onChange(
      replaceSemanticCue(slide.semanticCues, cueId, (cue) =>
        editSemanticCueMeaning(cue, meaning)
      )
    );
  }

  function submitManualCue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const meaning = readNamedInput(event.currentTarget, "manualMeaning").trim();
    if (!meaning) {
      return;
    }
    props.onChange([
      ...slide.semanticCues,
      createManualSemanticCue({
        cueId: props.createCueId?.(),
        meaning,
        slideId: slide.slideId
      })
    ]);
    event.currentTarget.reset();
  }

  return (
    <section
      aria-labelledby="semantic-cue-review-heading"
      className="semantic-cue-review-panel"
    >
      <header className="semantic-cue-review-header">
        <div>
          <span>현재 슬라이드</span>
          <h3 id="semantic-cue-review-heading">발표 메시지 검토</h3>
        </div>
        <span className="semantic-cue-review-count">
          {model.approvedCount}/{model.cues.length} 승인
        </span>
      </header>

      <p className="semantic-cue-review-description">
        리허설에서 확인할 메시지를 핵심·보조로 승인하거나 평가에서 제외하세요.
      </p>

      {props.onExtract ? (
        <div className="semantic-cue-extraction-action">
          <button
            className="semantic-cue-extract-button"
            disabled={isExtracting}
            type="button"
            onClick={() => props.onExtract?.(slide.semanticCues.length > 0)}
          >
            {slide.semanticCues.length > 0
              ? "AI로 전체 덱 다시 분석"
              : "AI로 발표 메시지 만들기"}
          </button>
          <small>
            슬라이드 내용과 발표 대본을 함께 분석해 전체 덱의 메시지 후보를 만듭니다.
          </small>
          {extractionState.message ? (
            <p
              className={`semantic-cue-extraction-status semantic-cue-extraction-status--${extractionState.status}`}
              role="status"
            >
              {extractionState.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <dl className="semantic-cue-review-summary" aria-label="검토 현황">
        <div>
          <dt>검토 필요</dt>
          <dd>{model.suggestedCount}</dd>
        </div>
        <div>
          <dt>핵심</dt>
          <dd>{model.coreCount}</dd>
        </div>
        <div>
          <dt>제외</dt>
          <dd>{model.excludedCount}</dd>
        </div>
      </dl>

      {model.timingMessage ? (
        <p className="semantic-cue-timing-warning" role="status">
          <strong>시간 점검</strong>
          {model.timingMessage}
        </p>
      ) : null}

      {model.cues.length > 0 ? (
        <ol className="semantic-cue-review-list" aria-label="발표 메시지 후보">
          {model.cues.map((item, index) => (
            <li key={item.cue.cueId}>
              <SemanticCueReviewCard
                index={index}
                item={item}
                onEditMeaning={(meaning) => editMeaning(item.cue.cueId, meaning)}
                onReviewChoice={(choice) =>
                  changeReviewChoice(item.cue.cueId, choice)
                }
              />
            </li>
          ))}
        </ol>
      ) : (
        <div className="semantic-cue-review-empty" role="status">
          <strong>아직 제안된 발표 메시지가 없습니다.</strong>
          <p>직접 추가하거나 AI 발표 메시지 분석을 먼저 실행하세요.</p>
        </div>
      )}

      <form className="semantic-cue-manual-form" onSubmit={submitManualCue}>
        <label htmlFor="semantic-cue-manual-meaning">직접 메시지 추가</label>
        <p id="semantic-cue-manual-description">
          AI 제안에 없지만 발표에서 꼭 확인하고 싶은 내용을 적으세요.
        </p>
        <div>
          <input
            id="semantic-cue-manual-meaning"
            aria-describedby="semantic-cue-manual-description"
            maxLength={240}
            name="manualMeaning"
            placeholder="예: 발표자는 가격 인상의 고객 가치를 설명했다"
            required
            type="text"
          />
          <button type="submit">추가</button>
        </div>
      </form>
    </section>
  );
}

export type SemanticCueExtractionUiState = {
  status: "idle" | "running" | "succeeded" | "error";
  message: string;
};

function readNamedInput(form: HTMLFormElement, name: string): string {
  const control = form.elements.namedItem(name);
  return control && "value" in control && typeof control.value === "string"
    ? control.value
    : "";
}
