import type { Deck } from "@orbit/shared/deck";
import type { Job } from "@orbit/shared/jobs";
import type {
  RehearsalEvaluationSnapshot,
  RehearsalRun,
  RehearsalRunMeta,
  SlideTranscriptSnapshot,
} from "@orbit/shared/rehearsals";
import { useEffect, useRef } from "react";
import { fetchPresentationBrief } from "../../coaching/presentationBriefApi";
import {
  RehearsalFlowError,
  cancelRehearsalRun,
  createRehearsalRunForUpload,
  fetchRehearsalReport,
  prepareRehearsalEvaluationRun,
  runRehearsalUploadFlow,
} from "../api/rehearsalApi";
import {
  clearPreparedRehearsalSlideSnapshots,
  readPreparedRehearsalSlideSnapshots,
} from "../rehearsalSlideSnapshots";

type RehearsalRunPhase = "uploading" | "processing" | "succeeded" | "failed";

type UseRehearsalRunLifecycleOptions = {
  getLiveTranscript: () => string;
  getRunMeta: () => Promise<RehearsalRunMeta | null>;
  getSlideTranscriptSnapshots: () => SlideTranscriptSnapshot[];
  onCompletionModalChange: (isOpen: boolean) => void;
  onError: (message: string) => void;
  onJobChange: (job: Job | null) => void;
  onLiveError: (message: string) => void;
  onPhaseChange: (phase: RehearsalRunPhase) => void;
  onRunChange: (run: RehearsalRun | null) => void;
  snapshotPreparationId?: string;
  sourceGoalSetId?: string;
};

