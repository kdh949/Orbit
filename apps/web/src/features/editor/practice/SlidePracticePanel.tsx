import { type Deck, type Slide } from "@orbit/shared/deck";
import {
  slideQuestionGuideTextHashInput,
  type SlidePracticeReport,
} from "@orbit/shared/slide-practice";
import { useEffect, useRef } from "react";

import { OrbitButton } from "../../../components/ui";
import { PracticeReportContent } from "./PracticeReportContent";
import "./slide-practice.css";
import { flushOfflinePracticeReports } from "./slidePracticeApi";
import {
  slidePracticeDisabledMessage,
  slidePracticeRuntimeUnavailableMessage,
  type PracticeSessionState,
  type SlidePracticeRuntimeState,
  useSlidePracticeSession,
} from "./useSlidePracticeSession";

export function SlidePracticePanel(props: {
  projectId: string;
  deck: Deck;
  slide: Slide | null;
  onReportCreated: () => void;
  showInlineResult?: boolean;
}) {
  const lastReportedSessionRef = useRef<string | null>(null);
  const session = useSlidePracticeSession({
    projectId: props.projectId,
    deckId: props.deck.deckId,
    deckVersion: props.deck.version,
    slideId: props.slide?.slideId ?? null,
    slideOrder: props.slide?.order ?? 0,
    slideContentHashInput: props.slide
      ? slideQuestionGuideTextHashInput(props.slide)
      : null,
  });

  useEffect(() => {
    const flush = () => void flushOfflinePracticeReports();
    window.addEventListener("online", flush);
    flush();
    return () => window.removeEventListener("online", flush);
  }, []);

  useEffect(() => {
    const practiceSessionId = session.report?.practiceSessionId;
    if (practiceSessionId && lastReportedSessionRef.current !== practiceSessionId) {
      lastReportedSessionRef.current = practiceSessionId;
      props.onReportCreated();
    }
  }, [props, session.report?.practiceSessionId]);

  const recording = session.state === "recording";
  const busy = session.state === "starting" || session.state === "stopping";
  return (
    <div className="editor-practice-panel">
      <div className="editor-practice-controls">
        <div>
          <strong>현재 슬라이드 바로 연습</strong>
          <p>{props.slide ? `${props.slide.order + 1}. ${props.slide.title || "제목 없는 슬라이드"}` : "연습할 슬라이드가 없습니다."}</p>
        </div>
        <div className="editor-practice-timer" aria-live="polite">{formatDuration(session.elapsedMs)}</div>
        {recording ? (
          <button className="editor-practice-stop" type="button" onClick={() => void session.stop()}>연습 종료</button>
        ) : (
          <button
            className="editor-practice-start"
            disabled={!props.slide || busy || session.runtimeState !== "enabled"}
            type="button"
            onClick={() => void session.start()}
          >
            {getSlidePracticeStartLabel(session.state, session.runtimeState)}
          </button>
        )}
      </div>
      <SlidePracticeRuntimeNotice
        onRetry={session.retryRuntimeConfig}
        runtimeState={session.runtimeState}
      />
      {recording ? (
        <div className="editor-practice-transcript" aria-live="polite">
          녹음 중입니다. 연습을 종료하면 서버에서 전사와 목소리 지표를 분석합니다.
        </div>
      ) : null}
      {session.message &&
      session.message !== slidePracticeDisabledMessage &&
      session.message !== slidePracticeRuntimeUnavailableMessage ? (
        <p className="editor-practice-message" role="status">{session.message}</p>
      ) : null}
      {session.report && props.showInlineResult !== false ? <PracticeResult report={session.report} /> : null}
    </div>
  );
}

export function SlidePracticeRuntimeNotice(props: {
  onRetry: () => void;
  runtimeState: SlidePracticeRuntimeState;
}) {
  if (props.runtimeState === "disabled") {
    return <p className="editor-practice-message">{slidePracticeDisabledMessage}</p>;
  }
  if (props.runtimeState !== "unavailable") return null;
  return (
    <div aria-live="polite" className="editor-practice-runtime-error">
      <p className="editor-practice-message">
        {slidePracticeRuntimeUnavailableMessage}
      </p>
      <OrbitButton
        onClick={props.onRetry}
        size="compact"
        variant="secondary"
      >
        설정 다시 확인
      </OrbitButton>
    </div>
  );
}

export function getSlidePracticeStartLabel(
  state: PracticeSessionState,
  runtimeState: SlidePracticeRuntimeState,
) {
  if (runtimeState === "checking") return "연습 기능 확인 중…";
  if (runtimeState === "disabled") return "사용할 수 없음";
  if (runtimeState === "unavailable") return "설정 확인 필요";
  if (state === "stopping") return "분석 중…";
  if (state === "starting") return "준비 중…";
  return "연습 시작";
}

export function PracticeResult({ report }: { report: SlidePracticeReport }) {
  return <PracticeReportContent report={report} />;
}

function formatDuration(durationMs: number) {
  const seconds = Math.floor(durationMs / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatMetric(value: number | null, unit: string) {
  return value === null ? "측정 안 됨" : `${value.toFixed(1)} ${unit}`;
}

export function formatPracticePace(syllableCount: number, value: number | null) {
  return syllableCount === 0 ? "측정 안 됨" : formatMetric(value, "음절/초");
}

export function formatLoudness(value: number | null) {
  return formatMetric(value, "dBFS");
}

export function describePracticeQuality(input: {
  durationMs: number;
  reasons: SlidePracticeReport["quality"]["reasons"];
  syllableCount: number;
}) {
  return input.reasons.flatMap((reason) => {
    if (reason === "insufficient-speech") {
      const details: string[] = [];
      if (input.syllableCount < 5) {
        details.push(`전사된 음절이 ${input.syllableCount}개입니다. 정확한 속도 측정에는 5음절 이상 필요합니다.`);
      }
      if (input.durationMs < 3_000) {
        details.push(`연습 시간이 ${(input.durationMs / 1_000).toFixed(1)}초입니다. 3초 이상 연습해 주세요.`);
      }
      return details.length > 0 ? details : ["연습 분량이 충분하지 않습니다."];
    }
    return [{
      "audio-analysis-unavailable": "목소리 분석을 사용할 수 없습니다.",
      "baseline-unavailable": "평소 목소리 비교 기준을 사용할 수 없습니다.",
      "low-audio-quality": "음질이 낮아 일부 목소리 지표를 측정하지 못했습니다.",
      "pitch-unavailable": "피치 변화를 측정하지 못했습니다.",
      "stt-unavailable": "음성 전사를 사용할 수 없어 말 속도와 습관어를 측정하지 못했습니다.",
    }[reason]];
  }).join(" ");
}
