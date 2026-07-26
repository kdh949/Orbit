import type { Deck } from "@orbit/shared/deck";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Mic,
  PlayCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type LiveSttEngineId,
  type LiveSttPort,
} from "../../../runtime/speech/stt/liveSttPort";
import { normalizeLiveTranscriptText } from "../../../runtime/speech/stt/liveTranscriptText";
import { requestRehearsalMicrophoneStream } from "../../presenter-shell/microphoneSettings";
import { defaultRehearsalCommandConfig } from "../rehearsalCommands";
import { RehearsalRunComparisonOverview } from "../RehearsalRunComparisonOverview";
import type { RehearsalRunComparisonViewModel } from "../rehearsalRunComparisonModel";

export function RehearsalPreflightScreen(props: {
  banner: string;
  canStart: boolean;
  companionSetup?: ReactNode;
  comparisonModel: RehearsalRunComparisonViewModel | null;
  createLiveSttPort: (engineId: LiveSttEngineId) => LiveSttPort;
  deck: Deck;
  onPracticeWithoutVoice: () => void;
  onStart: () => void;
  resolveLiveSttEngine: () => Promise<LiveSttEngineId>;
}) {
  const commandPhrases = defaultRehearsalCommandConfig
    .map((command) => command.phrases[0])
    .filter(Boolean)
    .slice(0, 3);
  const slideKeywordPhrases = props.deck.slides
    .flatMap((slide) => slide.keywords ?? [])
    .map((keyword) => keyword.text)
    .filter(Boolean);
  const samplePhrases = Array.from(
    new Set([...commandPhrases, ...slideKeywordPhrases]),
  ).slice(0, 4);
  const triggerCount = defaultRehearsalCommandConfig.reduce(
    (count, command) => count + command.phrases.length,
    0,
  );
  const [microphonePermission, setMicrophonePermission] =
    useState<PreflightMicrophonePermission>("checking");
  const [voiceCheckStatus, setVoiceCheckStatus] =
    useState<PreflightVoiceCheckStatus>("idle");
  const [voiceCheckError, setVoiceCheckError] = useState("");
  const [voiceCheckTranscript, setVoiceCheckTranscript] = useState("");
  const [voiceCheckLatencyMs, setVoiceCheckLatencyMs] = useState<number | null>(
    null,
  );
  const [matchedPhrases, setMatchedPhrases] = useState<readonly string[]>([]);
  const preflightStreamRef = useRef<MediaStream | null>(null);
  const preflightLiveSttPortRef = useRef<LiveSttPort | null>(null);
  const preflightLiveSttCleanupRef = useRef<(() => void) | null>(null);
  const preflightTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    async function syncMicrophonePermission() {
      if (typeof navigator === "undefined") {
        setMicrophonePermission("unsupported");
        return;
      }

      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        setMicrophonePermission("unsupported");
        return;
      }

      if (typeof navigator.permissions?.query !== "function") {
        setMicrophonePermission("prompt");
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        if (isCancelled) {
          return;
        }
        setMicrophonePermission(
          getPreflightMicrophonePermissionHint(permissionStatus.state),
        );
        permissionStatus.onchange = () => {
          setMicrophonePermission(
            getPreflightMicrophonePermissionHint(
              permissionStatus?.state ?? "prompt",
            ),
          );
        };
      } catch {
        if (!isCancelled) {
          setMicrophonePermission("prompt");
        }
      }
    }

    void syncMicrophonePermission();

    return () => {
      isCancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      stopPreflightVoiceResources();
    };
  }, []);

  const permissionStatus = getPreflightMicrophoneStatus(microphonePermission);
  const voiceStatus = getPreflightVoiceStatus(
    voiceCheckStatus,
    voiceCheckLatencyMs,
  );
  const triggerStatus = getPreflightTriggerStatus(
    matchedPhrases.length,
    samplePhrases.length,
    triggerCount,
  );
  const isMicrophoneGranted = microphonePermission === "granted";
  const canStartWithMicrophone = props.canStart && isMicrophoneGranted;
  const startDisabledReason = !props.canStart
    ? "발표자료 로딩이 끝난 뒤 시작할 수 있습니다."
    : !isMicrophoneGranted
      ? "마이크 연결을 확인해야 리허설을 시작할 수 있습니다."
      : "";

  async function requestPreflightMicrophonePermission() {
    stopPreflightVoiceResources();
    setVoiceCheckStatus("idle");
    setVoiceCheckError("");
    setVoiceCheckTranscript("");
    setVoiceCheckLatencyMs(null);
    setMatchedPhrases([]);

    if (typeof navigator === "undefined") {
      setMicrophonePermission("unsupported");
      return;
    }

    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setMicrophonePermission("unsupported");
      return;
    }

    try {
      const stream = await requestRehearsalMicrophoneStream(
        navigator.mediaDevices,
      );
      stopMediaStream(stream);
      setMicrophonePermission("granted");
    } catch (cause) {
      setMicrophonePermission(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "denied"
          : "prompt",
      );
      setVoiceCheckError(toMicrophoneErrorMessage(cause));
    }
  }

  async function startPreflightVoiceCheck() {
    if (!isMicrophoneGranted) {
      await requestPreflightMicrophonePermission();
      return;
    }

    stopPreflightVoiceResources();
    setVoiceCheckStatus("listening");
    setVoiceCheckError("");
    setVoiceCheckTranscript("");
    setVoiceCheckLatencyMs(null);
    setMatchedPhrases([]);

    if (typeof navigator === "undefined") {
      setVoiceCheckStatus("unsupported");
      setVoiceCheckError("브라우저 환경에서만 음성 체크를 실행할 수 있습니다.");
      return;
    }

    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setMicrophonePermission("unsupported");
      setVoiceCheckStatus("unsupported");
      setVoiceCheckError("이 브라우저는 마이크 체크를 지원하지 않습니다.");
      return;
    }

    const normalizedSamples = samplePhrases.map((phrase) => ({
      phrase,
      normalized: normalizeLiveTranscriptText(phrase),
    }));
    const startTime = Date.now();
    const matched = new Set<string>();
    let finished = false;

    const finish = (status: PreflightVoiceCheckStatus, message = "") => {
      if (finished) {
        return;
      }
      finished = true;
      stopPreflightVoiceResources();
      setVoiceCheckStatus(status);
      setVoiceCheckError(message);
    };

    try {
      const stream = await requestRehearsalMicrophoneStream(
        navigator.mediaDevices,
      );
      if (finished) {
        stopMediaStream(stream);
        return;
      }

      preflightStreamRef.current = stream;
      setMicrophonePermission("granted");

      const engineId = await props.resolveLiveSttEngine();
      const port = props.createLiveSttPort(engineId);
      preflightLiveSttPortRef.current = port;
      const unsubscribeResult = port.onResult((result) => {
        const transcript = result.text.trim();
        if (!transcript) {
          return;
        }

        setVoiceCheckTranscript(transcript);
        setVoiceCheckLatencyMs((current) => current ?? Date.now() - startTime);
        const normalizedTranscript = normalizeLiveTranscriptText(transcript);
        for (const sample of normalizedSamples) {
          if (
            sample.normalized &&
            normalizedTranscript.includes(sample.normalized)
          ) {
            matched.add(sample.phrase);
          }
        }
        setMatchedPhrases(Array.from(matched));
        if (matched.size > 0) {
          finish("passed");
        }
      });
      const unsubscribeError = port.onError((error) => {
        finish(
          "error",
          error.message || "음성 인식 체크를 완료하지 못했습니다.",
        );
      });
      preflightLiveSttCleanupRef.current = () => {
        unsubscribeResult();
        unsubscribeError();
      };

      preflightTimeoutRef.current = window.setTimeout(() => {
        finish(
          matched.size > 0 ? "passed" : "failed",
          matched.size > 0 ? "" : "8초 안에 예시 문구가 감지되지 않았습니다.",
        );
      }, 8000);

      await port.start({
        audioSource: stream,
        biasPhrases: samplePhrases.map((phrase) => ({
          source: "control-phrase",
          text: phrase,
          weight: 1,
        })),
        language: "ko",
      });
    } catch (cause) {
      if (preflightStreamRef.current) {
        setMicrophonePermission("granted");
      } else {
        setMicrophonePermission(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "denied"
            : "prompt",
        );
      }
      finish("error", toMicrophoneErrorMessage(cause));
    }
  }

  function stopPreflightVoiceResources() {
    if (preflightTimeoutRef.current !== null) {
      window.clearTimeout(preflightTimeoutRef.current);
      preflightTimeoutRef.current = null;
    }
    preflightLiveSttCleanupRef.current?.();
    preflightLiveSttCleanupRef.current = null;
    void preflightLiveSttPortRef.current?.stop();
    void preflightLiveSttPortRef.current?.dispose();
    preflightLiveSttPortRef.current = null;
    stopMediaStream(preflightStreamRef.current);
    preflightStreamRef.current = null;
  }

  return (
    <main className="rehearsal-preflight-screen" aria-label="리허설 시작 전">
      <div className="rehearsal-preflight-banner">
        <Zap size={17} />
        <span>{props.banner}</span>
      </div>

      {props.comparisonModel ? (
        <RehearsalRunComparisonOverview compact model={props.comparisonModel} />
      ) : null}

      <section className="rehearsal-preflight-card">
        <div className="rehearsal-preflight-mic" aria-hidden="true">
          <span>
            <Mic size={42} />
          </span>
        </div>
        <div className="rehearsal-preflight-copy">
          <h1>리허설을 시작할까요?</h1>
          <p>
            마이크 권한, 음성 인식, 지연시간을 먼저 짧게 확인할 수 있습니다.
          </p>
        </div>

        <div
          className="rehearsal-preflight-chain"
          aria-label="리허설 준비 상태"
        >
          <PreflightStatusRow
            action={
              !isMicrophoneGranted ? (
                <button
                  className="rehearsal-preflight-inline-action"
                  type="button"
                  onClick={() => void requestPreflightMicrophonePermission()}
                >
                  <Mic size={14} />
                  마이크 연결 확인
                </button>
              ) : null
            }
            label="마이크 권한 확인"
            status={permissionStatus}
            value={permissionStatus.value}
          />
          {isMicrophoneGranted ? (
            <PreflightStatusRow
              details={
                <section
                  className="rehearsal-preflight-voice-check"
                  aria-label="음성 체크"
                >
                  <div>
                    <strong>아래 문구 중 하나를 말해보세요</strong>
                    <button
                      className="rehearsal-preflight-check"
                      disabled={voiceCheckStatus === "listening"}
                      type="button"
                      onClick={() => void startPreflightVoiceCheck()}
                    >
                      <Mic size={16} />
                      {voiceCheckStatus === "listening"
                        ? "듣는 중"
                        : "음성 체크"}
                    </button>
                  </div>
                  <div
                    className="rehearsal-preflight-commands"
                    aria-label="음성 명령 예시"
                  >
                    {samplePhrases.map((phrase) => {
                      const matched = matchedPhrases.includes(phrase);
                      return (
                        <span
                          className={
                            matched ? "rehearsal-preflight-command-hit" : ""
                          }
                          key={phrase}
                        >
                          {matched ? <CheckCircle2 size={13} /> : null}"{phrase}
                          "
                        </span>
                      );
                    })}
                  </div>
                  <p aria-live="polite">
                    {voiceCheckTranscript
                      ? `인식됨: ${voiceCheckTranscript}`
                      : voiceCheckError ||
                        "조용한 곳에서 보통 말하는 속도로 테스트하세요."}
                  </p>
                </section>
              }
              label="음성 인식 준비"
              status={voiceStatus}
              value={voiceStatus.value}
            />
          ) : null}
          <PreflightStatusRow
            label={`슬라이드 ${props.deck.slides.length}장 로드됨`}
            status={triggerStatus}
            value={triggerStatus.value}
          />
        </div>

        {props.companionSetup}

        <div className="rehearsal-preflight-actions">
          <span
            className="rehearsal-preflight-start-tooltip-wrap"
            aria-describedby={
              startDisabledReason
                ? "rehearsal-preflight-start-tooltip"
                : undefined
            }
            data-disabled={startDisabledReason ? "true" : "false"}
            tabIndex={startDisabledReason ? 0 : undefined}
          >
            <button
              className="rehearsal-preflight-start"
              disabled={!canStartWithMicrophone}
              type="button"
              onClick={props.onStart}
            >
              <PlayCircle size={18} />
              리허설 시작
            </button>
            {startDisabledReason ? (
              <span
                className="rehearsal-preflight-start-tooltip"
                id="rehearsal-preflight-start-tooltip"
                role="tooltip"
              >
                {startDisabledReason}
              </span>
            ) : null}
          </span>
          <button
            className="rehearsal-preflight-quiet"
            type="button"
            onClick={props.onPracticeWithoutVoice}
          >
            음성 없이 연습하기
          </button>
        </div>
      </section>
    </main>
  );
}

