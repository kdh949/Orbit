import type { PptxImportState } from "./components/PptxImportQualityPanel";
import type {
  SaveErrorCode,
  SaveState,
} from "./hooks/useEditorPersistenceState";

export function getEditorStatusLabel(props: {
  isDeckError: boolean;
  isDeckLoading: boolean;
  isUsingFallbackDeck: boolean;
  saveState: SaveState;
}) {
  if (props.isDeckLoading) {
    return "불러오는 중";
  }

  if (props.saveState === "error") {
    return "저장 실패";
  }

  if (props.isDeckError) {
    return "오프라인 데모";
  }

  if (props.isUsingFallbackDeck) {
    return "로컬 데모";
  }

  if (props.saveState === "manual-saving") {
    return "수동 저장 중";
  }

  if (props.saveState === "manual-saved") {
    return "수동 저장됨";
  }

  if (props.saveState === "auto-saving") {
    return "자동 저장 중";
  }

  if (props.saveState === "auto-pending") {
    return "저장 대기 중";
  }

  if (props.saveState === "conflict-recovered") {
    return "충돌 복구 후 저장됨";
  }

  return "저장됨";
}

export function pptxImportMenuMeta(state: PptxImportState) {
  if (state.status === "uploading") return "업로드 중...";
  if (state.status === "importing") return "변환 중...";
  if (state.status === "succeeded" && state.qualityReport) {
    return `품질 ${state.qualityReport.compositeScore}`;
  }
  if (state.status === "error") return "실패";
  return "업로드";
}

export function isSaveInFlight(saveState: SaveState) {
  return saveState === "auto-saving" || saveState === "manual-saving";
}

export function getSaveErrorStatusLabel(saveErrorCode: SaveErrorCode | null) {
  switch (saveErrorCode) {
    case "manual-render-failed":
      return "렌더 저장 실패";
    case "conflict-recovery-failed":
      return "충돌 복구 실패";
    case "rehearsal-blocked":
      return "리허설 준비 중단";
    case "rehearsal-save-failed":
      return "리허설 저장 실패";
    case "missing-project":
    case "missing-persisted-base":
    case "auto-save-failed":
      return "저장 실패";
    default:
      return "저장 실패";
  }
}

export function getSaveRecoveryHint(saveErrorCode: SaveErrorCode | null) {
  switch (saveErrorCode) {
    case "manual-render-failed":
      return "다시 저장 필요";
    case "conflict-recovery-failed":
      return "새로고침 후 재시도";
    case "rehearsal-blocked":
      return "발표 자료를 먼저 불러와 주세요";
    case "rehearsal-save-failed":
      return "리허설 다시 시작";
    case "missing-project":
    case "missing-persisted-base":
      return "새로고침 후 재시도";
    case "auto-save-failed":
      return "저장 버튼으로 재시도";
    default:
      return null;
  }
}

export function formatLastSavedAtLabel(
  lastSavedAt: string | null,
): string | null {
  if (!lastSavedAt) {
    return null;
  }

  const date = new Date(lastSavedAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
