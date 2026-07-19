import type { ActivityRun, ActivityRuntimeStatus } from "@orbit/shared";
import { useCallback, useEffect, useState } from "react";

import { activityApi, ActivityApiError } from "../api/activityApi";
import { startSequentialPolling } from "../model/sequentialPolling";
import { getActivityPrimaryCommand } from "../presenter/ActivityPresenterPanel";

export type ActivityEditorRuntime = {
  audienceUrl: string;
  run: ActivityRun;
  sessionId: string;
};

export function useActivityEditorRuntime(input: {
  activityId: string;
  deckId?: string;
  projectId?: string;
}) {
  const [runtime, setRuntime] = useState<ActivityEditorRuntime | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    if (!input.deckId || !input.projectId) {
      setRuntime(null);
      setError("");
      return;
    }
    try {
      const current = await activityApi.getCurrentSession(
        input.projectId,
        input.deckId
      );
      if (!current.session || !current.audienceUrl) {
        setRuntime(null);
        setError("");
        return;
      }
      let run: ActivityRun;
      try {
        run = (
          await activityApi.ensureRun(
            input.projectId,
            current.session.sessionId,
            input.activityId
          )
        ).run;
      } catch (cause) {
        if (
          !(cause instanceof ActivityApiError) ||
          cause.code !== "ACTIVITY_DEFINITION_LOCKED"
        ) {
          throw cause;
        }
        const currentRun = await activityApi.getCurrentRun(
          input.projectId,
          current.session.sessionId,
          input.activityId
        );
        if (!currentRun.run) throw cause;
        run = currentRun.run;
      }
      setRuntime({
        audienceUrl: current.audienceUrl,
        run,
        sessionId: current.session.sessionId
      });
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "참여 장표 실행 정보를 불러오지 못했습니다."
      );
    }
  }, [input.activityId, input.deckId, input.projectId]);

  useEffect(() => {
    return startSequentialPolling(refresh, 2_000);
  }, [refresh]);

  const supersede = useCallback(async () => {
    if (!input.projectId || !runtime || pending) return false;
    setPending(true);
    setError("");
    try {
      const response = await activityApi.supersedeRun(
        input.projectId,
        runtime.sessionId,
        runtime.run.activityRunId,
        { expectedRevision: runtime.run.revision }
      );
      setRuntime({ ...runtime, run: response.run });
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "새 실행 버전을 만들지 못했습니다."
      );
      await refresh();
      return false;
    } finally {
      setPending(false);
    }
  }, [input.projectId, pending, refresh, runtime]);

  const updateStatus = useCallback(async (nextStatus?: ActivityRuntimeStatus) => {
    if (!input.projectId || !runtime || pending) return false;
    setPending(true);
    setError("");
    try {
      const command = getActivityPrimaryCommand(runtime.run.status);
      const response = await activityApi.updateRunStatus(
        input.projectId,
        runtime.sessionId,
        runtime.run.activityRunId,
        {
          expectedRevision: runtime.run.revision,
          status: nextStatus ?? command.nextStatus
        }
      );
      setRuntime({ ...runtime, run: response.run });
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "참여 장표 상태를 변경하지 못했습니다."
      );
      await refresh();
      return false;
    } finally {
      setPending(false);
    }
  }, [input.projectId, pending, refresh, runtime]);

  return {
    error,
    locked: (runtime?.run.responseCount ?? 0) > 0,
    pending,
    refresh,
    runtime,
    supersede,
    updateStatus
  };
}
