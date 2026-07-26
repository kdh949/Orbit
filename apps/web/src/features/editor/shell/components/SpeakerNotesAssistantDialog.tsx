import type {
  SpeakerNotesSuggestionMode,
  SpeakerNotesSuggestionResult,
} from "@orbit/shared/deck";
import {
  IconAlertTriangle as AlertTriangle,
  IconSparkles as Sparkles
} from "@tabler/icons-react";

import { OrbitButton, OrbitDialog, OrbitStatus } from "../../../../components/ui";
import { formatSpeakerNotesDuration } from "../speakerNotesAssistant";
import type { SpeakerNotesLengthGuidance } from "../speakerNotesAssistant";

export type SpeakerNotesAssistantStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed";

export function SpeakerNotesLengthMeter(props: {
  guidance: SpeakerNotesLengthGuidance;
}) {
  const duration = formatSpeakerNotesDuration(props.guidance.estimatedSeconds);
  return (
    <div className={`speaker-notes-length-meter ${props.guidance.tone}`}>
      <div>
        <strong>{props.guidance.label}</strong>
        <span>
          {props.guidance.characterCount.toLocaleString()}자
          {props.guidance.targetCharacters
            ? ` / 권장 ${props.guidance.targetCharacters.toLocaleString()}자`
            : ""}
          {duration ? ` · ${duration}` : ""}
        </span>
      </div>
      {props.guidance.progressPercent !== undefined ? (
        <span
          aria-label={`권장 분량의 ${props.guidance.progressPercent}%`}
          className="speaker-notes-length-track"
          role="progressbar"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={props.guidance.progressPercent}
        >
          <span style={{ width: `${props.guidance.progressPercent}%` }} />
        </span>
      ) : null}
    </div>
  );
}

const refinementModes: Array<{
  description: string;
  label: string;
  value: Exclude<SpeakerNotesSuggestionMode, "draft" | "icebreaker">;
}> = [
  {
    value: "shorten",
    label: "더 간결하게",
    description: "핵심 내용은 유지하고 문장을 줄여요.",
  },
  {
    value: "naturalize",
    label: "말하듯 자연스럽게",
    description: "읽기 좋은 구어체 흐름으로 다듬어요.",
  },
  {
    value: "emphasize",
    label: "핵심 강조",
    description: "가장 중요한 메시지가 잘 들리게 정리해요.",
  },
];

export function SpeakerNotesAssistantDialog(props: {
  errorMessage: string;
  mode: SpeakerNotesSuggestionMode;
  occurrenceWarning?: string;
  onApply: () => void;
  onClose: () => void;
  onGenerate: () => void;
  onModeChange: (mode: SpeakerNotesSuggestionMode) => void;
  open: boolean;
  originalNotes: string;
  result: SpeakerNotesSuggestionResult | null;
  status: SpeakerNotesAssistantStatus;
}) {
  const isDraft = props.originalNotes.trim().length === 0;
  const isIcebreaker = props.mode === "icebreaker";
  const isRunning = props.status === "running";

  return (
    <OrbitDialog
      className="speaker-notes-assistant-dialog"
      description={isIcebreaker
        ? "현재 슬라이드 내용에 어울리는 짧은 오프닝을 만들어 발표 메모에 추가합니다."
        : "AI 제안을 먼저 비교하고, 원하는 경우 편집 초안에만 넣을 수 있습니다."}
      footer={
        <>
          <OrbitButton onClick={props.onClose} variant="secondary">
            닫기
          </OrbitButton>
          {props.result ? (
            <OrbitButton onClick={props.onApply}>
              {isIcebreaker ? "대본에 적용" : "편집 초안에 넣기"}
            </OrbitButton>
          ) : (
            <OrbitButton
              disabled={isRunning}
              icon={<Sparkles aria-hidden="true" size={16} />}
              onClick={props.onGenerate}
            >
              {isRunning
                ? "제안 만드는 중"
                : isIcebreaker
                  ? "인트로 생성"
                  : isDraft
                    ? "초안 생성"
                    : "제안 생성"}
            </OrbitButton>
          )}
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title={isIcebreaker
        ? "아이스브레이킹 인트로 만들기"
        : isDraft
          ? "AI 발표 메모 초안"
          : "AI로 발표 메모 다듬기"}
    >
      {!isDraft && !isIcebreaker && !props.result ? (
        <fieldset className="speaker-notes-mode-list" disabled={isRunning}>
          <legend>어떻게 다듬을까요?</legend>
          {refinementModes.map((option) => (
            <label
              className={props.mode === option.value ? "selected" : ""}
              key={option.value}
            >
              <input
                checked={props.mode === option.value}
                name="speaker-notes-mode"
                onChange={() => props.onModeChange(option.value)}
                type="radio"
                value={option.value}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {isRunning ? (
        <div aria-live="polite" className="speaker-notes-assistant-progress" role="status">
          <Sparkles aria-hidden="true" size={20} />
          <div>
            <strong>슬라이드 맥락을 살펴보고 있어요.</strong>
            <span>완료되면 원문과 제안을 나란히 보여드릴게요.</span>
          </div>
        </div>
      ) : null}

      {props.errorMessage ? (
        <div className="speaker-notes-assistant-error" role="alert">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>{props.errorMessage}</span>
        </div>
      ) : null}

      {props.result ? (
        <div className="speaker-notes-comparison">
          <article>
            <div className="speaker-notes-comparison-heading">
              <strong>현재 메모</strong>
              <OrbitStatus>{isDraft ? "비어 있음" : "원문"}</OrbitStatus>
            </div>
            <p>{props.originalNotes || "아직 작성된 발표 메모가 없습니다."}</p>
          </article>
          <article className="suggestion">
            <div className="speaker-notes-comparison-heading">
              <strong>AI 제안</strong>
              <OrbitStatus tone="lilac">
                {props.result.metrics.characterCount.toLocaleString()}자
                {formatSpeakerNotesDuration(props.result.metrics.estimatedSeconds)
                  ? ` · ${formatSpeakerNotesDuration(props.result.metrics.estimatedSeconds)}`
                  : ""}
              </OrbitStatus>
            </div>
            <p>{props.result.suggestedNotes}</p>
            <small>{props.result.summary}</small>
          </article>
          {props.occurrenceWarning ? (
            <div className="speaker-notes-assistant-warning" role="note">
              <AlertTriangle aria-hidden="true" size={17} />
              <span>{props.occurrenceWarning}</span>
            </div>
          ) : null}
          {props.result.warnings.map((warning) => (
            <div className="speaker-notes-assistant-warning" key={warning} role="note">
              <AlertTriangle aria-hidden="true" size={17} />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}
    </OrbitDialog>
  );
}
