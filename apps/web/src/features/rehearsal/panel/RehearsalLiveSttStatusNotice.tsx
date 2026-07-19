import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";

import type { RehearsalLiveSttStatusModel } from "./rehearsalLiveSttStatus";

export function RehearsalLiveSttStatusNotice(props: {
  canRetry: boolean;
  isRetrying: boolean;
  model: RehearsalLiveSttStatusModel;
  onRetry: () => void;
}) {
  if (!props.model.shouldShow) {
    return null;
  }

  const Icon =
    props.model.tone === "success"
      ? CheckCircle2
      : props.model.tone === "neutral"
        ? LoaderCircle
        : AlertCircle;

  return (
    <section
      aria-live="polite"
      className={`rehearsal-live-stt-notice rehearsal-live-stt-notice-${props.model.tone}`}
      role="status"
    >
      <Icon aria-hidden="true" size={18} />
      <div>
        <strong>{props.model.label}</strong>
        <span>{props.model.description}</span>
        {props.model.errorMessage ? (
          <small>{props.model.errorMessage}</small>
        ) : null}
      </div>
      {props.canRetry ? (
        <button
          disabled={props.isRetrying}
          onClick={props.onRetry}
          type="button"
        >
          {props.isRetrying ? "다시 연결 중" : "음성 인식 다시 연결"}
        </button>
      ) : null}
    </section>
  );
}