type PreflightMicrophonePermission =
  | "checking"
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported";

type PreflightVoiceCheckStatus =
  | "idle"
  | "listening"
  | "passed"
  | "failed"
  | "unsupported"
  | "error";

type PreflightStatusTone = "success" | "warning" | "danger" | "info";

type PreflightStatus = {
  icon: "check" | "warning" | "danger" | "info";
  tone: PreflightStatusTone;
  value: string;
};

function PreflightStatusRow(props: {
  action?: ReactNode;
  details?: ReactNode;
  label: string;
  status: PreflightStatus;
  value: string;
}) {
  const Icon =
    props.status.icon === "warning"
      ? AlertTriangle
      : props.status.icon === "danger"
        ? AlertCircle
        : props.status.icon === "info"
          ? Gauge
          : CheckCircle2;

  return (
    <div className={`rehearsal-preflight-status-${props.status.tone}`}>
      <span>
        <Icon size={14} />
      </span>
      <strong>{props.label}</strong>
      <div className="rehearsal-preflight-status-meta">
        <small>{props.value}</small>
        {props.action}
      </div>
      {props.details ? (
        <div className="rehearsal-preflight-status-details">
          {props.details}
        </div>
      ) : null}
    </div>
  );
}

export function getPreflightMicrophonePermissionHint(
  state: PermissionState,
): PreflightMicrophonePermission {
  if (state === "granted") {
    return "granted";
  }
  if (state === "denied") {
    return "denied";
  }
  return "prompt";
}

