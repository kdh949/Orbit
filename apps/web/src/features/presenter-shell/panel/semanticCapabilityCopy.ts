import type {
  SemanticCapabilityEvent,
  SemanticFallbackReason
} from "@orbit/shared";

export type SemanticCapabilityCopy = {
  source: "system-status";
  shortLabel: string;
  detail: string;
  actionLabel?:
    | "마이크 권한 확인"
    | "재시도"
    | "Cue 검토로 이동"
    | "서버 재평가";
};

export function getSemanticCapabilityCopy(
  event: SemanticCapabilityEvent
): SemanticCapabilityCopy {
  if (event.toState === "available") {
    return {
      source: "system-status",
      shortLabel: "복구됨",
      detail: `${getCapabilityName(event.capability)} 기능을 다시 사용할 수 있습니다.`
    };
  }

  const copy = fallbackCopy[event.reason ?? "runtime_error"];
  if (event.reason === "user_disabled" && event.capability === "stt") {
    return {
      source: "system-status",
      shortLabel: "음성 인식 꺼짐",
      detail: "음성 기반 체크 없이 수동 발표를 계속합니다."
    };
  }
  if (
    event.reason === "user_disabled" &&
    (event.capability === "semantic_runtime" || event.capability === "nli")
  ) {
    return {
      source: "system-status",
      shortLabel: "기본 의미 체크",
      detail: "정밀 판정 없이 확인 가능한 표현만 체크합니다."
    };
  }
  return copy;
}

const fallbackCopy: Record<SemanticFallbackReason, SemanticCapabilityCopy> = {
  user_disabled: {
    source: "system-status",
    shortLabel: "기능 꺼짐",
    detail: "사용자 설정에 따라 이 기능을 사용하지 않습니다."
  },
  permission_denied: {
    source: "system-status",
    shortLabel: "마이크 권한 필요",
    detail: "브라우저의 마이크 권한을 확인하면 음성 체크를 다시 시작할 수 있습니다.",
    actionLabel: "마이크 권한 확인"
  },
  stt_unavailable: {
    source: "system-status",
    shortLabel: "음성 체크 꺼짐",
    detail: "음성 인식을 사용할 수 없어 수동 발표를 유지합니다.",
    actionLabel: "재시도"
  },
  network_error: {
    source: "system-status",
    shortLabel: "의미 체크 오프라인",
    detail: "네트워크 연결을 확인하는 동안 수동 발표를 유지합니다.",
    actionLabel: "재시도"
  },
  provider_unavailable: {
    source: "system-status",
    shortLabel: "정밀 판정 비활성",
    detail: "정밀 판정 provider를 사용할 수 없어 기본 의미 체크로 계속합니다.",
    actionLabel: "재시도"
  },
  model_not_ready: {
    source: "system-status",
    shortLabel: "의미 모델 준비 중",
    detail: "모델이 준비되는 동안 확인 가능한 기본 체크만 사용합니다."
  },
  model_load_failed: {
    source: "system-status",
    shortLabel: "정밀 판정 비활성",
    detail: "의미 모델을 불러오지 못해 기본 의미 체크로 계속합니다.",
    actionLabel: "재시도"
  },
  timeout: {
    source: "system-status",
    shortLabel: "정밀 판정 비활성",
    detail: "정밀 판정 응답이 늦어 기본 의미 체크로 계속합니다.",
    actionLabel: "재시도"
  },
  runtime_error: {
    source: "system-status",
    shortLabel: "의미 체크 오프라인",
    detail: "의미 체크가 중단됐지만 수동 발표와 타이머는 계속 사용할 수 있습니다.",
    actionLabel: "재시도"
  },
  server_evaluation_failed: {
    source: "system-status",
    shortLabel: "서버 의미 평가 불가",
    detail: "리허설은 계속되며 발표 후 의미 평가는 나중에 다시 시도할 수 있습니다.",
    actionLabel: "서버 재평가"
  },
  stale_cue: {
    source: "system-status",
    shortLabel: "Cue 재검토 필요",
    detail: "슬라이드 내용과 달라진 Cue는 재검토 전까지 의미 체크에서 제외됩니다.",
    actionLabel: "Cue 검토로 이동"
  },
  transcript_incomplete: {
    source: "system-status",
    shortLabel: "근거 부족",
    detail: "완료된 음성 구간이 부족해 해당 구간을 판정하지 않습니다."
  },
  no_transcript: {
    source: "system-status",
    shortLabel: "근거 부족",
    detail: "확인할 음성 근거가 없어 의미 결과를 만들지 않습니다."
  },
  insufficient_evidence: {
    source: "system-status",
    shortLabel: "근거 부족",
    detail: "확실한 근거가 없어 의미 결과를 단정하지 않습니다."
  },
  slide_not_visited: {
    source: "system-status",
    shortLabel: "방문하지 않은 슬라이드",
    detail: "발표하지 않은 슬라이드는 의미 결과를 만들지 않습니다."
  },
  evaluation_not_run: {
    source: "system-status",
    shortLabel: "서버 의미 평가 불가",
    detail: "이 리허설에는 서버 의미 평가 기록이 없습니다.",
    actionLabel: "서버 재평가"
  },
  evaluation_snapshot_mismatch: {
    source: "system-status",
    shortLabel: "서버 의미 평가 불가",
    detail: "발표 자료 버전이 달라 의미 결과를 비교하지 않습니다."
  },
  queue_dropped: {
    source: "system-status",
    shortLabel: "의미 근거 처리 지연",
    detail: "전환 직전 근거를 제시간에 처리하지 못해 해당 구간을 판정하지 않습니다.",
    actionLabel: "재시도"
  },
  needs_confirmation: {
    source: "system-status",
    shortLabel: "확인 필요",
    detail: "확실하지 않은 의미 결과는 자동 동작에 사용하지 않습니다."
  }
};

function getCapabilityName(capability: SemanticCapabilityEvent["capability"]) {
  switch (capability) {
    case "stt":
      return "음성 체크";
    case "semantic_runtime":
      return "의미 체크";
    case "embedding":
      return "기본 의미 체크";
    case "nli":
      return "정밀 판정";
    case "server_evaluation":
      return "서버 의미 평가";
    case "cue_freshness":
      return "Cue 검토";
    case "transcript_evidence":
      return "음성 근거";
  }
}
