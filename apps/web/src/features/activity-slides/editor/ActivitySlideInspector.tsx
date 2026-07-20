import type { ActivityDefinition, ActivityQuestion, ActivityQuestionType, ActivitySlide, Deck } from "@orbit/shared";
import { IconArrowDown, IconArrowUp, IconExternalLink, IconMessageQuestion, IconTrash } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  OrbitButton,
  OrbitButtonLink,
  OrbitDialog,
  OrbitField,
  OrbitInput,
  OrbitSelect,
  OrbitStatus,
  OrbitTextarea
} from "../../../components/ui";
import { ActivitySlidePreview } from "./ActivitySlidePreview";
import { ActivityEditorOperationsPanel } from "./ActivityEditorOperationsPanel";
import { ActivityPreQuestionInbox } from "./ActivityPreQuestionInbox";
import { useActivityEditorRuntime } from "./useActivityEditorRuntime";

const templateLabels = {
  "pre-question": "사전 질문",
  poll: "실시간 투표",
  satisfaction: "만족도 조사"
} as const;

const questionTypeLabels: Record<ActivityQuestionType, string> = {
  rating: "1~5점",
  "single-choice": "하나 선택",
  "multiple-choice": "여러 개 선택",
  "free-text": "직접 입력"
};

const templateDescriptions = {
  "pre-question": "발표 전에 청중에게 받을 질문을 준비하세요.",
  poll: "청중이 하나를 고를 수 있도록 질문과 답변을 준비하세요.",
  satisfaction: "발표가 끝난 뒤 청중에게 물어볼 내용을 준비하세요."
} as const;

