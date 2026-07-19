import type { ActivitySessionResultItem, ProjectMemberRole } from "@orbit/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconChartBar,
  IconClock,
  IconTrash
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import {
  OrbitButton,
  OrbitDialog,
  OrbitEmptyState,
  OrbitFailureState,
  OrbitField,
  OrbitInput,
  OrbitStatus
} from "../../../components/ui";
import { activityApi } from "../api/activityApi";
import { activityQueryKeys } from "../model/activityQueryKeys";
import "./activity-results-page.css";

export function ActivityResultsPage(props: {
  projectId: string;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const archive = useQuery({
    queryKey: activityQueryKeys.sessionResults(props.projectId, props.sessionId),
    queryFn: () => activityApi.getSessionResults(props.projectId, props.sessionId),
    retry: false
  });
  const sessions = useQuery({
    enabled: Boolean(archive.data?.session.deckId),
    queryKey: activityQueryKeys.sessionList(
      props.projectId,
      archive.data?.session.deckId ?? "deck_pending"
    ),
    queryFn: () =>
      activityApi.listSessions(
        props.projectId,
        archive.data!.session.deckId
      ),
    retry: false
  });
  const [selectedRunId, setSelectedRunId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const access = useQuery({
    queryKey: ["project-access-role", props.projectId],
    queryFn: () => fetchProjectRole(props.projectId),
    retry: false
  });
  const deleteResults = useMutation({
    mutationFn: () =>
      activityApi.deleteSessionResults(props.projectId, props.sessionId, {
        confirmation: deleteConfirmation
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(
        activityQueryKeys.sessionResults(props.projectId, props.sessionId),
        next
      );
      setDeleteDialogOpen(false);
      setDeleteConfirmation("");
    }
  });

  useEffect(() => {
    if (
      archive.data?.activities.some(
        (item) => item.run.activityRunId === selectedRunId
      )
    ) {
      return;
    }
    setSelectedRunId(archive.data?.activities[0]?.run.activityRunId ?? "");
  }, [archive.data?.activities, selectedRunId]);

  const selected = useMemo(
    () =>
      archive.data?.activities.find(
        (item) => item.run.activityRunId === selectedRunId
      ) ?? null,
    [archive.data?.activities, selectedRunId]
  );

  if (archive.isLoading) {
    return <ActivityResultsLoading />;
  }
  if (archive.isError || !archive.data) {
    return (
      <main className="activity-results-state-page">
        <OrbitFailureState
          description="잠시 후 다시 시도하거나 프로젝트 권한과 세션 주소를 확인해 주세요."
          onRetry={() => void archive.refetch()}
          title="발표 세션 결과를 불러오지 못했습니다."
        />
      </main>
    );
  }

  return (
    <main className="activity-results-page">
      <header className="activity-results-header">
        <a href={`/project/${encodeURIComponent(props.projectId)}`}>
          <IconArrowLeft aria-hidden="true" size={18} />
          에디터로 돌아가기
        </a>
        <div>
          <span className="redesign-eyebrow">PRESENTATION RESULTS</span>
          <h1>발표 세션 결과</h1>
          <p>{archive.data.sessionName}</p>
        </div>
        <OrbitStatus tone={availabilityTone(selected?.availability)}>
          {availabilityLabel(selected?.availability)}
        </OrbitStatus>
        {canDeleteSessionResults(
          access.data ?? null,
          archive.data.session.resultsDeletedAt
        ) ? (
          <OrbitButton
            className="activity-results-delete-button"
            icon={<IconTrash aria-hidden="true" size={17} />}
            variant="quiet"
            onClick={() => setDeleteDialogOpen(true)}
          >
            이 세션 결과 영구 삭제
          </OrbitButton>
        ) : null}
      </header>

      <div className="activity-results-layout">
        <nav aria-label="발표 세션 archive" className="activity-results-sessions">
          <h2>발표 세션</h2>
          {sessions.isLoading ? <p role="status">세션 목록을 불러오는 중입니다.</p> : null}
          {sessions.isError ? <p role="alert">세션 목록을 불러오지 못했습니다.</p> : null}
          <ul>
            {(sessions.data?.sessions ?? [archive.data.session]).map((session) => (
              <li key={session.sessionId}>
                <a
                  aria-current={session.sessionId === props.sessionId ? "page" : undefined}
                  href={`/project/${encodeURIComponent(props.projectId)}/presentation-sessions/${encodeURIComponent(session.sessionId)}/results`}
                >
                  <IconClock aria-hidden="true" size={17} />
                  <span>
                    <strong>{formatDate(session.createdAt)}</strong>
                    <small>{session.status}</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-labelledby="activity-result-list-title" className="activity-results-activities">
          <h2 id="activity-result-list-title">참여 장표</h2>
          {archive.data.activities.length > 0 ? (
            <ul>
              {archive.data.activities.map((item) => (
                <li key={item.run.activityRunId}>
                  <button
                    aria-pressed={item.run.activityRunId === selectedRunId}
                    type="button"
                    onClick={() => setSelectedRunId(item.run.activityRunId)}
                  >
                    <span>{templateLabel(item.run.definitionSnapshot.template)}</span>
                    <strong>{item.run.definitionSnapshot.title}</strong>
                    <small>
                      실행 {item.run.version} · 응답 {item.run.responseCount}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <OrbitEmptyState
              description="이 세션에서 실행한 참여 장표가 없습니다."
              icon={<IconChartBar aria-hidden="true" size={28} />}
              title="아직 결과가 없습니다."
            />
          )}
        </section>

        <section aria-live="polite" className="activity-results-detail">
          {selected ? (
            <ActivityResultArchiveDetail
              item={selected}
              projectId={props.projectId}
              sessionId={props.sessionId}
              onUpdated={(next) => {
                queryClient.setQueryData(
                  activityQueryKeys.sessionResults(props.projectId, props.sessionId),
                  next
                );
              }}
            />
          ) : (
            <OrbitEmptyState
              description="왼쪽 목록에서 확인할 참여 장표를 선택하세요."
              title="결과를 선택해 주세요."
            />
          )}
        </section>
      </div>
      <OrbitDialog
        open={deleteDialogOpen}
        title="세션 결과를 영구 삭제할까요?"
        description="모든 응답 원문과 집계를 즉시 삭제하며 복구할 수 없습니다. 계속하려면 아래 세션 이름을 정확히 입력하세요."
        onClose={() => {
          if (!deleteResults.isPending) setDeleteDialogOpen(false);
        }}
        closeDisabled={deleteResults.isPending}
        footer={
          <>
            <OrbitButton
              disabled={deleteResults.isPending}
              variant="secondary"
              onClick={() => setDeleteDialogOpen(false)}
            >
              취소
            </OrbitButton>
            <OrbitButton
              disabled={
                deleteResults.isPending ||
                !isDeleteConfirmationValid(
                  deleteConfirmation,
                  archive.data.sessionName
                )
              }
              onClick={() => deleteResults.mutate()}
            >
              {deleteResults.isPending ? "삭제 중" : "영구 삭제"}
            </OrbitButton>
          </>
        }
      >
        <p className="activity-results-confirmation-name">{archive.data.sessionName}</p>
        <OrbitField
          id="activity-results-delete-confirmation"
          label="세션 이름"
          error={deleteResults.isError ? "영구 삭제에 실패했습니다. 다시 시도해 주세요." : undefined}
        >
          <OrbitInput
            autoComplete="off"
            data-orbit-dialog-initial
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
          />
        </OrbitField>
      </OrbitDialog>
    </main>
  );
}

export function ActivityResultArchiveDetail(props: {
  item: ActivitySessionResultItem;
  onUpdated?: (next: Awaited<ReturnType<typeof activityApi.getSessionResults>>) => void;
  projectId?: string;
  sessionId?: string;
}) {
  const { item } = props;
  if (item.availability === "results-deleted") {
    return (
      <OrbitEmptyState
        description="소유자가 이 세션의 참여 결과를 영구 삭제했습니다. 복구할 수 없습니다."
        title="결과가 영구 삭제되었습니다."
      />
    );
  }
  if (!item.result) {
    return (
      <OrbitEmptyState
        description="이 실행에서 수집된 응답이 없습니다."
        title="표시할 결과가 없습니다."
      />
    );
  }

  return (
    <article className="activity-results-detail-content">
      {item.availability === "aggregate-only" ? (
        <section className="activity-results-retention-notice" role="status">
          <strong>집계 전용 결과입니다.</strong>
          <p>원본 응답 보존 기간이 끝나 개인정보는 삭제되었고 수치 집계만 보존됩니다.</p>
        </section>
      ) : null}
      <header>
        <span>{templateLabel(item.run.definitionSnapshot.template)}</span>
        <h2>{item.run.definitionSnapshot.title}</h2>
        <p>실행 {item.run.version} · revision {item.result.revision}</p>
      </header>
      <dl className="activity-results-summary">
        <div><dt>응답</dt><dd>{item.result.responseCount}</dd></div>
        <div><dt>참여자</dt><dd>{item.result.participantCount}</dd></div>
        <div><dt>응답률</dt><dd>{item.result.responseRate}%</dd></div>
        <div><dt>상태</dt><dd>{item.result.status}</dd></div>
      </dl>
      <section aria-label="문항별 집계" className="activity-results-aggregate-list">
        {item.run.definitionSnapshot.questions.map((question) => {
          const aggregate = item.result?.aggregates.find(
            (candidate) => candidate.questionId === question.questionId
          );
          return (
            <article key={question.questionId}>
              <h3>{question.prompt}</h3>
              {!aggregate ? <p>집계 없음</p> : question.type === "rating" ? (
                <p><strong>{aggregate.average?.toFixed(1) ?? "–"}</strong> / 5</p>
              ) : question.type === "single-choice" || question.type === "multiple-choice" ? (
                <ul>
                  {question.options.map((option) => {
                    const choice = aggregate.choices.find(
                      (candidate) => candidate.optionId === option.optionId
                    );
                    return <li key={option.optionId}><span>{option.label}</span><strong>{choice?.count ?? 0} · {Math.round((choice?.ratio ?? 0) * 100)}%</strong></li>;
                  })}
                </ul>
              ) : (
                <p><strong>{aggregate.responseCount}</strong>개 의견</p>
              )}
            </article>
          );
        })}
      </section>
      {item.availability !== "aggregate-only" && item.result.textEntries.length > 0 ? (
        <section className="activity-results-text-list" aria-label="주관식 원문">
          <h3>주관식 응답</h3>
          <ul>
            {item.result.textEntries.map((entry) => (
              <li key={entry.entryId}>
                <p>{entry.text}</p>
                <span>{entry.displayName ?? "익명"} · {entry.moderationStatus}</span>
                {props.projectId && props.sessionId ? (
                  <ActivityTextModerationControls
                    entry={entry}
                    projectId={props.projectId}
                    revision={item.result!.revision}
                    sessionId={props.sessionId}
                    onUpdated={props.onUpdated}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function ActivityTextModerationControls(props: {
  entry: NonNullable<ActivitySessionResultItem["result"]>["textEntries"][number];
  onUpdated?: (next: Awaited<ReturnType<typeof activityApi.getSessionResults>>) => void;
  projectId: string;
  revision: number;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const moderation = useMutation({
    mutationFn: (input: { moderationStatus?: "approved" | "hidden"; answered?: boolean }) =>
      activityApi.moderateTextEntry(
        props.projectId,
        props.sessionId,
        props.entry.entryId,
        { ...input, expectedRevision: props.revision }
      ),
    onSuccess: async () => {
      const next = await activityApi.getSessionResults(
        props.projectId,
        props.sessionId
      );
      queryClient.setQueryData(
        activityQueryKeys.sessionResults(props.projectId, props.sessionId),
        next
      );
      props.onUpdated?.(next);
    }
  });
  return (
    <div aria-label="주관식 응답 관리" className="activity-results-moderation-controls">
      <OrbitButton
        disabled={moderation.isPending}
        variant="secondary"
        onClick={() => moderation.mutate({ moderationStatus: "approved" })}
      >승인</OrbitButton>
      <OrbitButton
        disabled={moderation.isPending}
        variant="quiet"
        onClick={() => moderation.mutate({ moderationStatus: "hidden" })}
      >숨김</OrbitButton>
      <OrbitButton
        disabled={moderation.isPending}
        variant="quiet"
        onClick={() => moderation.mutate({ answered: props.entry.answeredAt === null })}
      >{props.entry.answeredAt === null ? "답변 완료" : "답변 취소"}</OrbitButton>
      {moderation.isError ? <span role="alert">상태 변경에 실패했습니다.</span> : null}
    </div>
  );
}

function ActivityResultsLoading() {
  return (
    <main aria-busy="true" aria-label="발표 세션 결과를 불러오는 중" className="activity-results-state-page">
      <div className="activity-results-loading" role="status">
        <span />
        <strong>발표 세션 결과를 불러오는 중입니다.</strong>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function templateLabel(template: string) {
  if (template === "pre-question") return "사전 질문";
  if (template === "poll") return "실시간 투표";
  return "만족도 조사";
}

function availabilityLabel(value: ActivitySessionResultItem["availability"] | undefined) {
  if (value === "results-deleted") return "영구 삭제됨";
  if (value === "aggregate-only") return "집계만 보존";
  return "원본 응답 보존 중";
}

function availabilityTone(value: ActivitySessionResultItem["availability"] | undefined) {
  if (value === "results-deleted") return "warning" as const;
  if (value === "aggregate-only") return "info" as const;
  return "success" as const;
}

export function canDeleteSessionResults(
  role: ProjectMemberRole | null,
  resultsDeletedAt: string | null
) {
  return role === "owner" && resultsDeletedAt === null;
}

export function isDeleteConfirmationValid(value: string, sessionName: string) {
  return value.trim() === sessionName;
}

async function fetchProjectRole(projectId: string): Promise<ProjectMemberRole | null> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/access`,
    { credentials: "include" }
  );
  if (!response.ok) throw new Error("Project access unavailable");
  const body = await response.json() as {
    membership?: { role?: unknown; status?: unknown } | null;
  };
  const role = body.membership?.role;
  return body.membership?.status === "accepted" &&
    (role === "owner" || role === "editor" || role === "viewer")
    ? role
    : null;
}
