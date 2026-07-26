export type RehearsalLiveSttRecoveryStatus =
  | "idle"
  | "starting"
  | "listening"
  | "unavailable"
  | "failed"
  | "stopped";

export function canRetryInitialRecordingLiveStt(options: {
  hasActiveSession: boolean;
  hasReusableStream: boolean;
  isRecording: boolean;
  isRetrying: boolean;
  liveStatus: RehearsalLiveSttRecoveryStatus;
}) {
  return (
    options.isRecording &&
    !options.hasActiveSession &&
    options.hasReusableStream &&
    !options.isRetrying &&
    (options.liveStatus === "failed" || options.liveStatus === "unavailable")
  );
}

export function createInitialLiveSttRetryCoordinator() {
  let pending: Promise<boolean> | null = null;
  let generation = 0;

  return {
    isRetrying() {
      return pending !== null;
    },
    cancel() {
      generation += 1;
    },
    retry(start: (isCurrent: () => boolean) => Promise<boolean>) {
      if (pending) {
        return pending;
      }

      const retryGeneration = ++generation;
      const isCurrent = () => generation === retryGeneration;
      pending = start(isCurrent)
        .then((started) => isCurrent() && started)
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

export function sanitizeLiveSttErrorMessage(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /((?:api[-_ ]?key|authorization|cookie|password|secret|token)\s*[:=]\s*)\S+/gi,
      "$1[redacted]",
    )
    .replace(
      /([?&](?:api_key|key|password|secret|token)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .slice(0, 240);
}