function getPreflightMicrophoneStatus(
  permission: PreflightMicrophonePermission,
): PreflightStatus {
  switch (permission) {
    case "granted":
      return { icon: "check", tone: "success", value: "권한 허용됨" };
    case "denied":
      return {
        icon: "danger",
        tone: "danger",
        value: "브라우저에서 권한 차단됨",
      };
    case "unsupported":
      return { icon: "danger", tone: "danger", value: "마이크 API 미지원" };
    case "checking":
      return { icon: "info", tone: "info", value: "권한 상태 확인 중" };
    case "prompt":
      return {
        icon: "warning",
        tone: "warning",
        value: "마이크 연결 확인 필요",
      };
  }
}

function getPreflightVoiceStatus(
  status: PreflightVoiceCheckStatus,
  latencyMs: number | null,
): PreflightStatus {
  switch (status) {
    case "passed":
      return {
        icon: "check",
        tone: "success",
        value:
          latencyMs === null ? "예시 문구 인식됨" : `첫 인식 ${latencyMs}ms`,
      };
    case "listening":
      return { icon: "info", tone: "info", value: "예시 문구 듣는 중" };
    case "failed":
      return { icon: "warning", tone: "warning", value: "문구 재시도 필요" };
    case "unsupported":
      return {
        icon: "danger",
        tone: "danger",
        value: "브라우저 인식 미지원",
      };
    case "error":
      return { icon: "danger", tone: "danger", value: "체크 실패" };
    case "idle":
      return {
        icon: "warning",
        tone: "warning",
        value: "한국어 · 테스트 대기",
      };
  }
}

function getPreflightTriggerStatus(
  matchedCount: number,
  sampleCount: number,
  triggerCount: number,
): PreflightStatus {
  if (matchedCount > 0) {
    return {
      icon: "check",
      tone: "success",
      value: `${matchedCount}/${sampleCount}개 예시 인식 · 트리거 ${triggerCount}개`,
    };
  }

  return {
    icon: "info",
    tone: "info",
    value: `음성 트리거 ${triggerCount}개`,
  };
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function toMicrophoneErrorMessage(cause: unknown) {
  if (cause instanceof DOMException && cause.name === "NotAllowedError") {
    return "마이크 접근 권한이 거부되었습니다.";
  }

  if (cause instanceof DOMException && cause.name === "NotFoundError") {
    return "사용 가능한 마이크를 찾지 못했습니다.";
  }

  return "마이크를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
