import type { ActivitySlide, Deck } from "@orbit/shared/deck";
import { useEffect, useState } from "react";

import { createActivityThemeStyle } from "../rendering/activityThemeStyle";
import "./activity-slide-editor.css";

export type ActivityPreviewRole = "audience" | "presenter";

export function ActivitySlidePreview(props: {
  role: ActivityPreviewRole;
  slide: ActivitySlide;
  theme?: Deck["theme"];
}) {
  const activity = props.slide.activity;
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const pagedQuestions = activity.template !== "poll" && activity.questions.length > 1;
  const visibleQuestionIndex = pagedQuestions
    ? Math.min(activeQuestionIndex, activity.questions.length - 1)
    : 0;
  const visibleQuestions = pagedQuestions
    ? activity.questions.slice(visibleQuestionIndex, visibleQuestionIndex + 1)
    : activity.questions;
  const visibleQuestionCount = pagedQuestions ? 1 : activity.questions.length;
  const questionDensity = visibleQuestionCount >= 5
    ? "dense"
    : visibleQuestionCount >= 3
      ? "compact"
      : "comfortable";

  useEffect(() => {
    setActiveQuestionIndex(0);
  }, [activity.activityId]);

  useEffect(() => {
    setActiveQuestionIndex((current) => Math.min(current, Math.max(activity.questions.length - 1, 0)));
  }, [activity.questions.length]);

  return (
    <section
      aria-label={`${props.role === "audience" ? "청중" : "발표자"} 참여 장표 미리보기`}
      className={`activity-slide-preview activity-slide-preview-${props.role} activity-slide-preview-${questionDensity}`}
      data-activity-system-layer="locked"
      data-activity-template={activity.template}
      style={createActivityThemeStyle(props.theme, props.slide.style)}
    >
      <div className="activity-slide-preview-copy">
        <h2>{activity.title}</h2>
        {activity.description ? <p>{activity.description}</p> : null}
      </div>
      <div
        className="activity-slide-preview-questions"
        data-paged={pagedQuestions ? "true" : "false"}
      >
        {pagedQuestions && visibleQuestionIndex > 0 ? (
          <button
            aria-label="이전 질문"
            className="activity-question-navigation activity-question-navigation-previous"
            onClick={() => setActiveQuestionIndex((current) => Math.max(current - 1, 0))}
            type="button"
          >
            이전 질문
          </button>
        ) : null}
        {visibleQuestions.map((question, visibleIndex) => {
          const index = pagedQuestions ? visibleQuestionIndex : visibleIndex;
          return (
            <article key={question.questionId}>
              <span>{index + 1}</span>
              <div>
                <strong>{question.prompt}</strong>
                {question.type === "rating" ? (
                  <div aria-hidden="true" className="activity-rating-preview-shell">
                    <div className="activity-rating-preview">
                      {[1, 2, 3, 4, 5].map((value) => <i key={value}>{value}</i>)}
                    </div>
                    <div className="activity-rating-preview-labels">
                      <span>{question.leftLabel}</span>
                      <span>{question.rightLabel}</span>
                    </div>
                  </div>
                ) : question.type === "free-text" ? (
                  <div aria-hidden="true" className="activity-text-preview">
                    <span>답변을 입력해 주세요</span>
                  </div>
                ) : (
                  <div aria-hidden="true" className="activity-choice-preview">
                    {question.options.map((option) => (
                      <i key={option.optionId}>{option.label}</i>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {pagedQuestions && visibleQuestionIndex < activity.questions.length - 1 ? (
          <button
            aria-label="다음 질문"
            className="activity-question-navigation activity-question-navigation-next"
            onClick={() =>
              setActiveQuestionIndex((current) => Math.min(current + 1, activity.questions.length - 1))
            }
            type="button"
          >
            다음 질문
          </button>
        ) : null}
      </div>
      {props.role === "presenter" ? (
        <div className="activity-presenter-preview-status">
          <strong>응답 0</strong>
          <span>대기 중</span>
        </div>
      ) : null}
    </section>
  );
}
