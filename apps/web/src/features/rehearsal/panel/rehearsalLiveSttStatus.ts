export type RehearsalLiveSttStatus =
  | "idle"
  | "starting"
  | "listening"
  | "unavailable"
  | "failed"
  | "stopped";

export type RehearsalLiveSttStatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger";

export type RehearsalLiveSttStatusModel = {
  description: string;
  errorMessage: string | null;
  label: string;
  shouldShow: boolean;
  tone: RehearsalLiveSttStatusTone;
  topbarLabel: string;
};

export function buildRehearsalLiveSttStatusModel(options: {
  isRecording: boolean;
  liveError: string;
  liveStatus: RehearsalLiveSttStatus;
}): RehearsalLiveSttStatusModel {
  const errorMessage = sanitizeLiveSttErrorMessage(options.liveError);

  if (options.liveStatus === "listening") {
    return {
      description:
        "발화가 하단 대본의 원문 진행률과 자동 따라가기에 반영됩니다.",
      errorMessage: null,
      label: "음성 인식 연결됨",
      shouldShow: true,
      tone: "success",
      topbarLabel: options.isRecording ? "녹음 · 음성 인식 중" : "음성 인식 중",
    };
  }

  if (options.liveStatus === "starting") {
    return {
      description: "마이크 입력과 음성 인식 엔진을 연결하고 있습니다.",
      errorMessage: null,
      label: "음성 인식 연결 중",
      shouldShow: true,
      tone: "neutral",
      topbarLabel: options.isRecording
        ? "녹음 중 · 음성 인식 연결 중"
        : "음성 인식 연결 중",
    };
  }

  if (options.liveStatus === "failed" || options.liveStatus === "unavailable") {
    return {
      description: options.isRecording
        ? "녹음과 리포트 생성은 계속되지만 하단 대본 자동 따라가기가 일시 중단되었습니다."
        : "하단 대본 자동 따라가기를 사용할 수 없습니다.",
      errorMessage: errorMessage ?? "음성 인식 연결을 완료하지 못했습니다.",
      label:
        options.liveStatus === "unavailable"
          ? "음성 인식 사용 불가"
          : "음성 인식 연결 실패",
      shouldShow: true,
      tone: options.liveStatus === "unavailable" ? "warning" : "danger",
      topbarLabel: options.isRecording
        ? "녹음 중 · 음성 인식 오류"
        : "음성 인식 오류",
    };
  }

  if (options.isRecording) {
    return {
      description: "녹음을 유지하면서 음성 인식 연결을 준비하고 있습니다.",
      errorMessage: null,
      label: "음성 인식 준비 중",
      shouldShow: true,
      tone: "neutral",
      topbarLabel: "녹음 중 · 음성 인식 준비 중",
    };
  }

  return {
    description: "",
    errorMessage: null,
    label: "",
    shouldShow: false,
    tone: "neutral",
    topbarLabel: "준비됨",
  };
}

export function canRetryInitialRecordingLiveStt(options: {
  hasActiveSession: boolean;
  hasReusableStream: boolean;
  isRecording: boolean;
  isRetrying: boolean;
  liveStatus: RehearsalLiveSttStatus;
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
