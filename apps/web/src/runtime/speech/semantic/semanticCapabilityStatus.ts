import type {
  SemanticCapability,
  SemanticMeasurementMode,
} from "@orbit/shared/rehearsals";

export type SemanticCapabilityStatusItem = {
  key: SemanticCapability;
  severity: "info" | "warning" | "error";
  shortLabel: string;
  detail: string;
  retryable: boolean;
  affectedCount: number;
  source: "system-status";
  actionLabel?:
    | "마이크 권한 확인"
    | "재시도"
    | "Cue 검토로 이동"
    | "서버 재평가";
  recovered: boolean;
  measurementMode: SemanticMeasurementMode;
};
