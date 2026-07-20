import type {
  ActivityResultDefinition,
  ActivityResultsSlide,
  ActivitySessionResultItem,
  ActivitySlide,
  Deck
} from "@orbit/shared";
import { useQuery } from "@tanstack/react-query";
import { IconChartBar } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { OrbitField, OrbitSelect } from "../../../components/ui";

import { activityApi } from "../api/activityApi";
import { activityQueryKeys } from "../model/activityQueryKeys";
import { ActivityResultSlideRenderer } from "../rendering/ActivityResultSlideRenderer";
import "./activity-slide-editor.css";

const layoutLabels: Record<ActivityResultDefinition["layout"], string> = {
  summary: "한눈에 보기",
  chart: "차트로 보기",
  "approved-text": "확인한 주관식 답변"
};

export function ActivityResultSlideInspector(props: {
  deck: Deck;
  onChange: (activityResult: ActivityResultDefinition) => void;
  onSelectSourceSlide: (slideId: string) => void;
  projectId: string;
  slide: ActivityResultsSlide;
}) {
  const sources = useMemo(() => props.deck.slides.filter(isActivitySlide), [props.deck.slides]);
  const source = sources.find(
    (candidate) => candidate.activity.activityId === props.slide.activityResult.sourceActivityId
  );
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const sessions = useQuery({
    queryKey: activityQueryKeys.sessionList(props.projectId, props.deck.deckId),
    queryFn: () => activityApi.listSessions(props.projectId, props.deck.deckId),
    staleTime: 15_000
  });
  const sessionResults = useQuery({
    enabled: Boolean(source && selectedSessionId),
    queryKey: activityQueryKeys.sessionResults(props.projectId, selectedSessionId),
    queryFn: () => activityApi.getSessionResults(props.projectId, selectedSessionId),
    staleTime: 5_000
  });
  const selectedResult = source
    ? findCurrentActivityResult(sessionResults.data?.activities ?? [], source.activity.activityId)
    : null;
  const resultsDeleted = Boolean(
    sessionResults.data?.session.resultsDeletedAt || selectedResult?.availability === "results-deleted"
  );

  return (
    <div className="activity-slide-inspector activity-result-inspector">
      <div className="activity-inspector-heading">
        <IconChartBar aria-hidden="true" size={24} />
        <div>
          <h3>{source ? `${source.activity.title} 결과` : "응답 결과 슬라이드"}</h3>
          <p>어떤 참여 장표의 응답을 이 슬라이드에 보여줄지 정할 수 있어요.</p>
        </div>
      </div>

      <section className="activity-inspector-section">
        <div className="activity-inspector-section-heading">
          <strong>1) 어떤 참여 장표의 응답을 가져올지</strong>
          <span>선택한 장표의 발표 답변만 집계해서 표시됩니다.</span>
        </div>
        <OrbitField id="activity-result-source" label="결과를 가져올 슬라이드">
          <OrbitSelect
            aria-describedby={source ? undefined : "activity-result-source-help"}
            value={props.slide.activityResult.sourceActivityId}
            onChange={(event) =>
              props.onChange({
                ...props.slide.activityResult,
                sourceActivityId: event.currentTarget.value
              })
            }
          >
            {!source ? (
              <option value={props.slide.activityResult.sourceActivityId}>찾을 수 없는 슬라이드</option>
            ) : null}
            {sources.map((candidate) => (
              <option key={candidate.activity.activityId} value={candidate.activity.activityId}>
                {candidate.order}. {candidate.activity.title}
              </option>
            ))}
          </OrbitSelect>
        </OrbitField>
        {!source ? (
          <p id="activity-result-source-help" role="alert">
            결과를 가져올 슬라이드를 찾을 수 없어요. 다른 슬라이드를 선택해 주세요.
          </p>
        ) : (
          <button
            className="activity-inspector-secondary-button"
            type="button"
            onClick={() => props.onSelectSourceSlide(source.slideId)}
          >
            선택한 슬라이드로 이동
          </button>
        )}

        <OrbitField id="activity-result-layout" label="결과를 보여주는 방법">
          <OrbitSelect
            value={props.slide.activityResult.layout}
            onChange={(event) =>
              props.onChange({
                ...props.slide.activityResult,
                layout: event.currentTarget.value as ActivityResultDefinition["layout"]
              })
            }
          >
            {Object.entries(layoutLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </OrbitSelect>
        </OrbitField>
      </section>

      <section className="activity-inspector-section">
        <div className="activity-inspector-section-heading">
          <strong>2) 실제 응답 확인</strong>
          <span>발표를 고르면 발표별 응답 레이아웃을 바로 미리볼 수 있어요.</span>
        </div>
        <OrbitField id="activity-result-session" label="미리 볼 발표">
          <OrbitSelect value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.currentTarget.value)}>
            <option value="">발표를 고르지 않음</option>
            {(sessions.data?.sessions ?? []).map((session) => (
              <option key={session.sessionId} value={session.sessionId}>
                {formatSessionLabel(session.createdAt, session.status)}
              </option>
            ))}
          </OrbitSelect>
        </OrbitField>
        {sessions.isLoading ? <p role="status">발표 목록을 불러오는 중입니다.</p> : null}
        {sessions.isError ? <p role="alert">발표 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.</p> : null}

        <div
          aria-label="결과 슬라이드 미리보기"
          className="activity-result-preview"
          data-state={previewState({
            hasResult: Boolean(selectedResult?.result),
            loading: sessionResults.isLoading,
            resultsDeleted,
            selectedSessionId,
            source: Boolean(source)
          })}
        >
          {!source ? (
            <p>결과를 가져올 슬라이드를 선택해 주세요.</p>
          ) : !selectedSessionId ? (
            <p>발표를 고르면 실제 응답 결과를 미리 볼 수 있어요.</p>
          ) : sessionResults.isLoading ? (
            <p role="status">선택한 발표의 응답을 불러오는 중입니다.</p>
          ) : sessionResults.isError ? (
            <p role="alert">선택한 발표의 응답을 불러오지 못했어요.</p>
          ) : resultsDeleted ? (
            <p>이 발표의 응답은 삭제되어 다시 볼 수 없어요.</p>
          ) : selectedResult ? (
            <ActivityResultSlideRenderer
              presenterResult={selectedResult.result}
              publicResult={null}
              role="presenter"
              run={selectedResult.run}
              scale={0.135}
              slide={props.slide}
              source={source}
              theme={props.deck.theme}
            />
          ) : (
            <p>선택한 발표에는 이 슬라이드의 응답이 없어요.</p>
          )}
        </div>
      </section>
      <p className="activity-system-layer-lock">미리보기에서 고른 발표는 이 슬라이드에 저장되지 않아요.</p>
    </div>
  );
}

