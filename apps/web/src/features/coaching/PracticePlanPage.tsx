import { useQuery } from "@tanstack/react-query";
import { type PracticePlanResponse } from "@orbit/shared/coaching";
import { coachingCapabilitiesResponseSchema } from "@orbit/shared/config";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCircleCheck,
  IconClock,
  IconMicrophone,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { OrbitButton, OrbitStatus } from "../../components/ui";
import { fetchPracticePlan } from "./practicePlanApi";
import {
  firstSelectableGoal,
  practiceGoalCategoryLabel,
  practiceHistoryLabel,
} from "./practicePlanViewModel";
import "./practice-plan.css";

export function PracticePlanPage(props: {
  previewCapabilities?: { challengeQnaEnabled: boolean; focusedPracticeEnabled: boolean };
  previewPlan?: Extract<PracticePlanResponse, { status: "ready" }>;
  projectId: string;
  sourceFullRunId: string;
}) {
  const planQuery = useQuery({
    queryKey: ["practice-plan", props.projectId, props.sourceFullRunId],
    queryFn: () => fetchPracticePlan(props.projectId, props.sourceFullRunId),
    enabled: !props.previewPlan,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "processing" ? 1500 : false,
  });
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const capabilitiesQuery = useQuery({
    queryKey: ["coaching-capabilities", props.projectId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(props.projectId)}/coaching-capabilities`, { credentials: "include" });
      if (!response.ok) throw new Error("Coaching capabilities unavailable.");
      return coachingCapabilitiesResponseSchema.parse(await response.json());
    },
    enabled: !props.previewPlan,
    retry: false,
  });
  const plan = props.previewPlan ?? planQuery.data;
  const capabilities = props.previewCapabilities ?? capabilitiesQuery.data;

  useEffect(() => {
    if (plan) setSelectedGoalId(firstSelectableGoal(plan));
  }, [plan]);

  const selectedGoal = useMemo(
    () => plan?.status === "ready"
      ? plan.goals.find((goal) => goal.goalId === selectedGoalId) ?? plan.goals[0]
      : undefined,
    [plan, selectedGoalId],
  );

  return (
    <div className="redesign-page practice-plan-page">
      <header className="practice-plan-topbar">
        <a href={`/rehearsal/${encodeURIComponent(props.projectId)}/report/${encodeURIComponent(props.sourceFullRunId)}`}>
          <IconArrowLeft aria-hidden="true" size={18} /> 리포트로 돌아가기
        </a>
        <OrbitStatus tone="lilac">맞춤 연습</OrbitStatus>
      </header>

      {!props.previewPlan && planQuery.isLoading ? <PlanState title="연습 계획을 정리하고 있어요" copy="분석 결과에서 가장 효과가 큰 목표를 고르는 중입니다." /> : null}
      {!props.previewPlan && planQuery.isError ? <PlanState error title="계획을 불러오지 못했어요" copy="잠시 후 다시 시도해 주세요." onRetry={() => void planQuery.refetch()} /> : null}
      {plan?.status === "processing" ? <PlanState title="분석이 아직 진행 중이에요" copy="완료되는 즉시 연습할 Top 3를 자동으로 보여드릴게요." /> : null}
      {plan?.status === "no-goal" ? <PlanState actionHref={`/rehearsal/${encodeURIComponent(props.projectId)}`} actionLabel="전체 리허설 시작" title="지금 바로 반복할 목표가 없어요" copy="전체 흐름을 한 번 더 연습해 발표 감각을 유지해 보세요." /> : null}
      {plan?.status === "stale" ? <PlanState actionHref={`/rehearsal/${encodeURIComponent(props.projectId)}`} actionLabel="현재 자료로 리허설" error title="발표 자료가 변경됐어요" copy="현재 자료로 전체 리허설을 다시 실행해 주세요." onRetry={() => void planQuery.refetch()} /> : null}
      {plan?.status === "error" ? <PlanState actionHref={`/rehearsal/${encodeURIComponent(props.projectId)}`} actionLabel="전체 리허설 시작" error title="연습 계획을 만들 수 없어요" copy="리허설 상태를 확인한 뒤 다시 시도해 주세요." onRetry={() => void planQuery.refetch()} /> : null}

      {!props.previewPlan && capabilitiesQuery.isError && plan?.status === "ready" ? <p className="practice-plan-state" role="status">고급 연습 기능을 확인하지 못했습니다. 전체 리허설은 계속 사용할 수 있습니다. <OrbitButton variant="quiet" onClick={() => void capabilitiesQuery.refetch()}>기능 다시 확인</OrbitButton></p> : null}

      {plan?.status === "ready" && selectedGoal ? (
        <section className="practice-plan-content" aria-labelledby="practice-plan-title">
          <header className="practice-plan-heading">
            <p className="redesign-eyebrow">다음 리허설</p>
            <h1 id="practice-plan-title">다음 연습은 이 세 가지에 집중하세요.</h1>
            <p>한 번에 하나씩 고르고, 짧게 반복한 뒤 전체 발표에서 확인합니다.</p>
          </header>

          <div className="practice-plan-layout">
            <ol className="practice-goal-list" aria-label="우선 연습 목표">
              {plan.goals.map((goal) => (
                <li key={goal.goalId}>
                  <button
                    aria-pressed={goal.goalId === selectedGoal.goalId}
                    className="practice-goal-row"
                    onClick={() => setSelectedGoalId(goal.goalId)}
                    type="button"
                  >
                    <span className="practice-goal-priority">0{goal.priority}</span>
                    <span>
                      <small>{practiceGoalCategoryLabel(goal.category)}</small>
                      <strong>{goal.problemLabel}</strong>
                    </span>
                    <OrbitStatus tone={goal.history.label === "persistent" ? "warning" : "neutral"}>
                      {practiceHistoryLabel(goal.history.label)}
                    </OrbitStatus>
                  </button>
                </li>
              ))}
            </ol>

            <article className="practice-goal-focus" aria-live="polite">
              <div className="practice-goal-focus-icon"><IconSparkles aria-hidden="true" size={24} /></div>
              <p>{practiceGoalCategoryLabel(selectedGoal.category)}</p>
              <h2>{selectedGoal.problemLabel}</h2>
              <dl>
                <div><dt><IconMicrophone aria-hidden="true" size={17} /> 다음 행동</dt><dd>{selectedGoal.nextAction}</dd></div>
                <div><dt><IconCircleCheck aria-hidden="true" size={17} /> 성공 기준</dt><dd>{selectedGoal.successCondition}</dd></div>
              </dl>
              <OrbitButton
                disabled={!selectedGoal.canStartFocusedPractice || !capabilities?.focusedPracticeEnabled}
                onClick={() => { window.location.href = `/rehearsal/${encodeURIComponent(props.projectId)}/focus/${encodeURIComponent(selectedGoal.goalId)}?sourceFullRunId=${encodeURIComponent(props.sourceFullRunId)}`; }}
              >
                선택한 구간 연습
              </OrbitButton>
              {!selectedGoal.canStartFocusedPractice || !capabilities?.focusedPracticeEnabled ? (
                <p className="practice-action-note" role="status">
                  집중 연습은 현재 사용할 수 없습니다. 전체 리허설로 목표를 확인할 수 있습니다.
                </p>
              ) : null}
              <a className="practice-full-run-link" href={`/rehearsal/${encodeURIComponent(props.projectId)}?sourceGoalSetId=${encodeURIComponent(plan.goalSet.goalSetId)}&sourceFullRunId=${encodeURIComponent(props.sourceFullRunId)}`}>
                <IconClock aria-hidden="true" size={16} /> 전체 리허설로 확인
              </a>
              {capabilities?.challengeQnaEnabled ? <a className="practice-full-run-link" href={`/rehearsal/${encodeURIComponent(props.projectId)}/challenge/${encodeURIComponent(props.sourceFullRunId)}`}>
                <IconMicrophone aria-hidden="true" size={16} /> 도전 질문 3개 연습
              </a> : <span aria-disabled="true" className="practice-full-run-link practice-disabled-link">
                <IconMicrophone aria-hidden="true" size={16} /> 도전 질문 3개 연습 · 현재 사용할 수 없습니다
              </span>}
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}


function PlanState(props: { title: string; copy: string; error?: boolean; onRetry?: () => void; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="practice-plan-state" role={props.error ? "alert" : "status"}>
      {props.error ? <IconAlertCircle aria-hidden="true" size={28} /> : <IconSparkles aria-hidden="true" size={28} />}
      <h1>{props.title}</h1>
      <p>{props.copy}</p>
      {props.onRetry ? <OrbitButton variant="secondary" onClick={props.onRetry}>다시 시도</OrbitButton> : null}
      {props.actionHref ? <a href={props.actionHref}>{props.actionLabel ?? "전체 리허설 시작"}</a> : null}
    </section>
  );
}
