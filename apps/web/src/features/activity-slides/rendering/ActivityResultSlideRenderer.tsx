import type {
  ActivityPresenterResult,
  ActivityPublicResult,
  ActivityResultsSlide,
  ActivityRun,
  ActivitySlide,
  Deck
} from "@orbit/shared";
import {
  IconBroadcast,
  IconChartBar,
  IconEyeOff,
  IconLetterQ,
  IconLinkOff,
  IconRefresh,
  IconSparkles,
  IconUsers
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { activityApi } from "../api/activityApi";
import { createActivityThemeStyle } from "./activityThemeStyle";
import "./activity-result-slide.css";

export type ActivityResultRenderState =
  | "no-run"
  | "waiting"
  | "presenter-live"
  | "public-hidden"
  | "public-results"
  | "source-missing";

type RuntimeProjection = {
  presenterResult: ActivityPresenterResult | null;
  publicResult: ActivityPublicResult | null;
  run: ActivityRun | null;
  waiting: boolean;
};

const waitingProjection: RuntimeProjection = {
  presenterResult: null,
  publicResult: null,
  run: null,
  waiting: true
};

export function ActivityResultRuntime(props: {
  deck: Deck;
  role: "audience" | "presenter";
  scale?: number;
  slide: ActivityResultsSlide;
}) {
  const source = findSource(props.deck, props.slide.activityResult.sourceActivityId);
  const [projection, setProjection] = useState<RuntimeProjection>(waitingProjection);

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setProjection({ ...waitingProjection, waiting: false });
      return;
    }

    const refresh = async () => {
      try {
        const current = await activityApi.getCurrentSession(
          props.deck.projectId,
          props.deck.deckId
        );
        if (!current.session) {
          if (!cancelled) setProjection({ ...waitingProjection, waiting: false });
          return;
        }
        const currentRun = await activityApi.getCurrentRun(
          props.deck.projectId,
          current.session.sessionId,
          source.activity.activityId
        );
        if (!currentRun.run) {
          if (!cancelled) setProjection({ ...waitingProjection, waiting: false });
          return;
        }
        if (props.role === "presenter") {
          const { result } = await activityApi.getPresenterResult(
            props.deck.projectId,
            current.session.sessionId,
            currentRun.run.activityRunId
          );
          if (!cancelled) {
            setProjection({
              presenterResult: result,
              publicResult: null,
              run: currentRun.run,
              waiting: false
            });
          }
          return;
        }
        const { result } = await activityApi.getPublicResult(
          props.deck.projectId,
          current.session.sessionId,
          currentRun.run.activityRunId
        );
        if (!cancelled) {
          setProjection({
            presenterResult: null,
            publicResult: result,
            run: currentRun.run,
            waiting: false
          });
        }
      } catch {
        if (!cancelled) setProjection({ ...waitingProjection, waiting: false });
      }
    };

    setProjection(waitingProjection);
    void refresh();
    const timerId = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [props.deck.deckId, props.deck.projectId, props.role, source?.activity.activityId]);

  return (
    <ActivityResultSlideRenderer
      presenterResult={projection.presenterResult}
      publicResult={projection.publicResult}
      role={props.role}
      run={projection.run}
      scale={props.scale}
      slide={props.slide}
      source={source}
      theme={props.deck.theme}
      waiting={projection.waiting}
    />
  );
}

export function ActivityResultSlideRenderer(props: {
  presenterResult: ActivityPresenterResult | null;
  publicResult: ActivityPublicResult | null;
  role: "audience" | "presenter";
  run: ActivityRun | null;
  scale?: number;
  slide: ActivityResultsSlide;
  source: ActivitySlide | null;
  theme?: Deck["theme"];
  waiting?: boolean;
}) {
  const state = getActivityResultRenderState(props);
  const scale = props.scale ?? 1;
  const visibleResult =
    state === "presenter-live" ? props.presenterResult : props.publicResult;

  return (
    <div
      className="activity-result-slide-viewport"
      style={{ height: 1080 * scale, width: 1920 * scale }}
    >
      <section
        aria-label={props.role === "presenter" ? "발표자 결과 장표" : "공개 결과 장표"}
        className="activity-result-slide"
        data-result-state={state}
        style={{
          ...createActivityThemeStyle(props.theme, props.slide.style),
          transform: `scale(${scale})`
        }}
      >
        <header className="activity-result-intro">
          <div className="activity-result-eyebrow">
            <IconBroadcast aria-hidden="true" size={24} stroke={1.8} />
            <span>실시간 참여 결과</span>
          </div>
          <h1>{props.source?.activity.title ?? "연결 결과"}</h1>
          {props.source?.activity.description ? (
            <p>{props.source.activity.description}</p>
          ) : null}
          <div className="activity-result-status">
            <IconBroadcast aria-hidden="true" size={26} stroke={1.8} />
            <span>{resultStatusLabel(state)}</span>
          </div>
        </header>
        {visibleResult && props.source ? (
          <ResultContent
            layout={props.slide.activityResult.layout}
            presenterResult={state === "presenter-live" ? props.presenterResult : null}
            publicResult={state === "public-results" ? props.publicResult : null}
            source={props.source}
          />
        ) : (
          <ResultStateNotice state={state} />
        )}
      </section>
    </div>
  );
}

