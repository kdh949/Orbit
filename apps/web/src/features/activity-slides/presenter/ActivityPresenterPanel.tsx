import type {
  ActivityPresenterResult,
  ActivityRun,
  ActivityRuntimeStatus,
  ActivitySlide,
  ModerateActivityTextRequest
} from "@orbit/shared";
import {
  IconChartBar,
  IconExternalLink,
  IconPlayerPause,
  IconPlayerPlay,
  IconPresentationAnalytics,
  IconUsers
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { activityApi, ActivityApiError } from "../api/activityApi";
import { startSequentialPolling } from "../model/sequentialPolling";
import {
  ActivityRatingDistribution,
  canonicalActivityUrl
} from "../rendering/ActivityAudienceSlideRenderer";
import "./activity-presenter-panel.css";

type ActivityPresenterRuntime = {
  audienceUrl: string;
  result: ActivityPresenterResult;
  run: ActivityRun;
  sessionId: string;
};

export function ActivityPresenterPanel(props: {
  autoStart?: boolean;
  deckId: string;
  deckVersion: number;
  projectId: string;
  slide: ActivitySlide;
}) {
  const [runtime, setRuntime] = useState<ActivityPresenterRuntime | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [moderatingEntryId, setModeratingEntryId] = useState<string | null>(null);
  const activityId = props.slide.activity.activityId;
  const sessionRecovery = useRef(createActivitySessionRecoveryTracker());

  useEffect(() => {
    let cancelled = false;
    const recoveryIdentity = JSON.stringify([
      props.projectId,
      props.deckId,
      props.deckVersion,
      activityId
    ]);

    const setup = async () => {
      try {
        const nextRuntime = await loadActivityPresenterRuntime({
          activityId,
          autoStart: props.autoStart ?? false,
          deckId: props.deckId,
          deckVersion: props.deckVersion,
          projectId: props.projectId,
          finishInitialSessionCreation: () =>
            sessionRecovery.current.finishInitialCreation(recoveryIdentity),
          tryInitialSessionCreation: () =>
            sessionRecovery.current.tryInitialCreation(recoveryIdentity),
          tryStaleSessionReplacement: () =>
            sessionRecovery.current.tryStaleReplacement(recoveryIdentity)
        });
        if (!nextRuntime) {
          if (!cancelled) {
            setRuntime(null);
            setError("청중 링크에서 발표 세션을 먼저 시작해주세요.");
          }
          return;
        }
        if (!cancelled) {
          setRuntime(nextRuntime);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(activityErrorMessage(cause));
      }
    };

    const stopPolling = startSequentialPolling(setup, 1000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [activityId, props.autoStart, props.deckId, props.deckVersion, props.projectId]);

  const primary = useMemo(
    () => getActivityPrimaryCommand(runtime?.run.status ?? "draft"),
    [runtime?.run.status]
  );
  const updateStatus = async (nextStatus = primary.nextStatus) => {
    if (!runtime || pending) return;
    setPending(true);
    setError("");
    try {
      const { run } = await activityApi.updateRunStatus(
        props.projectId,
        runtime.sessionId,
        runtime.run.activityRunId,
        { status: nextStatus, expectedRevision: runtime.run.revision }
      );
      const { result } = await activityApi.getPresenterResult(
        props.projectId,
        runtime.sessionId,
        run.activityRunId
      );
      setRuntime((current) => current ? { ...current, result, run } : current);
    } catch (cause) {
      setError(activityErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const moderateText = async (
    entryId: string,
    patch: Pick<ModerateActivityTextRequest, "moderationStatus" | "answered">
  ) => {
    if (!runtime || moderatingEntryId) return;
    const previous = runtime;
    setModeratingEntryId(entryId);
    setError("");
    setRuntime({
      ...runtime,
      result: {
        ...runtime.result,
        textEntries: runtime.result.textEntries.map((entry) => entry.entryId === entryId
          ? {
              ...entry,
              ...(patch.moderationStatus ? { moderationStatus: patch.moderationStatus } : {}),
              ...(patch.answered !== undefined
                ? { answeredAt: patch.answered ? new Date().toISOString() : null }
                : {})
            }
          : entry)
      }
    });
    try {
      const response = await activityApi.moderateTextEntry(
        props.projectId,
        runtime.sessionId,
        entryId,
        { ...patch, expectedRevision: runtime.result.revision }
      );
      setRuntime((current) => current ? { ...current, result: response.result } : current);
    } catch (cause) {
      setRuntime(previous);
      setError(activityErrorMessage(cause));
    } finally {
      setModeratingEntryId(null);
    }
  };

  return (
    <section className="activity-presenter-panel" aria-label="참여 장표 운영">
      <div className="activity-presenter-panel-heading">
        <div>
          <span>참여 장표 운영</span>
          <strong>{props.slide.activity.title}</strong>
        </div>
        <ActivityStatusBadge status={runtime?.run.status ?? "draft"} />
      </div>

      <ActivityPresenterMetrics result={runtime?.result ?? null} />

      {runtime ? (
        <a href={runtime.audienceUrl} rel="noreferrer" target="_blank">
          청중 참여 화면
          <IconExternalLink aria-hidden="true" size={15} stroke={1.7} />
        </a>
      ) : null}
      {runtime ? (
        <ActivityPresenterResults
          disabledEntryId={moderatingEntryId}
          onModerate={(entryId, patch) => void moderateText(entryId, patch)}
          result={runtime.result}
          slide={props.slide}
        />
      ) : null}
      {error ? <p className="activity-presenter-error" role="status">{error}</p> : null}
      {getActivityReopenCommand(runtime?.run.status ?? "draft") ? (
        <>
          <div className="activity-presenter-command-row">
            <button
              className="activity-presenter-secondary-command"
              disabled={!runtime || pending}
              onClick={() => void updateStatus("open")}
              type="button"
            >
              <IconPlayerPlay aria-hidden="true" size={18} stroke={1.8} />
              {pending ? "상태 변경 중" : "응답 다시 열기"}
            </button>
            <button
              className="activity-presenter-primary-command"
              disabled={!runtime || pending}
              onClick={() => void updateStatus(primary.nextStatus)}
              type="button"
            >
              <IconPlayerPause aria-hidden="true" size={18} stroke={1.8} />
              {pending ? "상태 변경 중" : primary.label}
            </button>
          </div>
          <p className="activity-presenter-reopen-help">
            기존 응답과 집계를 유지한 채 다시 받습니다.
          </p>
        </>
      ) : (
        <button
          className="activity-presenter-primary-command"
          disabled={!runtime || pending}
          onClick={() => void updateStatus(primary.nextStatus)}
          type="button"
        >
          {primary.nextStatus === "open" ? (
            <IconPlayerPlay aria-hidden="true" size={18} stroke={1.8} />
          ) : (
            <IconPlayerPause aria-hidden="true" size={18} stroke={1.8} />
          )}
          {pending ? "상태 변경 중" : primary.label}
        </button>
      )}
    </section>
  );
}

export async function loadActivityPresenterRuntime(input: {
  activityId: string;
  autoStart: boolean;
  deckId: string;
  deckVersion: number;
  finishInitialSessionCreation?: () => void;
  projectId: string;
  tryInitialSessionCreation?: () => boolean;
  tryStaleSessionReplacement?: () => boolean;
}): Promise<ActivityPresenterRuntime | null> {
  const current = await activityApi.getCurrentSession(input.projectId, input.deckId);
  let session = current.session;
  let audienceUrl = current.audienceUrl;
  if (!session || !audienceUrl) {
    if (!input.autoStart || input.tryInitialSessionCreation?.() === false) {
      return null;
    }
    try {
      const created = await activityApi.createSession(input.projectId, {
        accessMode: "public",
        deckId: input.deckId
      });
      session = created.session;
      audienceUrl = created.audienceUrl;
    } finally {
      input.finishInitialSessionCreation?.();
    }
  }

  let run: ActivityRun;
  try {
    ({ run } = await activityApi.ensureRun(
      input.projectId,
      session.sessionId,
      input.activityId
    ));
  } catch (cause) {
    const canReplaceStaleSession =
      input.autoStart &&
      session.deckVersion !== input.deckVersion &&
      cause instanceof ActivityApiError &&
      cause.status === 404 &&
      cause.message === "Activity definition not found in stored Deck";
    if (!canReplaceStaleSession) throw cause;
    if (input.tryStaleSessionReplacement?.() === false) throw cause;

    const created = await activityApi.createSession(input.projectId, {
      accessMode: "public",
      deckId: input.deckId
    });
    session = created.session;
    audienceUrl = created.audienceUrl;
    ({ run } = await activityApi.ensureRun(
      input.projectId,
      session.sessionId,
      input.activityId
    ));
  }
  if (input.autoStart && run.status === "draft") {
    ({ run } = await activityApi.updateRunStatus(
      input.projectId,
      session.sessionId,
      run.activityRunId,
      { status: "open", expectedRevision: run.revision }
    ));
  }
  const { result } = await activityApi.getPresenterResult(
    input.projectId,
    session.sessionId,
    run.activityRunId
  );
  return {
    audienceUrl: canonicalActivityUrl(audienceUrl, input.activityId),
    result,
    run,
    sessionId: session.sessionId
  };
}

export function createActivitySessionRecoveryTracker() {
  let currentIdentity: string | null = null;
  let initialCreationInFlight = false;
  let staleReplacementAttempted = false;

  const alignIdentity = (identity: string) => {
    if (identity === currentIdentity) return;
    currentIdentity = identity;
    initialCreationInFlight = false;
    staleReplacementAttempted = false;
  };

  return {
    finishInitialCreation(identity: string) {
      if (identity === currentIdentity) initialCreationInFlight = false;
    },
    tryInitialCreation(identity: string) {
      alignIdentity(identity);
      if (initialCreationInFlight) return false;
      initialCreationInFlight = true;
      return true;
    },
    tryStaleReplacement(identity: string) {
      alignIdentity(identity);
      if (staleReplacementAttempted) return false;
      staleReplacementAttempted = true;
      return true;
    }
  };
}

export function ActivityPresenterMetrics(props: {
  result: ActivityPresenterResult | null;
}) {
  const average = props.result?.aggregates.find(
    (aggregate) => aggregate.type === "rating"
  )?.average;
  return (
    <div className="activity-presenter-metrics" aria-live="polite">
      <div>
        <IconChartBar aria-hidden="true" size={20} stroke={1.7} />
        <span>실시간 응답</span>
        <strong>{props.result?.responseCount ?? 0}</strong>
      </div>
      <div>
        <IconPresentationAnalytics aria-hidden="true" size={20} stroke={1.7} />
        <span>평균 평점</span>
        <strong>{average == null ? "–" : average.toFixed(1)}</strong>
      </div>
      <div>
        <IconUsers aria-hidden="true" size={20} stroke={1.7} />
        <span>응답률</span>
        <strong>{props.result ? `${props.result.responseRate}%` : "–"}</strong>
      </div>
    </div>
  );
}

export function ActivityPresenterResults(props: {
  disabledEntryId?: string | null;
  onModerate?: (
    entryId: string,
    patch: Pick<ModerateActivityTextRequest, "moderationStatus" | "answered">
  ) => void;
  result: ActivityPresenterResult;
  slide: ActivitySlide;
}) {
  return (
    <div className="activity-presenter-result-detail">
      {props.slide.activity.questions.map((question) => {
        const aggregate = props.result.aggregates.find(
          (candidate) => candidate.questionId === question.questionId
        );
        if (!aggregate) return null;
        if (question.type === "rating") {
          return (
            <section key={question.questionId} aria-label={`${question.prompt} 평점 집계`}>
              <div className="activity-presenter-rating-heading">
                <strong>{question.prompt}</strong>
                <span>평균 <b>{aggregate.average === null ? "–" : aggregate.average.toFixed(1)}</b> / 5</span>
              </div>
              <ActivityRatingDistribution items={aggregate.ratingDistribution} />
            </section>
          );
        }
        if (question.type !== "single-choice" && question.type !== "multiple-choice") return null;
        return (
          <section key={question.questionId} aria-label={`${question.prompt} 집계`}>
            <strong>{question.prompt}</strong>
            <ul>
              {question.options.map((option) => {
                const choice = aggregate.choices.find((candidate) => candidate.optionId === option.optionId);
                return (
                  <li key={option.optionId}>
                    <span>{option.label}</span>
                    <b>{choice?.count ?? 0} · {Math.round((choice?.ratio ?? 0) * 100)}%</b>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {props.result.textEntries.length > 0 ? (
        <section aria-label="제출된 주관식 답변" className="activity-presenter-text-entries">
          <strong>제출된 질문·의견</strong>
          <ul>
            {props.result.textEntries.slice(0, 50).map((entry) => (
              <li key={entry.entryId}>
                <span>{entry.displayName ?? "익명"}</span>
                <p>{entry.text}</p>
                <em>{entry.moderationStatus === "pending" ? "검토 대기" : entry.moderationStatus === "approved" ? "공개" : "숨김"}</em>
                {props.onModerate ? (
                  <div className="activity-presenter-moderation-actions">
                    <button
                      disabled={props.disabledEntryId === entry.entryId}
                      type="button"
                      onClick={() => props.onModerate?.(entry.entryId, { moderationStatus: "approved" })}
                    >승인</button>
                    <button
                      disabled={props.disabledEntryId === entry.entryId}
                      type="button"
                      onClick={() => props.onModerate?.(entry.entryId, { moderationStatus: "hidden" })}
                    >숨김</button>
                    <button
                      disabled={props.disabledEntryId === entry.entryId}
                      type="button"
                      onClick={() => props.onModerate?.(entry.entryId, { answered: entry.answeredAt === null })}
                    >{entry.answeredAt === null ? "답변 완료" : "미답변"}</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function getActivityPrimaryCommand(status: ActivityRuntimeStatus): {
  label: "응답 열기" | "응답 마감" | "결과 공개" | "결과 숨기기";
  nextStatus: ActivityRuntimeStatus;
} {
  if (status === "open") return { label: "응답 마감", nextStatus: "closed" };
  if (status === "closed") return { label: "결과 공개", nextStatus: "results" };
  if (status === "results") return { label: "결과 숨기기", nextStatus: "closed" };
  return { label: "응답 열기", nextStatus: "open" };
}

export function getActivityReopenCommand(status: ActivityRuntimeStatus): {
  label: "응답 다시 열기";
  nextStatus: "open";
} | null {
  return status === "closed"
    ? { label: "응답 다시 열기", nextStatus: "open" }
    : null;
}

function ActivityStatusBadge(props: { status: ActivityRuntimeStatus }) {
  const labels: Record<ActivityRuntimeStatus, string> = {
    draft: "준비",
    open: "응답 중",
    closed: "마감",
    results: "결과 공개"
  };
  return <span className={`activity-presenter-status activity-presenter-status--${props.status}`}>{labels[props.status]}</span>;
}

function activityErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "참여 장표 상태를 불러오지 못했습니다.";
}