export function findCurrentActivityResult(
  activities: ActivitySessionResultItem[],
  sourceActivityId: string
): ActivitySessionResultItem | null {
  return activities.find((item) => item.run.activityId === sourceActivityId && item.run.isCurrent) ?? null;
}

function previewState(input: {
  hasResult: boolean;
  loading: boolean;
  resultsDeleted: boolean;
  selectedSessionId: string;
  source: boolean;
}) {
  if (!input.source) return "source-missing";
  if (!input.selectedSessionId) return "no-session";
  if (input.loading) return "waiting";
  if (input.resultsDeleted) return "results-deleted";
  return input.hasResult ? "presenter-live" : "no-run";
}

export function findActivityResultSource(deck: Pick<Deck, "slides">, sourceActivityId: string): ActivitySlide | null {
  return (
    deck.slides.find(
      (slide): slide is ActivitySlide => slide.kind === "activity" && slide.activity.activityId === sourceActivityId
    ) ?? null
  );
}

function isActivitySlide(slide: Deck["slides"][number]): slide is ActivitySlide {
  return slide.kind === "activity";
}

function formatSessionLabel(createdAt: string, status: string) {
  const date = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(createdAt));
  return `${date} · ${sessionStatusLabel(status)}`;
}

function sessionStatusLabel(status: string) {
  if (status === "active") return "진행 중";
  if (status === "ended") return "종료됨";
  return "준비 중";
}
