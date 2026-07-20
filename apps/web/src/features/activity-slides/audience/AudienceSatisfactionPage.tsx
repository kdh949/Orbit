import type {
  ActivityDefinition,
  ActivityResponse,
  ActivityRuntimeStatus,
  GetAudienceActivityResponse,
  UpsertActivityResponseRequest
} from "@orbit/shared";
import {
  IconArrowRight,
  IconCheck,
  IconClock,
  IconRefresh
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { WorkspaceContainer } from "../../../components/patterns";
import {
  OrbitBrand,
  OrbitButton,
  OrbitField,
  OrbitInput,
  OrbitTextarea
} from "../../../components/ui";
import { activityApi, ActivityApiError } from "../api/activityApi";
import {
  buildSatisfactionAnswers,
  createSatisfactionDraft,
  hasSatisfactionDraft,
  validateSatisfactionDraft,
  type SatisfactionDraft,
  type SatisfactionDraftErrors
} from "./activityFormModel";
import { connectAudienceActivityRealtime } from "../model/activityRealtimeClient";
import { ActivityPublicResults } from "../rendering/ActivityAudienceSlideRenderer";
import "./audience-satisfaction.css";

type AudienceMode = "loading" | "join" | "waiting" | "form" | "receipt" | "error";

export function AudienceSatisfactionPage(props: {
  activityId?: string;
  sessionId: string;
}) {
  const [mode, setMode] = useState<AudienceMode>("loading");
  const [accessMode, setAccessMode] = useState<"passcode" | "public">("passcode");
  const [sessionTitle, setSessionTitle] = useState("발표 참여");
  const [passcode, setPasscode] = useState("");
  const [hasAccess, setHasAccess] = useState(false);
  const [accessProjectId, setAccessProjectId] = useState<string | null>(null);
  const [current, setCurrent] = useState<GetAudienceActivityResponse | null>(null);
  const [pending, setPending] = useState<GetAudienceActivityResponse | null>(null);
  const [ignoredActivityId, setIgnoredActivityId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SatisfactionDraft>(() => createSatisfactionDraft(null));
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const mutationIdRef = useRef<string | null>(null);

  const showActivity = useCallback((activity: GetAudienceActivityResponse) => {
    setCurrent(activity);
    setDraft(createSatisfactionDraft(activity.ownResponse));
    setIsDirty(false);
    setPending(null);
    setIgnoredActivityId(null);
    setErrorMessage("");
    setMode(activity.ownResponse ? "receipt" : "form");
    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `/audience/${encodeURIComponent(props.sessionId)}/a/${encodeURIComponent(activity.activityId)}`
      );
    }
  }, [props.sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await activityApi.getAudiencePublicInfo(props.sessionId);
        if (cancelled) return;
        setAccessMode(info.session.accessMode);
        setSessionTitle(info.session.title);
        if (info.session.availability !== "open") {
          setErrorMessage(
            info.session.availability === "scheduled"
              ? "아직 입장 시간이 되지 않았습니다."
              : "종료된 발표 세션입니다."
          );
          setMode("error");
          return;
        }
        try {
          const access = await activityApi.getAudienceAccess(props.sessionId);
          if (!cancelled) {
            setAccessProjectId(access.session.projectId);
            setHasAccess(true);
          }
        } catch {
          if (!cancelled) setMode("join");
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toMessage(error, "참여 세션을 불러오지 못했습니다."));
          setMode("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [props.sessionId]);

  useEffect(() => {
    if (!hasAccess) return;
    let cancelled = false;
    void (async () => {
      try {
        const activity = props.activityId
          ? await activityApi.getAudienceActivity(props.sessionId, props.activityId)
          : (await activityApi.getAudienceActiveActivity(props.sessionId)).activity;
        if (cancelled) return;
        if (activity) showActivity(activity);
        else setMode("waiting");
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toMessage(error, "참여 장표를 불러오지 못했습니다."));
          setMode("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [hasAccess, props.activityId, props.sessionId, showActivity]);

  const refreshActiveActivity = useCallback(async () => {
    try {
      const next = await loadAudienceActivityRefresh(
        props.sessionId,
        current?.activityId ?? null
      );
      if (!next) {
        if (!current) setMode("waiting");
        return;
      }
      if (next.activityId === current?.activityId) {
        if (
          next.run.activityRunId === current.run.activityRunId &&
          next.run.revision <= current.run.revision
        ) {
          return;
        }
        setCurrent(next);
        return;
      }
      if (next.activityId === ignoredActivityId) return;
      if (mode === "form" && isDirty && hasSatisfactionDraft(draft)) {
        setPending(next);
        return;
      }
      showActivity(next);
    } catch (error) {
      if (error instanceof ActivityApiError && error.status === 401) {
        setCurrent(null);
        setHasAccess(false);
        setErrorMessage("종료되었거나 접근 시간이 지난 발표 세션입니다.");
        setMode("error");
        return;
      }
      // Reconnect and the next HTTP poll restore the authoritative snapshot.
    }
  }, [current, draft, ignoredActivityId, isDirty, mode, props.sessionId, showActivity]);
  const refreshActiveActivityRef = useRef(refreshActiveActivity);
  const realtimeConnectionRef = useRef<
    ReturnType<typeof connectAudienceActivityRealtime> | null
  >(null);

  useEffect(() => {
    refreshActiveActivityRef.current = refreshActiveActivity;
  }, [refreshActiveActivity]);

  useEffect(() => {
    if (!hasAccess || !accessProjectId) return;
    const connection = connectAudienceActivityRealtime({
      current: current
        ? { revision: current.run.revision, runId: current.run.activityRunId }
        : null,
      onRefresh: () => refreshActiveActivityRef.current(),
      projectId: accessProjectId,
      sessionId: props.sessionId
    });
    realtimeConnectionRef.current = connection;
    return () => {
      realtimeConnectionRef.current = null;
      connection.disconnect();
    };
  }, [accessProjectId, hasAccess, props.sessionId]);

  useEffect(() => {
    realtimeConnectionRef.current?.sync(
      current
        ? { revision: current.run.revision, runId: current.run.activityRunId }
        : null
    );
  }, [current?.run.activityRunId, current?.run.revision]);

  useEffect(() => {
    if (!hasAccess) return;
    const timer = window.setInterval(() => void refreshActiveActivity(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasAccess, refreshActiveActivity]);

  useEffect(() => {
    if (mode === "receipt" && typeof window !== "undefined") {
      window.scrollTo({ top: 0 });
    }
  }, [mode]);

  async function join() {
    if (accessMode === "passcode" && passcode.length !== 4) return;
    setErrorMessage("");
    setMode("loading");
    try {
      const access = await activityApi.joinAudience(
        props.sessionId,
        accessMode === "passcode" ? { passcode } : {}
      );
      setAccessProjectId(access.session.projectId);
      setHasAccess(true);
    } catch (error) {
      setErrorMessage(toMessage(error, "입장 비밀번호를 확인해 주세요."));
      setMode("join");
    }
  }

  async function submit(nextDraft: SatisfactionDraft) {
    if (!current) return;
    setIsSubmitting(true);
    setErrorMessage("");
    mutationIdRef.current ??= createMutationId();
    const input: UpsertActivityResponseRequest = {
      clientMutationId: mutationIdRef.current,
      answers: buildSatisfactionAnswers(current.run.definitionSnapshot, nextDraft),
      ...(current.run.definitionSnapshot.allowDisplayName
        ? { displayName: nextDraft.displayName.trim() || null }
        : {})
    };
    try {
      const result = await activityApi.upsertAudienceResponse(
        props.sessionId,
        current.activityId,
        input
      );
      mutationIdRef.current = null;
      setCurrent({
        ...current,
        ownResponse: result.response,
        run: { ...current.run, revision: result.runRevision }
      });
      setDraft(createSatisfactionDraft(result.response));
      setIsDirty(false);
      setMode("receipt");
    } catch (error) {
      setErrorMessage(toMessage(error, "응답을 저장하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="activity-audience-page">
      <header className="activity-audience-header">
        <WorkspaceContainer className="activity-audience-header-inner">
          <a
            aria-label="ORBIT 홈으로 이동"
            className="activity-audience-brand"
            href="/"
          >
            <OrbitBrand />
          </a>
          <span className="activity-audience-session-title">{sessionTitle}</span>
        </WorkspaceContainer>
      </header>

      <WorkspaceContainer as="section" className="activity-audience-main" width="content">
        {pending ? (
          <aside className="activity-transition-banner" role="status">
            <div>
              <strong>새 참여 장표가 열렸습니다</strong>
              <span>작성 중인 응답은 그대로 보관됩니다.</span>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  setIgnoredActivityId(pending.activityId);
                  setPending(null);
                }}
              >계속 작성</button>
              <button type="button" onClick={() => showActivity(pending)}>새 장표로 이동</button>
            </div>
          </aside>
        ) : null}

        {mode === "loading" ? <AudienceStatus icon={<IconRefresh />} title="참여 화면을 준비하고 있습니다" /> : null}
        {mode === "error" ? <AudienceStatus icon={<IconClock />} title={errorMessage} /> : null}
        {mode === "waiting" ? (
          <AudienceStatus
            icon={<IconClock />}
            title="다음 참여 장표를 기다리고 있습니다"
            description="발표자가 응답을 열면 이 화면에 자동으로 표시됩니다."
          />
        ) : null}
        {mode === "join" ? (
          <section className="activity-audience-card activity-join-card" aria-labelledby="audience-join-title">
            <span className="activity-audience-eyebrow">ORBIT</span>
            <h1 id="audience-join-title">발표에 참여하기</h1>
            <p>{sessionTitle}</p>
            {accessMode === "passcode" ? (
              <OrbitField id="activity-passcode" label="4자리 입장 비밀번호" error={errorMessage || undefined}>
                <OrbitInput
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]*"
                  value={passcode}
                  onChange={(event) => setPasscode(event.currentTarget.value.replace(/\D/g, "").slice(0, 4))}
                />
              </OrbitField>
            ) : errorMessage ? <p className="activity-form-error" role="alert">{errorMessage}</p> : null}
            <OrbitButton disabled={accessMode === "passcode" && passcode.length !== 4} onClick={() => void join()}>
              입장하기
            </OrbitButton>
          </section>
        ) : null}
        {current ? <AudiencePublicResultCard current={current} /> : null}
        {mode === "form" && current && current.run.status !== "results" ? (
          current.run.status === "open" ? (
            <AudienceSatisfactionForm
              definition={current.run.definitionSnapshot}
              draft={draft}
              errorMessage={errorMessage}
              isSubmitting={isSubmitting}
              onChange={(next) => {
                setDraft(next);
                setIsDirty(true);
              }}
              onSubmit={(next) => void submit(next)}
            />
          ) : (
            <AudienceStatus
              description={getAudienceActivityStatusCopy(current.run.status).description}
              icon={<IconClock />}
              title={getAudienceActivityStatusCopy(current.run.status).title}
            />
          )
        ) : null}
        {mode === "receipt" && current?.ownResponse && current.run.status !== "results" ? (
          <section className="activity-audience-card activity-receipt" aria-labelledby="activity-receipt-title">
            <span className="activity-receipt-icon"><IconCheck aria-hidden="true" /></span>
            <span className="activity-audience-eyebrow">{getAudienceTemplateCopy(current.run.definitionSnapshot).receiptEyebrow}</span>
            <h1 id="activity-receipt-title">{getAudienceTemplateCopy(current.run.definitionSnapshot).receiptTitle}</h1>
            <p>발표자가 응답을 마감하기 전까지 내용을 수정할 수 있습니다.</p>
            <dl>
              <div><dt>참여 장표</dt><dd>{current.run.definitionSnapshot.title}</dd></div>
              <div><dt>저장 상태</dt><dd>수정본 {current.ownResponse.revision}</dd></div>
            </dl>
            <AudienceResponseSummary
              definition={current.run.definitionSnapshot}
              response={current.ownResponse}
            />
            {current.run.status === "open" ? (
              <OrbitButton variant="secondary" icon={<IconRefresh aria-hidden="true" />} onClick={() => setMode("form")}>
                응답 수정
              </OrbitButton>
            ) : null}
            <span className="activity-receipt-wait">다음 참여 장표가 열리면 자동으로 이동합니다.</span>
          </section>
        ) : null}
      </WorkspaceContainer>
    </main>
  );
}

export function AudienceResponseSummary(props: {
  definition: ActivityDefinition;
  response: ActivityResponse;
}) {
  const rows = props.definition.questions.flatMap((question) => {
    const answer = props.response.answers.find(
      (candidate) => candidate.questionId === question.questionId
    );
    if (!answer) return [];
    return [{
      id: question.questionId,
      label: question.prompt,
      value: formatAudienceAnswer(question, answer)
    }];
  });

  if (rows.length === 0) return null;

  return (
    <section className="activity-receipt-answer-summary" aria-labelledby="activity-receipt-answer-title">
      <strong id="activity-receipt-answer-title">내가 제출한 답변</strong>
      <dl>
        {rows.map((row) => (
          <div key={row.id}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatAudienceAnswer(
  question: ActivityDefinition["questions"][number],
  answer: ActivityResponse["answers"][number]
) {
  if (answer.type === "rating") return `${answer.value} / 5`;
  if (answer.type === "free-text") return answer.text;
  if (question.type !== "single-choice" && question.type !== "multiple-choice") {
    return "저장됨";
  }
  if (answer.type === "single-choice") {
    return question.options.find((option) => option.optionId === answer.optionId)?.label ?? "선택 항목";
  }
  if (answer.type === "multiple-choice") {
    return answer.optionIds
      .map((optionId) => question.options.find((option) => option.optionId === optionId)?.label)
      .filter((label): label is string => Boolean(label))
      .join(", ");
  }
  return "저장됨";
}

export async function loadAudienceActivityRefresh(
  sessionId: string,
  currentActivityId: string | null
): Promise<GetAudienceActivityResponse | null> {
  const active = (await activityApi.getAudienceActiveActivity(sessionId)).activity;
  if (active || !currentActivityId) return active;
  return activityApi.getAudienceActivity(sessionId, currentActivityId);
}

export function getAudienceActivityStatusCopy(
  status: Exclude<ActivityRuntimeStatus, "open" | "results">
) {
  if (status === "draft") {
    return {
      title: "발표자가 응답을 준비하고 있습니다",
      description: "응답이 열리면 이 화면에 자동으로 표시됩니다."
    };
  }

  return {
    title: "응답이 마감되었습니다",
    description: undefined
  };
}

export function AudiencePublicResultCard(props: {
  current: GetAudienceActivityResponse;
}) {
  if (props.current.run.status !== "results" || !props.current.publicResult) return null;
  return (
    <section
      className="activity-audience-card activity-participant-results"
      aria-labelledby="activity-public-results-title"
    >
      <span className="activity-audience-eyebrow">응답 결과</span>
      <h1 id="activity-public-results-title">
        {props.current.run.definitionSnapshot.title} 결과
      </h1>
      <ActivityPublicResults
        activity={props.current.run.definitionSnapshot}
        result={props.current.publicResult}
      />
    </section>
  );
}

export function AudienceSatisfactionForm(props: {
  definition: ActivityDefinition;
  draft: SatisfactionDraft;
  errorMessage?: string;
  isSubmitting: boolean;
  onChange: (draft: SatisfactionDraft) => void;
  onSubmit: (draft: SatisfactionDraft) => void;
}) {
  const [errors, setErrors] = useState<SatisfactionDraftErrors>({});

  function submit() {
    const nextErrors = validateSatisfactionDraft(props.definition, props.draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) props.onSubmit(props.draft);
  }

  const templateCopy = getAudienceTemplateCopy(props.definition);

  return (
    <section
      aria-labelledby="activity-response-title"
      className="activity-audience-card activity-response-card"
      data-activity-template={props.definition.template}
    >
      <h1 id="activity-response-title">{props.definition.title}</h1>
      {props.definition.description ? <p className="activity-response-description">{props.definition.description}</p> : null}

      {Object.keys(errors).length > 0 ? (
        <div className="activity-error-summary" role="alert">
          <strong>응답을 확인해 주세요.</strong>
          <span>필수 문항에 답한 뒤 다시 제출해 주세요.</span>
        </div>
      ) : null}
      {props.errorMessage ? <p className="activity-form-error" role="alert">{props.errorMessage}</p> : null}

      <div className="activity-question-list">
        {props.definition.questions.map((question, index) => {
          const errorId = `activity-question-${question.questionId}-error`;
          if (question.type === "rating") {
            return (
              <fieldset
                aria-describedby={errors[question.questionId] ? errorId : undefined}
                className="activity-rating-field"
                key={question.questionId}
              >
                <legend><span>{index + 1}</span>{question.prompt}{question.required ? <em>필수</em> : null}</legend>
                <div className="activity-rating-options">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label key={value}>
                      <input
                        checked={props.draft.ratings[question.questionId] === value}
                        name={question.questionId}
                        type="radio"
                        value={value}
                        onChange={() => props.onChange({
                          ...props.draft,
                          ratings: { ...props.draft.ratings, [question.questionId]: value }
                        })}
                      />
                      <span>{value}</span>
                    </label>
                  ))}
                </div>
                <div className="activity-rating-labels"><span>{question.leftLabel}</span><span>{question.rightLabel}</span></div>
                {errors[question.questionId] ? <small id={errorId} role="alert">{errors[question.questionId]}</small> : null}
              </fieldset>
            );
          }
          if (question.type === "free-text") {
            return (
              <OrbitField
                className="activity-text-question"
                error={errors[question.questionId]}
                id={`activity-question-${question.questionId}`}
                key={question.questionId}
                label={<><span>{index + 1}</span>{question.prompt}{question.required ? <em>필수</em> : null}</>}
              >
                <OrbitTextarea
                  maxLength={2000}
                  placeholder="의견을 입력해 주세요."
                  rows={5}
                  value={props.draft.freeText[question.questionId] ?? ""}
                  onChange={(event) => props.onChange({
                    ...props.draft,
                    freeText: { ...props.draft.freeText, [question.questionId]: event.currentTarget.value }
                  })}
                />
              </OrbitField>
            );
          }
          if (question.type === "single-choice") {
            return (
              <fieldset
                aria-describedby={errors[question.questionId] ? errorId : undefined}
                className="activity-choice-field"
                key={question.questionId}
              >
                <legend><span>{index + 1}</span>{question.prompt}{question.required ? <em>필수</em> : null}</legend>
                <div className="activity-choice-options">
                  {question.options.map((option) => (
                    <label key={option.optionId}>
                      <input
                        checked={props.draft.singleChoice[question.questionId] === option.optionId}
                        name={question.questionId}
                        type="radio"
                        onChange={() => props.onChange({
                          ...props.draft,
                          singleChoice: {
                            ...props.draft.singleChoice,
                            [question.questionId]: option.optionId
                          }
                        })}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                {errors[question.questionId] ? <small id={errorId} role="alert">{errors[question.questionId]}</small> : null}
              </fieldset>
            );
          }
          if (question.type === "multiple-choice") {
            const selected = props.draft.multipleChoice[question.questionId] ?? [];
            const maxSelections = question.maxSelections ?? question.options.length;
            const selectionLimitReached = selected.length >= maxSelections;
            return (
              <fieldset
                aria-describedby={errors[question.questionId] ? errorId : undefined}
                className="activity-choice-field"
                key={question.questionId}
              >
                <legend><span>{index + 1}</span>{question.prompt}{question.required ? <em>필수</em> : null}</legend>
                <p>{selected.length}/{maxSelections}개 선택 · 최대 {maxSelections}개</p>
                <div className="activity-choice-options">
                  {question.options.map((option) => (
                    <label key={option.optionId}>
                      <input
                        checked={selected.includes(option.optionId)}
                        disabled={selectionLimitReached && !selected.includes(option.optionId)}
                        type="checkbox"
                        onChange={(event) => props.onChange({
                          ...props.draft,
                          multipleChoice: {
                            ...props.draft.multipleChoice,
                            [question.questionId]: event.currentTarget.checked
                              ? [...selected, option.optionId]
                              : selected.filter((optionId) => optionId !== option.optionId)
                          }
                        })}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                {errors[question.questionId] ? <small id={errorId} role="alert">{errors[question.questionId]}</small> : null}
              </fieldset>
            );
          }
          return null;
        })}
      </div>

      {props.definition.allowDisplayName ? (
        <OrbitField
          error={errors.displayName}
          hint="입력하지 않으면 익명으로 제출됩니다."
          id="activity-display-name"
          label="표시 이름 (선택)"
        >
          <OrbitInput
            maxLength={40}
            value={props.draft.displayName}
            onChange={(event) => props.onChange({ ...props.draft, displayName: event.currentTarget.value })}
          />
        </OrbitField>
      ) : null}

      <OrbitButton icon={<IconArrowRight aria-hidden="true" />} disabled={props.isSubmitting} onClick={submit}>
        {props.isSubmitting ? "저장 중" : templateCopy.submitLabel}
      </OrbitButton>
    </section>
  );
}

export function getAudienceTemplateCopy(definition: ActivityDefinition) {
  if (definition.template === "pre-question") {
    return {
      receiptEyebrow: "QUESTION SENT",
      receiptTitle: "질문을 보냈습니다",
      submitLabel: "질문 보내기"
    };
  }
  if (definition.template === "poll") {
    return {
      receiptEyebrow: "VOTE SAVED",
      receiptTitle: "투표가 제출되었습니다",
      submitLabel: "투표 제출"
    };
  }
  return {
    receiptEyebrow: "RESPONSE SAVED",
    receiptTitle: "의견이 저장되었습니다",
    submitLabel: "의견 제출"
  };
}

function AudienceStatus(props: { description?: string; icon: React.ReactNode; title: string }) {
  return (
    <section className="activity-audience-card activity-audience-status" role="status">
      <span>{props.icon}</span>
      <h1>{props.title}</h1>
      {props.description ? <p>{props.description}</p> : null}
    </section>
  );
}

function createMutationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `activity-mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
