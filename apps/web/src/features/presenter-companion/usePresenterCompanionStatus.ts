import { useCallback, useEffect, useState } from "react";
import type { PresentationCompanionStatus } from "@orbit/shared";
import { fetchPresenterCompanionStatus } from "./presenterCompanionApi";

export const presenterCompanionStatusPollIntervalMs = 3_000;

export type PresenterCompanionStatusController = {
  refresh: () => Promise<void>;
  setStatus: (status: PresentationCompanionStatus | null) => void;
  status: PresentationCompanionStatus | null;
  statusUnavailable: boolean;
};

export function startPresenterCompanionStatusPolling(
  refresh: () => void,
  timer: {
    clearInterval: (intervalId: number) => void;
    setInterval: (callback: () => void, intervalMs: number) => number;
  },
) {
  refresh();
  const intervalId = timer.setInterval(
    refresh,
    presenterCompanionStatusPollIntervalMs,
  );
  return () => timer.clearInterval(intervalId);
}

export function usePresenterCompanionStatus(
  input: {
    projectId: string;
    sessionId: string;
  },
  options: { enabled?: boolean } = {},
): PresenterCompanionStatusController {
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<PresentationCompanionStatus | null>(
    null,
  );
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const updateStatus = useCallback(
    (nextStatus: PresentationCompanionStatus | null) => {
      setStatus(nextStatus);
      setStatusUnavailable(false);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      updateStatus(
        await fetchPresenterCompanionStatus({
          projectId: input.projectId,
          sessionId: input.sessionId,
        }),
      );
    } catch {
      setStatusUnavailable(true);
    }
  }, [input.projectId, input.sessionId, updateStatus]);

  useEffect(() => {
    if (!enabled) return undefined;
    return startPresenterCompanionStatusPolling(
      () => void refresh(),
      {
        clearInterval: (intervalId) =>
          window.clearInterval(intervalId),
        setInterval: (callback, intervalMs) =>
          window.setInterval(callback, intervalMs),
      },
    );
  }, [enabled, refresh]);

  return {
    refresh,
    setStatus: updateStatus,
    status,
    statusUnavailable,
  };
}
