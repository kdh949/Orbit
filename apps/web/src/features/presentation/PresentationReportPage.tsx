import type {
  ActivitySessionResultItem,
  PresentationRunStatus,
} from "@orbit/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconCheck,
  IconMicrophoneOff,
  IconRefresh,
  IconUsers,
} from "@tabler/icons-react";
import type { CSSProperties } from "react";

import {
  OrbitButton,
  OrbitButtonLink,
  OrbitEmptyState,
  OrbitFailureState,
  OrbitStatus,
} from "../../components/ui";
import { ReportDetailFrame } from "../reports/RehearsalReportDocument";
import { RehearsalReportTestView } from "../reports/RehearsalReportTestView";
import { RehearsalRunNav } from "../reports/RehearsalRunNav";
import { loadProjectReportRunSources } from "../reports/reportApi";
import { formatRunDate, navigateTo } from "../reports/reportUtils";
import "../reports/rehearsal-report-detail.css";
import {
  getPresentationReport,
  getPresentationRun,
  getPresentationSessionRun,
  retryPresentationAnalysis,
} from "./presentationApi";
import "./presentation-report.css";
import {
  countAudienceResponses,
  isPresentationAnalysisPending,
} from "./presentationReportUtils";

type PresentationReportPageProps = {
  projectId: string;
  runId?: string;
  sessionId: string;
};