export function getActivityResultRenderState(input: {
  presenterResult: ActivityPresenterResult | null;
  publicResult: ActivityPublicResult | null;
  role: "audience" | "presenter";
  run: ActivityRun | null;
  source: ActivitySlide | null;
  waiting?: boolean;
}): ActivityResultRenderState {
  if (!input.source) return "source-missing";
  if (input.waiting) return "waiting";
  if (!input.run) return "no-run";
  if (input.role === "presenter") {
    return input.presenterResult ? "presenter-live" : "waiting";
  }
  return input.run.status === "results" && input.publicResult
    ? "public-results"
    : "public-hidden";
}

function ResultContent(props: {
  layout: ActivityResultsSlide["activityResult"]["layout"];
  presenterResult: ActivityPresenterResult | null;
  publicResult: ActivityPublicResult | null;
  source: ActivitySlide;
}) {
  const result = props.presenterResult ?? props.publicResult;
  if (!result) return null;
  const publicTexts = props.publicResult?.approvedTextEntries ?? [];
  const presenterTexts = props.presenterResult?.textEntries ?? [];
  const resultFooter = (
    <p className="activity-result-live-note">
      <IconRefresh aria-hidden="true" size={28} stroke={1.8} />
      <span>새 응답은 이 화면에 자동으로 반영됩니다.</span>
    </p>
  );

  const responseCount = (
    <div className="activity-result-response-count">
      <IconUsers aria-hidden="true" size={34} stroke={1.8} />
      <span>응답</span>
      <strong>{result.responseCount}</strong>
    </div>
  );

  if (props.layout === "approved-text") {
    const texts = props.presenterResult
      ? presenterTexts
      : publicTexts.map((entry) => ({ ...entry, moderationStatus: "approved" as const }));
    return (
      <section className="activity-result-stage" data-result-layout="approved-text">
        {responseCount}
        <section className="activity-result-card activity-result-texts" aria-label="주관식 결과">
          <header className="activity-result-question-heading">
            <span><IconLetterQ aria-hidden="true" size={28} stroke={2} /></span>
            <strong>{props.source.activity.questions[0]?.prompt ?? "청중 응답"}</strong>
          </header>
          {texts.length > 0 ? (
            <ul>
              {texts.slice(0, 6).map((entry) => (
                <li key={entry.entryId}>
                  {entry.text}
                  {props.presenterResult ? (
                    <small>{moderationStatusLabel(entry.moderationStatus)}</small>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="activity-result-empty-copy">표시할 주관식 응답이 없습니다.</p>
          )}
          {resultFooter}
        </section>
      </section>
    );
  }

  if (props.layout === "summary") {
    return (
      <section className="activity-result-stage" data-result-layout="summary">
        {responseCount}
        <section className="activity-result-card activity-result-summary-layout" aria-label="결과 요약">
          <header className="activity-result-question-heading">
            <span><IconChartBar aria-hidden="true" size={28} stroke={2} /></span>
            <strong>응답 결과 한눈에 보기</strong>
          </header>
          <ul>
            {props.source.activity.questions.map((question) => {
              const aggregate = result.aggregates.find(
                (candidate) => candidate.questionId === question.questionId
              );
              if (!aggregate) return null;
              let value = `${aggregate.responseCount}개 의견`;
              if (question.type === "rating") {
                value = `${aggregate.average?.toFixed(1) ?? "–"} / 5`;
              } else if (
                question.type === "single-choice" ||
                question.type === "multiple-choice"
              ) {
                const top = [...aggregate.choices].sort(
                  (left, right) => right.count - left.count
                )[0];
                value = question.options.find(
                  (option) => option.optionId === top?.optionId
                )?.label ?? "응답 없음";
              }
              return (
                <li key={question.questionId}>
                  <span>{question.prompt}</span>
                  <strong>{value}</strong>
                </li>
              );
            })}
          </ul>
          {resultFooter}
        </section>
      </section>
    );
  }

  return (
    <section className="activity-result-stage" data-result-layout="chart">
      {responseCount}
      <section className="activity-result-card" aria-label="집계 차트">
        <div
          className="activity-result-grid"
          data-question-count={props.source.activity.questions.length}
        >
        {props.source.activity.questions.map((question) => {
          const aggregate = result.aggregates.find(
            (candidate) => candidate.questionId === question.questionId
          );
          if (!aggregate) return null;
          const leadingCount = Math.max(0, ...aggregate.choices.map((choice) => choice.count));
          return (
            <article key={question.questionId}>
              <header className="activity-result-question-heading">
                <span><IconLetterQ aria-hidden="true" size={28} stroke={2} /></span>
                <strong>{question.prompt}</strong>
              </header>
              {question.type === "rating" ? (
                <>
                  <strong className="activity-result-rating">
                    {aggregate.average?.toFixed(1) ?? "–"}<small>/ 5</small>
                  </strong>
                  <i className="activity-result-chart-track" aria-hidden="true">
                    <span style={{ width: `${((aggregate.average ?? 0) / 5) * 100}%` }} />
                  </i>
                </>
              ) : question.type === "single-choice" || question.type === "multiple-choice" ? (
                <ul>
                  {question.options.map((option) => {
                    const choice = aggregate.choices.find(
                      (candidate) => candidate.optionId === option.optionId
                    );
                    const ratio = choice?.ratio ?? 0;
                    const isLeading = leadingCount > 0 && choice?.count === leadingCount;
                    return (
                      <li className={isLeading ? "is-leading" : undefined} key={option.optionId}>
                        <div>
                          <span>{option.label}</span>
                          {isLeading ? (
                            <small className="activity-result-leading-badge">
                              <IconSparkles aria-hidden="true" size={18} stroke={1.8} />
                              가장 많음
                            </small>
                          ) : null}
                        </div>
                        <i className="activity-result-chart-track" aria-hidden="true">
                          <span style={{ width: `${ratio * 100}%` }} />
                        </i>
                        <strong>{Math.round(ratio * 100)}%</strong>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <strong>{aggregate.responseCount}<small>개 의견</small></strong>
              )}
            </article>
          );
        })}
        </div>
        {resultFooter}
      </section>
    </section>
  );
}

function resultStatusLabel(state: ActivityResultRenderState) {
  const labels: Record<ActivityResultRenderState, string> = {
    "no-run": "시작 전",
    waiting: "집계 중",
    "presenter-live": "진행 중",
    "public-hidden": "공개 전",
    "public-results": "결과 공개",
    "source-missing": "연결 필요"
  };
  return labels[state];
}

function moderationStatusLabel(status: "pending" | "approved" | "hidden") {
  return { pending: "확인 전", approved: "공개", hidden: "숨김" }[status];
}

function ResultStateNotice(props: { state: ActivityResultRenderState }) {
  const content: Record<ActivityResultRenderState, [string, string]> = {
    "no-run": ["아직 실행된 참여 장표가 없습니다", "발표 세션에서 원본 참여 장표를 실행하면 결과가 연결됩니다."],
    waiting: ["결과를 불러오는 중입니다", "잠시만 기다려주세요."],
    "presenter-live": ["결과를 준비하고 있습니다", "집계가 도착하면 자동으로 표시됩니다."],
    "public-hidden": ["결과는 아직 공개되지 않았습니다", "발표자가 결과를 공개하면 이 화면에 표시됩니다."],
    "public-results": ["공개 결과를 준비하고 있습니다", "잠시만 기다려주세요."],
    "source-missing": ["원본 참여 장표를 찾을 수 없습니다", "에디터에서 결과 장표의 원본 연결을 복구하세요."]
  };
  const [title, description] = content[props.state];
  const Icon = props.state === "source-missing" ? IconLinkOff : IconEyeOff;
  return (
    <div className="activity-result-notice" role="status">
      <Icon aria-hidden="true" size={54} stroke={1.4} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function findSource(deck: Deck, activityId: string): ActivitySlide | null {
  return (
    deck.slides.find(
      (slide): slide is ActivitySlide =>
        slide.kind === "activity" && slide.activity.activityId === activityId
    ) ?? null
  );
}