export function useRehearsalRunLifecycle(
  options: UseRehearsalRunLifecycleOptions,
) {
  const activeRunRef = useRef<RehearsalRun | null>(null);
  const preparedSlideSnapshotsRef = useRef<
    Array<{ fileId: string; slideId: string }> | undefined
  >(undefined);
  const finishAfterReportRef = useRef(false);
  const submissionVersionRef = useRef(0);

  useEffect(
    () => () => {
      const pendingRun = activeRunRef.current;
      if (pendingRun && ["created", "uploading"].includes(pendingRun.status)) {
        void cancelRehearsalRun(pendingRun.runId).catch(() => undefined);
      }
      activeRunRef.current = null;
    },
    [],
  );

  function getActiveRun() {
    return activeRunRef.current;
  }

  function beginRecordingAttempt() {
    submissionVersionRef.current += 1;
    cancelPendingEvaluationRun();
    finishAfterReportRef.current = false;
  }

  function requestFinishAfterReport() {
    finishAfterReportRef.current = true;
  }

  async function prepareEvaluationSnapshot(
    activeDeck: Deck,
  ): Promise<RehearsalEvaluationSnapshot> {
    const coachingContext = await resolveRehearsalCoachingContext(
      activeDeck.projectId,
      options.sourceGoalSetId,
    );
    const slideSnapshots =
      preparedSlideSnapshotsRef.current ??
      readPreparedRehearsalSlideSnapshots({
        deckId: activeDeck.deckId,
        deckVersion: activeDeck.version,
        preparationId: options.snapshotPreparationId,
        projectId: activeDeck.projectId,
      });
    preparedSlideSnapshotsRef.current = slideSnapshots;
    const prepared = await prepareRehearsalEvaluationRun(
      activeDeck,
      fetch,
      coachingContext,
      slideSnapshots,
    );
    activeRunRef.current = prepared.run;
    options.onRunChange(prepared.run);
    if (prepared.run) {
      clearPreparedRehearsalSlideSnapshots(options.snapshotPreparationId);
    }
    if (prepared.serverEvaluation.state === "unavailable") {
      options.onLiveError(
        "서버 의미 평가에 연결할 수 없습니다. 로컬 리허설은 계속되며 서버 리포트는 저장 전 다시 확인합니다.",
      );
    }
    return prepared.evaluationSnapshot;
  }

  function cancelPendingEvaluationRun() {
    const pendingRun = activeRunRef.current;
    if (!pendingRun || !["created", "uploading"].includes(pendingRun.status)) {
      return;
    }

    activeRunRef.current = null;
    void cancelRehearsalRun(pendingRun.runId).catch(() => undefined);
  }

  async function submitRecording(activeDeck: Deck, audioFile: File) {
    const submissionVersion = submissionVersionRef.current;
    const isCurrentSubmission = () =>
      submissionVersionRef.current === submissionVersion;

    options.onPhaseChange("uploading");
    options.onError("");

    try {
      let uploadRun = activeRunRef.current;
      if (!uploadRun) {
        const recovered = await createRehearsalRunForUpload(
          activeDeck.projectId,
          activeDeck.deckId,
          activeDeck.version,
          fetch,
          await resolveRehearsalCoachingContext(
            activeDeck.projectId,
            options.sourceGoalSetId,
          ),
          preparedSlideSnapshotsRef.current,
        );
        uploadRun = recovered.run;
        if (!isCurrentSubmission()) {
          void cancelRehearsalRun(uploadRun.runId).catch(() => undefined);
          return;
        }
        if (recovered.evaluationSnapshotMismatch) {
          options.onLiveError(
            "발표 자료가 변경되어 이번 회차는 전달 방식만 분석하고 의미 평가는 제외합니다.",
          );
        }
        activeRunRef.current = uploadRun;
        options.onRunChange(uploadRun);
        clearPreparedRehearsalSlideSnapshots(options.snapshotPreparationId);
      }

      const result = await runRehearsalUploadFlow({
        runId: uploadRun.runId,
        audioFile,
        runMeta: await options.getRunMeta(),
        liveTranscript: options.getLiveTranscript(),
        slideTranscriptSnapshots: options.getSlideTranscriptSnapshots(),
        onJobUpdate: (nextJob) => {
          if (!isCurrentSubmission()) {
            return;
          }
          options.onJobChange(nextJob);
          options.onPhaseChange("processing");
        },
      });
      if (!isCurrentSubmission()) {
        return;
      }
      activeRunRef.current = result.run;
      options.onRunChange(result.run);
      options.onJobChange(result.job);

      if (result.job.status === "failed") {
        options.onPhaseChange("failed");
        options.onCompletionModalChange(false);
        options.onError(
          result.job.error?.message ||
            result.job.message ||
            "리허설 분석에 실패했습니다.",
        );
        return;
      }

      await loadReportForRun(result.run.runId, result.run, isCurrentSubmission);
      if (!isCurrentSubmission()) {
        return;
      }
      options.onPhaseChange("succeeded");
      options.onCompletionModalChange(true);
      finishAfterReportRef.current = false;
    } catch (cause) {
      if (!isCurrentSubmission()) {
        return;
      }
      options.onError(toRehearsalFlowMessage(cause));
      options.onCompletionModalChange(false);
      options.onPhaseChange("failed");
    }
  }

  async function loadReportForRun(
    runId: string,
    fallbackRun: RehearsalRun,
    shouldApply: () => boolean,
  ) {
    try {
      const response = await fetchRehearsalReport(runId);
      if (shouldApply()) {
        options.onRunChange(response.run);
      }
    } catch {
      if (shouldApply()) {
        options.onRunChange(fallbackRun);
      }
    }
  }

  return {
    beginRecordingAttempt,
    cancelPendingEvaluationRun,
    getActiveRun,
    prepareEvaluationSnapshot,
    requestFinishAfterReport,
    submitRecording,
  };
}

async function resolveRehearsalCoachingContext(
  projectId: string,
  sourceGoalSetId?: string,
) {
  try {
    const brief = await fetchPresentationBrief(projectId);
    if (brief) {
      return {
        briefRef: {
          mode: "briefed" as const,
          briefId: brief.briefId,
          expectedRevision: brief.revision,
        },
        evaluatorLensRef: brief.evaluatorLensRef,
        sourceGoalSetId: sourceGoalSetId ?? null,
      };
    }
  } catch {
    // Brief 조회 실패 시에도 일반 모드 리허설은 계속할 수 있다.
  }
  return {
    briefRef: { mode: "generic" as const },
    evaluatorLensRef: {
      lensId: "general-novice" as const,
      revision: 1 as const,
    },
    sourceGoalSetId: sourceGoalSetId ?? null,
  };
}

function toRehearsalFlowMessage(cause: unknown) {
  if (cause instanceof RehearsalFlowError) {
    if (cause.stage === "storage-put") {
      return "업로드가 중단되었습니다. 네트워크와 스토리지 연결을 확인해 주세요.";
    }

    if (cause.stage === "complete" || cause.stage === "job-poll") {
      return cause.message || "음성 인식 또는 코칭 분석 작업에 실패했습니다.";
    }
  }

  return cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.";
}