export function PresentationReportPage(props: PresentationReportPageProps) {
  const queryClient = useQueryClient();
  const runQuery = useQuery({
    queryKey: [
      "presentation-run",
      props.projectId,
      props.sessionId,
      props.runId,
    ],
    queryFn: () =>
      props.runId
        ? getPresentationRun({
            projectId: props.projectId,
            runId: props.runId,
            sessionId: props.sessionId,
          })
        : getPresentationSessionRun({
            projectId: props.projectId,
            sessionId: props.sessionId,
          }),
    refetchInterval: (query) =>
      isPresentationAnalysisPending(query.state.data?.run.status)
        ? 2_000
        : false,
    retry: false,
  });
  const resolvedRunId = runQuery.data?.run.runId ?? props.runId;
  const reportQuery = useQuery({
    enabled: Boolean(resolvedRunId),
    queryKey: [
      "presentation-report",
      props.projectId,
      props.sessionId,
      resolvedRunId,
    ],
    queryFn: () =>
      getPresentationReport({
        projectId: props.projectId,
        runId: resolvedRunId!,
        sessionId: props.sessionId,
      }),
    refetchInterval: (query) =>
      isPresentationAnalysisPending(query.state.data?.report.analysisStatus)
        ? 2_000
        : false,
    retry: false,
  });
  const retryAnalysis = useMutation({
    mutationFn: () =>
      retryPresentationAnalysis({
        projectId: props.projectId,
        runId: resolvedRunId!,
        sessionId: props.sessionId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["presentation-run"] }),
        queryClient.invalidateQueries({ queryKey: ["presentation-report"] }),
      ]);
    },
  });
  const reportSourcesQuery = useQuery({
    queryKey: ["project-report-run-sources", props.projectId],
    queryFn: () => loadProjectReportRunSources(props.projectId),
    retry: false,
  });

  if (runQuery.isLoading) {
    return <ReportLoadingState />;
  }
  if (runQuery.isError || !runQuery.data || !resolvedRunId) {
    return (
      <main className="presentation-report-state-page">
        <OrbitFailureState
          description="실전 발표 기록을 가져오지 못했습니다."
          onRetry={() => void runQuery.refetch()}
          recommendedAction="발표 세션 주소와 인터넷 연결을 확인한 뒤 다시 시도하세요."
          title="실전 발표 기록을 불러오지 못했습니다."
        />
      </main>
    );
  }

  const run = runQuery.data.run;
  const report = reportQuery.data?.report;
  const voiceReport = report?.voiceReport ?? run.voiceReport;
  const audienceActivities = report?.audienceSummary?.activities ?? [];
  const rehearsalRuns = reportSourcesQuery.data?.rehearsal.runs ?? [];
  const presentationRuns = reportSourcesQuery.data?.presentation.runs ?? [];
  const orderedPresentationRuns = [...presentationRuns].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const runNumber =
    orderedPresentationRuns.findIndex(
      (candidate) => candidate.runId === run.runId,
    ) + 1;
  const reportTitle =
    runNumber > 0 ? `${runNumber}회차 실전 발표 리포트` : "실전 발표 리포트";

  return (
    <main className="rehearsal-report-page presentation-report-detail-page">
      <header className="rehearsal-report-topbar">
        <div className="rehearsal-report-topbar-left">
          <button
            aria-label="프로젝트 리포트 개요로"
            className="rehearsal-report-back-button"
            onClick={() =>
              navigateTo(`/reports/${encodeURIComponent(props.projectId)}`)
            }
            type="button"
          >
            <IconArrowLeft size={18} />
          </button>
          <span className="report-project-title">
            {report?.deck?.title ?? "실전 발표 리포트"}
          </span>
          {runNumber > 0 ? (
            <span className="report-run-label">실전 발표 {runNumber}회차</span>
          ) : null}
        </div>
      </header>

      <div className="rehearsal-report-body">
        <RehearsalRunNav
          activePresentationRunId={run.runId}
          loading={reportSourcesQuery.isLoading}
          presentationRuns={presentationRuns}
          projectId={props.projectId}
          runs={rehearsalRuns}
        />

        <section className="rehearsal-report-document" aria-live="polite">
          <ReportDetailFrame
            actions={
              <>
                <OrbitButtonLink
                  href={`/reports/${encodeURIComponent(props.projectId)}`}
                  icon={<IconArrowLeft aria-hidden="true" size={18} />}
                  size="prominent"
                  variant="secondary"
                >
                  전체 발표 리포트
                </OrbitButtonLink>
                <OrbitButtonLink
                  className="rrd-hero-action"
                  href={`/presentation/${encodeURIComponent(props.projectId)}`}
                  icon={<IconRefresh aria-hidden="true" size={17} />}
                  size="prominent"
                >
                  다시 발표
                </OrbitButtonLink>
              </>
            }
            date={formatRunDate(run.createdAt)}
            statusLabel={reportStatusLabel(run.status, run.recordingMode)}
            title={reportTitle}
          >
            <section
              aria-labelledby="voice-report-title"
              className="presentation-report-section rrd-card"
            >
              <div className="presentation-report-section-heading">
                <div>
                  <span>발표 음성</span>
                  <h2 id="voice-report-title">말하기 분석</h2>
                </div>
                {isPresentationAnalysisPending(run.status) ? (
                  <OrbitStatus tone="info">분석 중</OrbitStatus>
                ) : null}
              </div>

              {run.recordingMode === "none" ? (
                <OrbitEmptyState
                  description="청중 참여 결과는 아래에서 계속 확인할 수 있습니다."
                  icon={<IconMicrophoneOff aria-hidden="true" size={28} />}
                  title="마이크 없이 발표했습니다."
                />
              ) : run.status === "failed" ? (
                <div className="presentation-report-partial-error" role="alert">
                  <div>
                    <strong>음성 분석을 완료하지 못했습니다.</strong>
                    <p>
                      녹음 파일이 남아 있다면 다시 분석할 수 있습니다. 아래
                      버튼으로 다시 시도해 주세요.
                    </p>
                  </div>
                  <OrbitButton
                    icon={<IconRefresh aria-hidden="true" size={17} />}
                    loading={retryAnalysis.isPending}
                    onClick={() => retryAnalysis.mutate()}
                  >
                    분석 다시 시도
                  </OrbitButton>
                </div>
              ) : isPresentationAnalysisPending(run.status) ||
                reportQuery.isLoading ? (
                <div className="presentation-report-processing" role="status">
                  <span
                    aria-hidden="true"
                    className="presentation-report-spinner"
                  />
                  <div>
                    <strong>발표 음성을 분석하고 있습니다.</strong>
                    <p>
                      기다리는 동안 청중 참여 결과를 먼저 확인할 수 있습니다.
                    </p>
                  </div>
                </div>
              ) : reportQuery.isError || !voiceReport ? (
                <OrbitFailureState
                  description="음성 분석 결과만 불러오지 못했습니다. 청중 참여 결과는 그대로 보존됩니다."
                  onRetry={() => void reportQuery.refetch()}
                  recommendedAction="잠시 후 음성 분석 결과를 다시 불러오세요. 반복해서 실패하면 녹음 업로드 상태를 확인하세요."
                  title="음성 분석 결과를 불러오지 못했습니다."
                />
              ) : report?.detailedReport ? (
                <RehearsalReportTestView
                  audioPlaybackAvailable={false}
                  deck={report.deck}
                  formatDuration={formatDuration}
                  report={report.detailedReport}
                  reportMode="presentation"
                />
              ) : (
                <>
                  <div className="presentation-voice-metrics">
                    <VoiceMetric
                      label="발표 시간"
                      value={formatDuration(voiceReport.durationSeconds)}
                    />
                    <VoiceMetric
                      label="말 속도"
                      value={`${Math.round(voiceReport.wordsPerMinute)} 어절/분`}
                    />
                    <VoiceMetric
                      label="평균 음량"
                      value={
                        voiceReport.averageVolumeDbfs === null
                          ? "측정 안 됨"
                          : `${voiceReport.averageVolumeDbfs.toFixed(1)} dBFS`
                      }
                    />
                    <VoiceMetric
                      label="습관어"
                      value={`${voiceReport.fillerWordCount}회`}
                    />
                    <VoiceMetric
                      label="긴 쉼"
                      value={`${voiceReport.longSilenceCount}회`}
                    />
                    <VoiceMetric
                      label="평균 피치"
                      value={
                        voiceReport.averagePitchHz === null
                          ? "측정 안 됨"
                          : `${voiceReport.averagePitchHz.toFixed(1)} Hz`
                      }
                    />
                  </div>
                  <article className="presentation-voice-feedback">
                    <IconCheck aria-hidden="true" size={20} />
                    <div>
                      <h3>대본 연결 피드백</h3>
                      <p>
                        {voiceReport.scriptFeedback ||
                          "대본과 발표 음성을 안정적으로 연결했습니다."}
                      </p>
                    </div>
                  </article>
                </>
              )}
            </section>

            <section
              aria-labelledby="audience-report-title"
              className="presentation-report-section rrd-card"
            >
              <div className="presentation-report-section-heading">
                <div>
                  <span>청중 참여</span>
                  <h2 id="audience-report-title">응답 결과</h2>
                </div>
                {report?.audienceSummary ? (
                  <OrbitStatus tone="info">
                    응답 {countAudienceResponses(audienceActivities)}개
                  </OrbitStatus>
                ) : null}
              </div>

              {reportQuery.isLoading ? (
                <div className="presentation-report-processing" role="status">
                  <span
                    aria-hidden="true"
                    className="presentation-report-spinner"
                  />
                  <strong>청중 응답을 불러오고 있습니다.</strong>
                </div>
              ) : reportQuery.isError ? (
                <OrbitFailureState
                  description="청중 참여 결과만 불러오지 못했습니다. 음성 분석 결과는 그대로 유지됩니다."
                  onRetry={() => void reportQuery.refetch()}
                  recommendedAction="잠시 후 청중 결과를 다시 불러오세요. 발표 세션이 종료되었는지도 확인하세요."
                  title="청중 참여 결과를 불러오지 못했습니다."
                />
              ) : audienceActivities.length === 0 ? (
                <OrbitEmptyState
                  description="이 발표에서 실행한 사전 질문, 실시간 투표 또는 만족도 조사가 없습니다."
                  icon={<IconUsers aria-hidden="true" size={28} />}
                  title="수집된 청중 결과가 없습니다."
                />
              ) : (
                <div className="presentation-audience-results">
                  {audienceActivities.map((item) => (
                    <AudienceResultCard
                      item={item}
                      key={item.run.activityRunId}
                    />
                  ))}
                </div>
              )}
            </section>
          </ReportDetailFrame>
        </section>
      </div>
    </main>
  );
}

