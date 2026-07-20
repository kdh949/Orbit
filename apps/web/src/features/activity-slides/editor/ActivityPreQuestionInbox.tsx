import type {
  ActivityPresenterResult,
  ActivitySlide,
  ModerateActivityTextRequest
} from "@orbit/shared";
import { IconMessageQuestion, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { OrbitButton, OrbitDialog, OrbitEmptyState, OrbitStatus } from "../../../components/ui";
import { activityApi } from "../api/activityApi";

export function ActivityPreQuestionInbox(props: {
  deckId: string;
  projectId: string;
  responseCount: number;
  slide: ActivitySlide;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActivityPresenterResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function refresh() {
      try {
        const current = await activityApi.getCurrentSession(props.projectId, props.deckId);
        if (!current.session) {
          if (!cancelled) {
            setResult(null);
            setSessionId(null);
            setError("");
          }
          return;
        }
        const { run } = await activityApi.ensureRun(
          props.projectId,
          current.session.sessionId,
          props.slide.activity.activityId
        );
        const response = await activityApi.getPresenterResult(
          props.projectId,
          current.session.sessionId,
          run.activityRunId
        );
        if (!cancelled) {
          setResult(response.result);
          setSessionId(current.session.sessionId);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "받은 질문을 불러오지 못했습니다.");
        }
      }
    }
    void refresh();
    const timerId = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [open, props.deckId, props.projectId, props.slide.activity.activityId, refreshKey]);

  async function moderate(
    entryId: string,
    patch: Pick<ModerateActivityTextRequest, "moderationStatus" | "answered">
  ) {
    if (!result || !sessionId || pendingEntryId) return;
    const previous = result;
    setPendingEntryId(entryId);
    setResult({
      ...result,
      textEntries: result.textEntries.map((entry) => entry.entryId === entryId
        ? {
            ...entry,
            ...(patch.moderationStatus ? { moderationStatus: patch.moderationStatus } : {}),
            ...(patch.answered !== undefined
              ? { answeredAt: patch.answered ? new Date().toISOString() : null }
              : {})
          }
        : entry)
    });
    try {
      const response = await activityApi.moderateTextEntry(
        props.projectId,
        sessionId,
        entryId,
        { ...patch, expectedRevision: result.revision }
      );
      setResult(response.result);
      setError("");
    } catch (cause) {
      setResult(previous);
      setError(cause instanceof Error ? cause.message : "질문 상태를 저장하지 못했습니다.");
    } finally {
      setPendingEntryId(null);
    }
  }

  const entries = result?.textEntries ?? [];

  return (
    <>
      <section className="activity-pre-question-inbox">
        <div>
          <strong>받은 사전 질문</strong>
          <span>청중이 미리 남긴 질문을 별도 창에서 확인할 수 있어요.</span>
        </div>
        <OrbitButton
          icon={<IconMessageQuestion aria-hidden="true" size={18} />}
          onClick={() => setOpen(true)}
          type="button"
          variant="secondary"
        >
          질문 확인{props.responseCount > 0 ? ` (${props.responseCount})` : ""}
        </OrbitButton>
      </section>

      <OrbitDialog
        className="activity-pre-question-dialog"
        description="청중이 발표 전에 남긴 질문을 확인하고, 답변한 질문을 표시할 수 있습니다."
        onClose={() => setOpen(false)}
        open={open}
        title="받은 사전 질문"
      >
        {error ? (
          <div className="activity-pre-question-error" role="alert">
            <p>{error}</p>
            <OrbitButton
              icon={<IconRefresh aria-hidden="true" size={17} />}
              onClick={() => setRefreshKey((current) => current + 1)}
              type="button"
              variant="secondary"
            >
              다시 불러오기
            </OrbitButton>
          </div>
        ) : result === null ? (
          <OrbitEmptyState
            description="발표 준비를 시작하고 참여 링크를 공유하면 질문이 여기에 모입니다."
            icon={<IconMessageQuestion aria-hidden="true" size={24} />}
            title="아직 받은 질문이 없습니다"
          />
        ) : entries.length === 0 ? (
          <OrbitEmptyState
            description="청중이 질문을 보내면 이 창에 바로 표시됩니다."
            icon={<IconMessageQuestion aria-hidden="true" size={24} />}
            title="아직 받은 질문이 없습니다"
          />
        ) : (
          <div className="activity-pre-question-list">
            <div className="activity-pre-question-list-summary">
              <strong>전체 {entries.length}개</strong>
              <span>2초마다 새 질문을 확인합니다.</span>
            </div>
            <ul>
              {entries.map((entry) => (
                <li key={entry.entryId}>
                  <div className="activity-pre-question-entry-heading">
                    <span>{entry.displayName ?? "익명"}</span>
                    <OrbitStatus tone={entry.answeredAt ? "success" : "neutral"}>
                      {entry.answeredAt ? "답변 완료" : "확인 필요"}
                    </OrbitStatus>
                  </div>
                  <p>{entry.text}</p>
                  <div className="activity-pre-question-entry-actions">
                    <OrbitButton
                      disabled={pendingEntryId === entry.entryId}
                      onClick={() => void moderate(entry.entryId, { answered: entry.answeredAt === null })}
                      size="compact"
                      type="button"
                      variant="secondary"
                    >
                      {entry.answeredAt === null ? "답변 완료로 표시" : "답변 전으로 되돌리기"}
                    </OrbitButton>
                    <OrbitButton
                      disabled={pendingEntryId === entry.entryId}
                      onClick={() => void moderate(entry.entryId, {
                        moderationStatus: entry.moderationStatus === "hidden" ? "approved" : "hidden"
                      })}
                      size="compact"
                      type="button"
                      variant="quiet"
                    >
                      {entry.moderationStatus === "hidden" ? "다시 표시" : "목록에서 숨기기"}
                    </OrbitButton>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </OrbitDialog>
    </>
  );
}
