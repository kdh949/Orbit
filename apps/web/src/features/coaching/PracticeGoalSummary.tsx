import type {
  FocusedPracticeAttemptSummary,
  PracticePlanResponse,
} from "@orbit/shared/coaching";
import { ArrowRight, Check, CheckCircle2, Clock3, MessageCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { OrbitStatus } from "../../components/ui";
import { getFocusedPracticeSummary } from "./focusedPracticeApi";
import { fetchPracticePlan } from "./practicePlanApi";
import { practiceGoalCategoryLabel, practiceHistoryLabel } from "./practicePlanViewModel";

type PracticeGoalSummaryState =
  | { status: "loading" }
  | { status: "loaded"; plan: PracticePlanResponse }
  | { status: "failed" };

export function PracticeGoalSummary(props: {
  initialAttemptSummary?: FocusedPracticeAttemptSummary;
  initialPlan?: PracticePlanResponse;
  projectId: string;
  sourceFullRunId: string;
}) {
  const [state, setState] = useState<PracticeGoalSummaryState>(
    props.initialPlan
      ? { status: "loaded", plan: props.initialPlan }
      : { status: "loading" },
  );
  const [passedCounts, setPassedCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries((props.initialAttemptSummary?.goals ?? []).map((goal) => [goal.goalId, goal.passedCount])),
  );
  useEffect(() => {
    if (props.initialPlan) {
      setState({ status: "loaded", plan: props.initialPlan });
      return;
    }
    let active = true;
    void fetchPracticePlan(props.projectId, props.sourceFullRunId)
      .then((value) => { if (active) setState({ status: "loaded", plan: value }); })
      .catch(() => { if (active) setState({ status: "failed" }); });
    return () => { active = false; };
  }, [props.initialPlan, props.projectId, props.sourceFullRunId]);
  useEffect(() => {
    if (props.initialAttemptSummary) {
      setPassedCounts(Object.fromEntries(
        props.initialAttemptSummary.goals.map((goal) => [goal.goalId, goal.passedCount]),
      ));
      return;
    }
    let active = true;
    void getFocusedPracticeSummary(props.projectId, props.sourceFullRunId)
      .then((summary) => {
        if (active) {
          setPassedCounts(Object.fromEntries(summary.goals.map((goal) => [goal.goalId, goal.passedCount])));
        }
      })
      .catch(() => { if (active) setPassedCounts({}); });
    return () => { active = false; };
  }, [props.initialAttemptSummary, props.projectId, props.sourceFullRunId]);

  const planHref = `/rehearsal/${encodeURIComponent(props.projectId)}/plan/${encodeURIComponent(props.sourceFullRunId)}`;
  if (state.status !== "loaded") {
    return (
      <PracticeGoalSummaryStateCard
        copy={state.status === "loading"
          ? "리포트 분석 결과에서 이어서 연습할 수 있는 계획을 확인하고 있습니다."
          : "연습 계획 상태를 확인하지 못했습니다. 계획 화면에서 다시 시도할 수 있습니다."}
        href={planHref}
        title={state.status === "loading" ? "연습 계획 확인 중" : "연습 계획을 확인해 주세요"}
      />
    );
  }

  const plan = state.plan;
  if (plan.status !== "ready") {
    return <PracticeGoalSummaryStateCard {...nonReadyPlanSummary(plan)} href={planHref} />;
  }

  return (
    <section className="practice-report-summary" aria-labelledby="practice-report-summary-title">
      <header>
        <div>
          <p className="redesign-eyebrow">우선 연습 목표</p>
          <h2 id="practice-report-summary-title">다음 연습에서 먼저 바꿀 것</h2>
        </div>
        <a href={planHref}>
          연습하기 <ArrowRight aria-hidden="true" size={17} />
        </a>
      </header>
      <ol>
        {plan.goals.map((goal) => (
          <li key={goal.goalId}>
            <span>0{goal.priority}</span>
            <div>
              <small>{practiceGoalCategoryLabel(goal.category)}</small>
              <strong>{goal.problemLabel}</strong>
              <p>{goal.nextAction}</p>
            </div>
            <div className="practice-goal-result">
              <OrbitStatus tone={goal.history.label === "persistent" ? "warning" : "neutral"}>
                {goal.category === "semantic" ? <MessageCircle aria-hidden="true" size={13} /> : goal.category === "timing" ? <Clock3 aria-hidden="true" size={13} /> : <CheckCircle2 aria-hidden="true" size={13} />}
                {practiceHistoryLabel(goal.history.label)}
              </OrbitStatus>
              <PracticePassMarks passedCount={passedCounts[goal.goalId] ?? 0} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PracticePassMarks({ passedCount }: { passedCount: number }) {
  const visiblePasses = Math.min(passedCount, 3);
  return (
    <div className="practice-pass-marks" aria-label={`${passedCount}회 통과`}>
      {[0, 1, 2].map((index) => (
        <span className={index < visiblePasses ? "is-passed" : undefined} key={index}>
          {index < visiblePasses ? <Check aria-hidden="true" size={20} strokeWidth={3} /> : null}
        </span>
      ))}
    </div>
  );
}

function PracticeGoalSummaryStateCard(props: { copy: string; href: string; title: string }) {
  return (
    <section className="practice-report-summary practice-report-summary-state" aria-labelledby="practice-report-summary-title">
      <header>
        <div>
          <p className="redesign-eyebrow">우선 연습 목표</p>
          <h2 id="practice-report-summary-title">{props.title}</h2>
        </div>
        <a href={props.href}>
          연습하기 <ArrowRight aria-hidden="true" size={17} />
        </a>
      </header>
      <p>
        <RefreshCw aria-hidden="true" size={16} />
        {props.copy}
      </p>
    </section>
  );
}

function nonReadyPlanSummary(plan: Exclude<PracticePlanResponse, { status: "ready" }>) {
  if (plan.status === "processing") {
    return {
      title: "연습 계획 준비 중",
      copy: "분석이 끝나는 즉시 다음 연습에서 볼 Top 3 목표를 보여드립니다.",
    };
  }
  if (plan.status === "no-goal") {
    return {
      title: "지금 바로 반복할 목표가 없어요",
      copy: "현재 리포트에서 우선 반복할 목표를 찾지 못했습니다. 전체 흐름을 다시 연습해 감각을 유지할 수 있습니다.",
    };
  }
  if (plan.status === "stale") {
    return {
      title: "발표 자료가 변경됐어요",
      copy: "현재 자료 기준으로 연습 계획을 다시 만들려면 전체 리허설을 실행해 주세요.",
    };
  }
  return {
    title: "연습 계획을 만들 수 없어요",
    copy: "리허설 상태를 확인한 뒤 계획 화면에서 다시 시도해 주세요.",
  };
}
