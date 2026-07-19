import { IconDeviceFloppy as Save } from "@tabler/icons-react";

type EditorSaveControlProps = {
  emptyStateLabel?: string;
  disabled?: boolean;
  isSaving: boolean;
  lastSavedAtLabel: string | null;
  onSave: () => void;
  recoveryHint?: string | null;
  retrying?: boolean;
  statusLabel: string;
};

export function EditorSaveControl(props: EditorSaveControlProps) {
  const {
    disabled = false,
    emptyStateLabel = "저장 기록 없음",
    isSaving,
    lastSavedAtLabel,
    onSave,
    recoveryHint = null,
    retrying = false,
    statusLabel
  } = props;
  const actionLabel = isSaving ? "저장 중" : retrying ? "저장 재시도" : "저장";

  return (
    <div className="editor-save-control">
      <button
        aria-label={actionLabel}
        className="editor-save-button"
        disabled={disabled || isSaving}
        title={actionLabel}
        type="button"
        onClick={onSave}
      >
        <Save aria-hidden="true" size={16} />
      </button>
      <div className="editor-save-meta">
        <span className="editor-save-status">{statusLabel}</span>
        {recoveryHint ? <span className="editor-save-status">{recoveryHint}</span> : null}
        <span className="editor-save-time">
          {lastSavedAtLabel ? `마지막 저장 ${lastSavedAtLabel}` : emptyStateLabel}
        </span>
      </div>
    </div>
  );
}