function VoiceMetric(props: { label: string; value: string }) {
  return (
    <article>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function AudienceResultCard({ item }: { item: ActivitySessionResultItem }) {
  const definition = item.run.definitionSnapshot;
  return (
    <article className="presentation-audience-card">
      <header>
        <div>
          <span>{activityTemplateLabel(definition.template)}</span>
          <h3>{definition.title}</h3>
        </div>
        <strong>
          {item.result?.responseCount ?? item.run.responseCount}개 응답
        </strong>
      </header>
      {item.availability === "results-deleted" ? (
        <p className="presentation-audience-unavailable">
          보관 기간이 지나 결과가 삭제되었습니다.
        </p>
      ) : item.result ? (
        <div className="presentation-audience-question-list">
          {item.result.aggregates.map((aggregate) => {
            const question = definition.questions.find(
              (candidate) => candidate.questionId === aggregate.questionId,
            );
            return (
              <section key={aggregate.questionId}>
                <h4>{question?.prompt ?? "질문"}</h4>
                {aggregate.type === "rating" ? (
                  <p className="presentation-audience-average">
                    평균 <strong>{aggregate.average?.toFixed(1) ?? "–"}</strong>{" "}
                    / 5
                  </p>
                ) : aggregate.choices.length > 0 ? (
                  <ul>
                    {aggregate.choices.map((choice) => {
                      const option =
                        question && "options" in question
                          ? question.options.find(
                              (candidate) =>
                                candidate.optionId === choice.optionId,
                            )
                          : undefined;
                      return (
                        <li key={choice.optionId}>
                          <span>{option?.label ?? "선택 항목"}</span>
                          <strong>{Math.round(choice.ratio * 100)}%</strong>
                          <i
                            style={
                              {
                                "--result-ratio": `${choice.ratio * 100}%`,
                              } as CSSProperties
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>{aggregate.responseCount}개의 주관식 답변</p>
                )}
              </section>
            );
          })}
          {item.result.textEntries.length > 0 ? (
            <div className="presentation-audience-text-entries">
              {item.result.textEntries.slice(0, 5).map((entry) => (
                <blockquote key={entry.entryId}>{entry.text}</blockquote>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="presentation-audience-unavailable">
          집계 결과를 아직 만들지 못했습니다.
        </p>
      )}
    </article>
  );
}

function ReportLoadingState() {
  return (
    <main className="presentation-report-state-page">
      <div className="presentation-report-processing" role="status">
        <span aria-hidden="true" className="presentation-report-spinner" />
        <strong>실전 발표 리포트를 불러오고 있습니다.</strong>
      </div>
    </main>
  );
}

function reportStatusLabel(
  status: PresentationRunStatus,
  recordingMode: "microphone" | "none",
) {
  if (recordingMode === "none" && status === "succeeded") return "녹음 없음";
  if (status === "succeeded") return "분석 완료";
  if (status === "failed") return "부분 리포트";
  if (status === "cancelled") return "발표 취소";
  return "분석 중";
}

function activityTemplateLabel(
  template: "pre-question" | "poll" | "satisfaction",
) {
  if (template === "pre-question") return "사전 질문";
  if (template === "poll") return "실시간 투표";
  return "만족도 조사";
}

function formatDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}분 ${remainingSeconds.toString().padStart(2, "0")}초`;
}
