import { AlertCircle, FastForward, Flag, TimerReset } from "lucide-react";
import type { AdvanceControllerState } from "../../../runtime/presentation/advance/advanceController";

export function AutoAdvanceStatus(props: {
  countdownMs: number;
  nowMs: number;
  onFinish: () => void;
  state: AdvanceControllerState;
}) {
  const { state } = props;

  if (state.status === "countdown" && state.countdownStartedAtMs !== null) {
    const remainingMs = Math.max(
      props.countdownMs - (props.nowMs - state.countdownStartedAtMs),
      0
    );
    return (
      <div className="auto-advance-status auto-advance-status-countdown" role="status">
        <TimerReset size={18} />
        <span>
          자동 전환까지 <strong>{Math.ceil(remainingMs / 1000)}초</strong>
        </span>
      </div>
    );
  }

  if (state.status === "blocked-by-builds" && state.remainingTriggerSteps > 0) {
    return (
      <div className="auto-advance-status auto-advance-status-blocked" role="status">
        <FastForward size={18} />
        <span>빌드 {state.remainingTriggerSteps}개 남음</span>
      </div>
    );
  }

  if (state.status === "finish-suggested") {
    return (
      <div className="auto-advance-status auto-advance-status-finish" role="status">
        <Flag size={18} />
        <span>발표 종료 준비됨</span>
        <button type="button" onClick={props.onFinish}>
          종료
        </button>
      </div>
    );
  }

  if (state.status === "tracking" && state.manualGuidanceShown) {
    return (
      <div className="auto-advance-status auto-advance-status-guidance" role="status">
        <AlertCircle size={18} />
        <span>자동 전환 조건이 부족합니다. 필요하면 수동으로 넘겨주세요.</span>
      </div>
    );
  }

  return null;
}
