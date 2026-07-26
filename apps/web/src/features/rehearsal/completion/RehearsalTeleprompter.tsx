import { CheckCircle2 } from "lucide-react";

import type { AdvanceControllerState } from "../../../runtime/presentation/advance/advanceController";
import { RehearsalScriptTeleprompter } from "../../presenter-shell/presenter/RehearsalScriptTeleprompter";
import type { RehearsalPrompterRows } from "../rehearsalWorkspaceModel";

export function RehearsalTeleprompter(props: {
  countdownMs: number;
  focusScopeId: string;
  nowMs: number;
  onCancel: () => void;
  rows: RehearsalPrompterRows;
  scriptProgressPercent: number;
  state: AdvanceControllerState;
}) {
  const countdownSeconds = getAutoAdvanceCountdownSeconds(
    props.state,
    props.countdownMs,
    props.nowMs,
  );

  return (
    <RehearsalScriptTeleprompter
      focusScopeId={props.focusScopeId}
      progressPercent={props.scriptProgressPercent}
      rows={props.rows.items.map((row) => ({
        id: row.sentenceId,
        isFocusTarget: row.isFocusTarget,
        status: row.status,
        text: row.text,
      }))}
    >
      {countdownSeconds !== null ? (
        <div className="rehearsal-auto-advance-card" role="status">
          <strong>{countdownSeconds}</strong>
          <span>다음으로 자동 전환</span>
          <button type="button" onClick={props.onCancel}>
            취소
          </button>
        </div>
      ) : props.state.status === "blocked-by-builds" ? (
        <div
          className="rehearsal-auto-advance-card rehearsal-auto-advance-card-muted"
          role="status"
        >
          <strong>{props.state.remainingTriggerSteps}</strong>
          <span>빌드가 남아 있어요</span>
        </div>
      ) : props.state.status === "finish-suggested" ? (
        <div
          className="rehearsal-auto-advance-card rehearsal-auto-advance-card-muted"
          role="status"
        >
          <CheckCircle2 size={22} />
          <span>발표 종료 준비됨</span>
        </div>
      ) : null}
    </RehearsalScriptTeleprompter>
  );
}

function getAutoAdvanceCountdownSeconds(
  state: AdvanceControllerState,
  countdownMs: number,
  nowMs: number,
) {
  if (state.status !== "countdown" || state.countdownStartedAtMs === null) {
    return null;
  }

  const remainingMs = Math.max(
    countdownMs - (nowMs - state.countdownStartedAtMs),
    0,
  );
  return Math.max(1, Math.ceil(remainingMs / 1000));
}