export function ActivitySlideInspector(props: {
  deckId?: string;
  onOpenAudienceLink?: () => void;
  onChange: (activity: ActivityDefinition) => void;
  projectId?: string;
  slide: ActivitySlide;
  theme?: Deck["theme"];
}) {
  const [supersedeDialogOpen, setSupersedeDialogOpen] = useState(false);
  const activity = props.slide.activity;
  const audiencePreviewHref = props.projectId
    ? `/project/${encodeURIComponent(props.projectId)}/activity-preview/${encodeURIComponent(activity.activityId)}`
    : null;
  const editorRuntime = useActivityEditorRuntime({
    activityId: activity.activityId,
    deckId: props.deckId,
    projectId: props.projectId
  });

  function updateActivity(patch: Partial<ActivityDefinition>) {
    props.onChange({ ...activity, ...patch });
  }

  function updateQuestion(questionId: string, next: ActivityQuestion) {
    updateActivity({
      questions: activity.questions.map((question) => (question.questionId === questionId ? next : question))
    });
  }

  return (
    <div className="activity-slide-inspector">
      <div className="activity-inspector-heading">
        <IconMessageQuestion aria-hidden="true" size={24} />
        <div>
          <h3>{templateLabels[activity.template]}</h3>
          <p>{templateDescriptions[activity.template]}</p>
        </div>
      </div>

      <fieldset
        className="activity-semantic-fields"
        data-semantic-locked={editorRuntime.locked ? "true" : "false"}
        disabled={editorRuntime.locked}
      >
        <section className="activity-inspector-section">
          <div className="activity-inspector-section-heading">
            <strong>화면에 먼저 보이는 내용</strong>
            <span>청중이 장표를 열었을 때 맨 위에 보여지는 문구입니다.</span>
          </div>
          <OrbitField id="activity-slide-title" label="슬라이드 제목">
            <OrbitInput
              maxLength={120}
              placeholder="예: 발표 전에 궁금한 점을 알려주세요"
              value={activity.title}
              onChange={(event) => updateActivity({ title: event.currentTarget.value })}
            />
          </OrbitField>
          <OrbitField id="activity-slide-description" label="설명 문구">
            <OrbitTextarea
              maxLength={500}
              placeholder="청중이 무엇을 하면 되는지 짧게 알려주세요."
              rows={3}
              value={activity.description}
              onChange={(event) => updateActivity({ description: event.currentTarget.value })}
            />
          </OrbitField>
        </section>

        <section className="activity-inspector-section">
          <div className="activity-inspector-section-heading">
            <strong>참여자 질문 구성</strong>
            <span>질문/보기는 에디터 미리보기와 실제 청중 화면에 바로 반영됩니다.</span>
          </div>
          <div className="activity-inspector-questions">
            {activity.questions.map((question, index) => (
              <section className="activity-question-editor" key={question.questionId}>
                <div className="activity-question-editor-heading">
                  <div className="activity-question-editor-title">
                    <strong>질문 {index + 1}</strong>
                    <OrbitStatus>{questionTypeLabels[question.type]}</OrbitStatus>
                  </div>
                  <div>
                    <button
                      aria-label={`질문 ${index + 1} 위로 이동`}
                      title="위로 옮기기"
                      disabled={index === 0}
                      type="button"
                      onClick={() =>
                        updateActivity({
                          questions: moveQuestion(activity.questions, index, -1)
                        })
                      }
                    >
                      <IconArrowUp aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={`질문 ${index + 1} 아래로 이동`}
                      title="아래로 옮기기"
                      disabled={index === activity.questions.length - 1}
                      type="button"
                      onClick={() =>
                        updateActivity({
                          questions: moveQuestion(activity.questions, index, 1)
                        })
                      }
                    >
                      <IconArrowDown aria-hidden="true" size={16} />
                    </button>
                    {activity.template !== "poll" ? (
                      <button
                        aria-label={`질문 ${index + 1} 삭제`}
                        disabled={activity.questions.length === 1}
                        title="질문 삭제"
                        type="button"
                        onClick={() =>
                          updateActivity({
                            questions: activity.questions.filter(
                              (candidate) => candidate.questionId !== question.questionId
                            )
                          })
                        }
                      >
                        <IconTrash aria-hidden="true" size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
                {activity.template === "satisfaction" ? (
                  <OrbitField id={`activity-question-${question.questionId}-type`} label="답하는 방법">
                    <OrbitSelect
                      value={question.type}
                      onChange={(event) =>
                        updateQuestion(
                          question.questionId,
                          convertQuestionType(activity, question, event.currentTarget.value as ActivityQuestionType)
                        )
                      }
                    >
                      {Object.entries(questionTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </OrbitSelect>
                  </OrbitField>
                ) : null}
                <OrbitField
                  hint="변경 즉시 에디터 미리보기에 반영돼요."
                  id={`activity-question-${question.questionId}-prompt`}
                  label="질문 내용"
                >
                  <OrbitTextarea
                    maxLength={500}
                    rows={2}
                    value={question.prompt}
                    onChange={(event) =>
                      updateQuestion(question.questionId, {
                        ...question,
                        prompt: event.currentTarget.value
                      })
                    }
                  />
                </OrbitField>
                <div className="activity-question-toggles">
                  <label className="activity-inspector-check">
                    <input
                      checked={question.required}
                      type="checkbox"
                      onChange={(event) =>
                        updateQuestion(question.questionId, {
                          ...question,
                          required: event.currentTarget.checked
                        })
                      }
                    />
                    꼭 답하게 하기
                  </label>
                </div>
                {question.type === "rating" ? (
                  <div className="activity-rating-label-editor">
                    <OrbitField id={`activity-question-${question.questionId}-left-label`} label="1점 옆 문구">
                      <OrbitInput
                        maxLength={40}
                        value={question.leftLabel}
                        onChange={(event) =>
                          updateQuestion(question.questionId, {
                            ...question,
                            leftLabel: event.currentTarget.value
                          })
                        }
                      />
                    </OrbitField>
                    <OrbitField id={`activity-question-${question.questionId}-right-label`} label="5점 옆 문구">
                      <OrbitInput
                        maxLength={40}
                        value={question.rightLabel}
                        onChange={(event) =>
                          updateQuestion(question.questionId, {
                            ...question,
                            rightLabel: event.currentTarget.value
                          })
                        }
                      />
                    </OrbitField>
                  </div>
                ) : null}
                {question.type === "single-choice" || question.type === "multiple-choice" ? (
                  <div className="activity-option-editor">
                    {question.options.map((option, optionIndex) => (
                      <label key={option.optionId}>
                        답변 {optionIndex + 1}
                        <span>
                          <ActivityOptionInput
                            id={`activity-option-${option.optionId}`}
                            maxLength={100}
                            value={option.label}
                            onValueChange={(label) =>
                              updateQuestion(question.questionId, {
                                ...question,
                                options: question.options.map((candidate) =>
                                  candidate.optionId === option.optionId
                                    ? {
                                        ...candidate,
                                        label
                                      }
                                    : candidate
                                )
                              })
                            }
                          />
                          <button
                            aria-label={`선택지 ${optionIndex + 1} 위로 이동`}
                            disabled={optionIndex === 0}
                            type="button"
                            onClick={() =>
                              updateQuestion(question.questionId, moveQuestionOption(question, optionIndex, -1))
                            }
                          >
                            <IconArrowUp aria-hidden="true" size={16} />
                          </button>
                          <button
                            aria-label={`선택지 ${optionIndex + 1} 아래로 이동`}
                            disabled={optionIndex === question.options.length - 1}
                            type="button"
                            onClick={() =>
                              updateQuestion(question.questionId, moveQuestionOption(question, optionIndex, 1))
                            }
                          >
                            <IconArrowDown aria-hidden="true" size={16} />
                          </button>
                          <button
                            aria-label={`선택지 ${optionIndex + 1} 삭제`}
                            disabled={question.options.length <= 2}
                            type="button"
                            onClick={() =>
                              updateQuestion(question.questionId, removeQuestionOption(question, option.optionId))
                            }
                          >
                            삭제
                          </button>
                        </span>
                      </label>
                    ))}
                    {question.type === "multiple-choice" ? (
                      <OrbitField
                        hint={`청중은 전체 ${question.options.length}개 중 설정한 개수까지만 선택할 수 있습니다.`}
                        id={`activity-question-${question.questionId}-max-selections`}
                        label="고를 수 있는 답변 수"
                      >
                        <OrbitSelect
                          value={String(question.maxSelections ?? question.options.length)}
                          onChange={(event) =>
                            updateQuestion(question.questionId, {
                              ...question,
                              maxSelections: Number(event.currentTarget.value)
                            })
                          }
                        >
                          {question.options.map((_, selectionIndex) => (
                            <option key={selectionIndex + 1} value={selectionIndex + 1}>
                              최대 {selectionIndex + 1}개
                            </option>
                          ))}
                        </OrbitSelect>
                      </OrbitField>
                    ) : null}
                    <button
                      disabled={question.options.length >= 8}
                      type="button"
                      onClick={() =>
                        updateQuestion(question.questionId, {
                          ...question,
                          options: [...question.options, createOption(activity, question)]
                        })
                      }
                    >
                      답변 추가
                    </button>
                  </div>
                ) : null}
              </section>
            ))}
            {activity.template !== "poll" ? (
              <button
                disabled={activity.questions.length >= 5}
                type="button"
                onClick={() =>
                  updateActivity({
                    questions: [...activity.questions, createQuestion(activity, "free-text")]
                  })
                }
              >
                질문 추가 <span>{activity.questions.length}/5</span>
              </button>
            ) : null}
          </div>

          <label className="activity-inspector-check activity-display-name-check">
            <input
              checked={activity.allowDisplayName}
              type="checkbox"
              onChange={(event) =>
                updateActivity({
                  allowDisplayName: event.currentTarget.checked
                })
              }
            />
            참여자 닉네임도 함께 받기
          </label>
        </section>
      </fieldset>

      {editorRuntime.locked && editorRuntime.runtime ? (
        <section className="activity-definition-lock" role="status">
          <strong>응답 후에는 질문 수정이 잠깁니다.</strong>
          <p>
            지금까지 {editorRuntime.runtime.run.responseCount}개 응답은 유지되며, 새 질문으로 다시 시작해야
            이어서 받을 수 있어요.
          </p>
          <OrbitButton
            disabled={editorRuntime.pending}
            onClick={() => setSupersedeDialogOpen(true)}
            type="button"
            variant="secondary"
          >
            새 질문으로 다시 시작
          </OrbitButton>
        </section>
      ) : null}
      {editorRuntime.error ? (
        <p className="activity-editor-runtime-error" role="alert">
          {editorRuntime.error}
        </p>
      ) : null}
      <ActivityEditorOperationsPanel
        onOpenAudienceLink={props.onOpenAudienceLink}
        onUpdateStatus={(status) => void editorRuntime.updateStatus(status)}
        pending={editorRuntime.pending}
        projectId={props.projectId}
        runtime={editorRuntime.runtime}
        slide={props.slide}
      />

      {audiencePreviewHref ? (
        <OrbitButtonLink
          className="activity-audience-preview-link"
          href={audiencePreviewHref}
          icon={<IconExternalLink aria-hidden="true" size={18} />}
          rel="noreferrer"
          target="_blank"
          variant="secondary"
        >
          청중 화면 새 창에서 보기
        </OrbitButtonLink>
      ) : null}

      <div className="activity-inspector-section-heading">
        <strong>발표자 화면 미리보기</strong>
        <span>발표 중 확인하게 될 응답 상태를 미리 보여줍니다.</span>
      </div>
      <ActivitySlidePreview role="presenter" slide={props.slide} theme={props.theme} />

      <div aria-label="자동으로 만들어지는 응답 화면" className="activity-system-layer-lock">
        <strong>응답 화면은 자동으로 만들어져요.</strong>
        <span>질문/선택지/필수항목 설정은 왼쪽 미리보기와 연결 화면에 자동 반영됩니다.</span>
      </div>
      {activity.template === "pre-question" && props.deckId && props.projectId ? (
        <ActivityPreQuestionInbox
          deckId={props.deckId}
          projectId={props.projectId}
          responseCount={editorRuntime.runtime?.run.responseCount ?? 0}
          slide={props.slide}
        />
      ) : null}
      <OrbitDialog
        closeDisabled={editorRuntime.pending}
        description="지금까지 받은 응답은 그대로 보관됩니다. 바꾼 질문에는 새 응답이 따로 쌓입니다."
        footer={
          <>
            <OrbitButton
              disabled={editorRuntime.pending}
              onClick={() => setSupersedeDialogOpen(false)}
              type="button"
              variant="secondary"
            >
              취소
            </OrbitButton>
            <OrbitButton
              disabled={editorRuntime.pending}
              onClick={() => {
                void editorRuntime.supersede().then((created) => {
                  if (created) setSupersedeDialogOpen(false);
                });
              }}
              type="button"
            >
              {editorRuntime.pending ? "준비하는 중" : "새 질문으로 다시 받기"}
            </OrbitButton>
          </>
        }
        onClose={() => setSupersedeDialogOpen(false)}
        open={supersedeDialogOpen}
        title="질문을 바꾸고 새로 받을까요?"
      >
        <p>현재 질문을 복사한 뒤 다시 편집할 수 있게 합니다.</p>
      </OrbitDialog>
    </div>
  );
}

function ActivityOptionInput(props: {
  id: string;
  maxLength: number;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const [draftValue, setDraftValue] = useState(props.value);
  const [isFocused, setIsFocused] = useState(false);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!isFocused) setDraftValue(props.value);
  }, [isFocused, props.value]);

  function updateDraftValue(nextValue: string, isComposing: boolean) {
    setDraftValue(nextValue);
    if (isComposing || nextValue.trim().length === 0) return;
    props.onValueChange(nextValue);
  }

  return (
    <OrbitInput
      id={props.id}
      maxLength={props.maxLength}
      value={draftValue}
      onBlur={() => {
        setIsFocused(false);
        if (draftValue.trim().length > 0) props.onValueChange(draftValue);
      }}
      onChange={(event) => {
        updateDraftValue(event.currentTarget.value, isComposingRef.current);
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        isComposingRef.current = false;
        updateDraftValue(event.currentTarget.value, false);
      }}
      onFocus={() => setIsFocused(true)}
    />
  );
}

export function moveQuestion(questions: ActivityQuestion[], index: number, direction: -1 | 1): ActivityQuestion[] {
  const target = index + direction;
  if (target < 0 || target >= questions.length) return questions;
  const next = [...questions];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function moveQuestionOption(question: ActivityQuestion, index: number, direction: -1 | 1): ActivityQuestion {
  if (question.type !== "single-choice" && question.type !== "multiple-choice") {
    return question;
  }
  const target = index + direction;
  if (target < 0 || target >= question.options.length) return question;
  const options = [...question.options];
  [options[index], options[target]] = [options[target]!, options[index]!];
  return { ...question, options };
}

export function convertQuestionType(
  activity: ActivityDefinition,
  question: ActivityQuestion,
  type: ActivityQuestionType
): ActivityQuestion {
  const base = {
    questionId: question.questionId,
    prompt: question.prompt,
    required: question.required
  };
  if (type === "rating")
    return {
      ...base,
      type,
      leftLabel: "전혀 아니요",
      rightLabel: "매우 그래요"
    };
  if (type === "free-text") return { ...base, type };
  const options =
    question.type === "single-choice" || question.type === "multiple-choice"
      ? question.options
      : [createOption(activity, question), createOption(activity, question, 1)];
  if (type === "multiple-choice") return { ...base, type, options, maxSelections: options.length };
  return { ...base, type, options };
}

export function removeQuestionOption(question: ActivityQuestion, optionId: string): ActivityQuestion {
  if (question.type !== "single-choice" && question.type !== "multiple-choice") {
    return question;
  }
  const options = question.options.filter((option) => option.optionId !== optionId);
  if (question.type === "multiple-choice" && question.maxSelections !== undefined) {
    return {
      ...question,
      options,
      maxSelections: Math.min(question.maxSelections, options.length)
    };
  }
  return { ...question, options };
}

function createQuestion(activity: ActivityDefinition, type: ActivityQuestionType): ActivityQuestion {
  const used = new Set(activity.questions.map((question) => question.questionId));
  const questionId = nextLocalId("question_", activity.activityId, used);
  return convertQuestionType(activity, { questionId, type: "free-text", prompt: "새 질문", required: false }, type);
}

function createOption(activity: ActivityDefinition, question: Pick<ActivityQuestion, "questionId">, offset = 0) {
  const used = new Set(
    activity.questions.flatMap((candidate) =>
      candidate.type === "single-choice" || candidate.type === "multiple-choice"
        ? candidate.options.map((option) => option.optionId)
        : []
    )
  );
  for (let index = 0; index < offset; index += 1) {
    used.add(nextLocalId("option_", question.questionId, used));
  }
  return {
    optionId: nextLocalId("option_", question.questionId, used),
    label: `선택 ${used.size + 1}`
  };
}

function nextLocalId(prefix: string, seed: string, used: Set<string>) {
  const normalized = seed.replace(/[^A-Za-z0-9_-]/g, "_");
  let index = 1;
  while (used.has(`${prefix}${normalized}_${index}`)) index += 1;
  return `${prefix}${normalized}_${index}`;
}
