import type { OpenAiRealtimeTranscriptionDelay } from "@orbit/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateNormalizedKoreanCer,
  summarizeRealtimeWhisperMetrics
} from "./realtimeWhisperSpikeMetrics";
import {
  createInitialSnapshot,
  RealtimeWhisperSpikeSession,
  type RealtimeWhisperSpikeSnapshot,
  type SpikeConnectionPhase
} from "./realtimeWhisperSpikeSession";
import "./realtime-whisper-spike.css";

const delayOptions: OpenAiRealtimeTranscriptionDelay[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
];

const phaseLabels: Record<SpikeConnectionPhase, string> = {
  idle: "대기",
  "requesting-microphone": "마이크 요청",
  "requesting-secret": "세션 발급",
  negotiating: "세션 적용 중",
  calibrating: "주변 소음 측정",
  ready: "측정 준비 완료",
  stopping: "종료 중",
  error: "오류"
};

export function RealtimeWhisperSpikeApp() {
  const [projectId, setProjectId] = useState(
    () => new URLSearchParams(window.location.search).get("projectId") ?? ""
  );
  const [delay, setDelay] = useState<OpenAiRealtimeTranscriptionDelay>("minimal");
  const [maxCommitIntervalMs, setMaxCommitIntervalMs] = useState<number | null>(
    10_000
  );
  const [silenceCommitMs, setSilenceCommitMs] = useState(650);
  const [noiseThresholdMarginDb, setNoiseThresholdMarginDb] = useState(10);
  const [referenceText, setReferenceText] = useState("");
  const [snapshot, setSnapshot] = useState<RealtimeWhisperSpikeSnapshot>(
    createInitialSnapshot
  );
  const sessionRef = useRef<RealtimeWhisperSpikeSession | null>(null);
  const isRunning = snapshot.phase !== "idle" && snapshot.phase !== "error";
  const isReady = snapshot.phase === "ready";
  const summary = useMemo(
    () => summarizeRealtimeWhisperMetrics(snapshot.turns),
    [snapshot.turns]
  );
  const referenceLines = useMemo(
    () => referenceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    [referenceText]
  );

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
    };
  }, []);

  const start = async () => {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      setSnapshot((current) => ({
        ...current,
        error: "접근 가능한 ORBIT projectId를 입력해 주세요."
      }));
      return;
    }

    const session = new RealtimeWhisperSpikeSession(
      {
        projectId: normalizedProjectId,
        delay,
        maxCommitIntervalMs,
        silenceCommitMs,
        noiseCalibrationMs: 1500,
        noiseThresholdMarginDb,
        speechAttackMs: 200
      },
      setSnapshot
    );
    sessionRef.current = session;
    await session.start();
  };

  const stop = async () => {
    await sessionRef.current?.stop();
    sessionRef.current = null;
  };

  const reset = () => {
    if (isRunning) {
      return;
    }
    sessionRef.current = null;
    setSnapshot(createInitialSnapshot());
  };

  const downloadMetrics = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      configuration: {
        model: snapshot.activeModel ?? snapshot.issuedModel,
        requestedDelay: delay,
        activeDelay: snapshot.activeDelay,
        maxCommitIntervalMs,
        silenceCommitMs,
        noiseCalibrationMs: 1500,
        noiseThresholdMarginDb,
        speechAttackMs: 200
      },
      connectionTimings: snapshot.timings,
      summary,
      turns: snapshot.turns.map((turn, index) => ({
        turnId: turn.turnId,
        itemId: turn.itemId,
        speechStartedAtMs: round(turn.speechStartedAtMs),
        firstDeltaLatencyMs: difference(
          turn.firstDeltaAtMs,
          turn.speechStartedAtMs
        ),
        commitToFinalMs: difference(turn.completedAtMs, turn.committedAtMs),
        onsetToFinalMs: difference(
          turn.completedAtMs,
          turn.speechStartedAtMs
        ),
        partialCount: turn.partialCount,
        transcriptLength: turn.transcript.length,
        normalizedCer:
          referenceLines[index] === undefined
            ? null
            : calculateNormalizedKoreanCer(
                referenceLines[index],
                turn.transcript
              )
      }))
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orbit-realtime-whisper-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="rws-shell">
      <header className="rws-header">
        <div>
          <p className="rws-eyebrow">ORBIT / INDEPENDENT SPIKE</p>
          <h1>GPT-Realtime-Whisper 계측실</h1>
          <p className="rws-subtitle">
            마이크 입력부터 partial, commit, final까지 한 브라우저 시계로 측정합니다.
          </p>
        </div>
        <div className="rws-header-status" aria-live="polite">
          <StatusDot active={isReady} />
          <span>{phaseLabels[snapshot.phase]}</span>
          <strong>{readinessLabel(snapshot)}</strong>
        </div>
      </header>

      <section className="rws-control-strip" aria-label="세션 제어">
        <label className="rws-field rws-project-field">
          <span>Project ID</span>
          <input
            disabled={isRunning}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder="project_demo_1"
            spellCheck={false}
            value={projectId}
          />
        </label>
        <label className="rws-field">
          <span>Delay</span>
          <select
            disabled={isRunning}
            onChange={(event) =>
              setDelay(event.target.value as OpenAiRealtimeTranscriptionDelay)
            }
            value={delay}
          >
            {delayOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="rws-field">
          <span>최대 commit</span>
          <select
            disabled={isRunning}
            onChange={(event) =>
              setMaxCommitIntervalMs(
                event.target.value === "disabled"
                  ? null
                  : Number(event.target.value)
              )
            }
            value={maxCommitIntervalMs ?? "disabled"}
          >
            <option value="disabled">사용 안 함</option>
            {[6000, 8000, 10000, 12000].map((value) => (
              <option key={value} value={value}>{value} ms</option>
            ))}
          </select>
        </label>
        <label className="rws-field">
          <span>침묵 commit</span>
          <select
            disabled={isRunning}
            onChange={(event) => setSilenceCommitMs(Number(event.target.value))}
            value={silenceCommitMs}
          >
            {[350, 500, 650, 800, 1000].map((value) => (
              <option key={value} value={value}>{value} ms</option>
            ))}
          </select>
        </label>
        <label className="rws-field">
          <span>Noise margin</span>
          <select
            disabled={isRunning}
            onChange={(event) =>
              setNoiseThresholdMarginDb(Number(event.target.value))
            }
            value={noiseThresholdMarginDb}
          >
            {[8, 10, 12, 15].map((value) => (
              <option key={value} value={value}>+{value} dB</option>
            ))}
          </select>
        </label>
        <div className="rws-actions">
          {!isRunning ? (
            <button className="rws-button rws-button-primary" onClick={() => void start()} type="button">
              측정 시작
            </button>
          ) : (
            <button className="rws-button rws-button-danger" onClick={() => void stop()} type="button">
              측정 종료
            </button>
          )}
          <button
            className="rws-button"
            disabled={!isReady}
            onClick={() => sessionRef.current?.commitNow()}
            type="button"
          >
            지금 확정
          </button>
        </div>
      </section>

      {snapshot.error && <div className="rws-error" role="alert">{snapshot.error}</div>}

      <ReadinessBanner snapshot={snapshot} />

      <section className="rws-metric-grid" aria-label="핵심 지연 지표">
        <Metric label="First partial" value={formatPair(summary.firstDeltaLatencyMedianMs, summary.firstDeltaLatencyP95Ms)} note="onset → 첫 delta · median / p95" />
        <Metric label="Finalization" value={formatPair(summary.commitToFinalMedianMs, summary.commitToFinalP95Ms)} note="commit → completed · median / p95" />
        <Metric label="End-to-end" value={formatPair(summary.onsetToFinalMedianMs, summary.onsetToFinalP95Ms)} note="onset → completed · median / p95" />
        <Metric label="완료 발화" value={`${summary.completedTurns}`} note={`${snapshot.turns.length}개 감지 · 표본 수 확인 필요`} />
      </section>

      <div className="rws-workbench">
        <section className="rws-panel rws-live-panel">
          <PanelHeading eyebrow="LIVE TRANSCRIPT" title="실시간 전사" trailing={<span className={`rws-speaking-badge ${snapshot.isSpeaking ? "is-active" : ""}`}>{snapshot.isSpeaking ? "● 말하는 중" : "○ 침묵"}</span>} />
          <AudioMeter
            rmsDb={snapshot.rmsDb}
            thresholdDb={snapshot.speechThresholdDb}
          />
          <div className="rws-transcript-stream" aria-live="polite">
            {snapshot.transcripts.length === 0 ? (
              <div className="rws-empty">
                연결 후 한국어로 말하면 partial이 이곳에 즉시 누적됩니다.
              </div>
            ) : (
              snapshot.transcripts.map((transcript) => (
                <article className={`rws-transcript ${transcript.isFinal ? "is-final" : "is-partial"}`} key={transcript.key}>
                  <div className="rws-transcript-meta">
                    <span>{transcript.isFinal ? "FINAL" : "PARTIAL"}</span>
                    <span>{shortId(transcript.itemId)}</span>
                    <span>{transcript.partialCount} deltas</span>
                    <span>{formatConfidence(transcript.confidence)}</span>
                  </div>
                  <p>{transcript.text || "…"}</p>
                </article>
              ))
            )}
          </div>
        </section>

        <aside className="rws-side-stack">
          <section className="rws-panel">
            <PanelHeading eyebrow="CONNECTION" title="연결 상태" />
            <dl className="rws-status-list">
              <StatusRow label="Peer" value={snapshot.peerConnectionState} ok={snapshot.peerConnectionState === "connected"} />
              <StatusRow label="ICE" value={snapshot.iceConnectionState} ok={snapshot.iceConnectionState === "connected" || snapshot.iceConnectionState === "completed"} />
              <StatusRow label="Data channel" value={snapshot.dataChannelState} ok={snapshot.dataChannelState === "open"} />
              <StatusRow label="Model" value={snapshot.activeModel ?? snapshot.issuedModel ?? "—"} ok={snapshot.activeModel === "gpt-realtime-whisper"} />
              <StatusRow label="Delay" value={snapshot.activeDelay ?? snapshot.issuedDelay ?? "—"} ok={snapshot.activeDelay === delay} />
              <StatusRow
                label="Noise floor"
                value={formatDb(snapshot.noiseFloorDb)}
                ok={snapshot.noiseFloorDb !== null}
              />
              <StatusRow
                label="Speech threshold"
                value={formatDb(snapshot.speechThresholdDb)}
                ok={snapshot.speechThresholdDb !== null}
              />
            </dl>
            <div className="rws-timing-rail">
              <Timing label="Mic" value={snapshot.timings.microphoneReadyMs} />
              <Timing label="Secret" value={snapshot.timings.clientSecretReadyMs} />
              <Timing label="SDP" value={snapshot.timings.remoteDescriptionReadyMs} />
              <Timing label="Channel" value={snapshot.timings.dataChannelOpenMs} />
              <Timing label="Session" value={snapshot.timings.sessionUpdatedMs} />
              <Timing label="Ready" value={snapshot.timings.calibrationReadyMs} />
            </div>
          </section>

          <section className="rws-panel">
            <PanelHeading eyebrow="REFERENCE" title="기준 문장" />
            <p className="rws-helper">발화 순서대로 한 줄에 한 문장씩 입력하면 normalized CER를 로컬에서 계산합니다.</p>
            <textarea
              onChange={(event) => setReferenceText(event.target.value)}
              placeholder={"오늘 발표를 시작하겠습니다.\n첫 번째 핵심 내용을 설명드리겠습니다."}
              rows={6}
              value={referenceText}
            />
          </section>
        </aside>
      </div>

      <section className="rws-panel rws-table-panel">
        <PanelHeading
          eyebrow="UTTERANCE METRICS"
          title="발화별 측정"
          trailing={
            <div className="rws-inline-actions">
              <button className="rws-button" disabled={snapshot.turns.length === 0} onClick={downloadMetrics} type="button">메트릭 JSON 저장</button>
              <button className="rws-button" disabled={isRunning} onClick={reset} type="button">초기화</button>
            </div>
          }
        />
        <div className="rws-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Turn</th>
                <th>Item</th>
                <th>First partial</th>
                <th>Commit → final</th>
                <th>Onset → final</th>
                <th>Deltas</th>
                <th>CER</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.turns.length === 0 ? (
                <tr><td className="rws-table-empty" colSpan={8}>아직 측정된 발화가 없습니다.</td></tr>
              ) : snapshot.turns.map((turn, index) => {
                const cer = referenceLines[index] === undefined
                  ? null
                  : calculateNormalizedKoreanCer(referenceLines[index], turn.transcript);
                return (
                  <tr key={turn.turnId}>
                    <td>#{turn.turnId}</td>
                    <td className="rws-mono">{shortId(turn.itemId)}</td>
                    <td>{formatDuration(difference(turn.firstDeltaAtMs, turn.speechStartedAtMs))}</td>
                    <td>{formatDuration(difference(turn.completedAtMs, turn.committedAtMs))}</td>
                    <td>{formatDuration(difference(turn.completedAtMs, turn.speechStartedAtMs))}</td>
                    <td>{turn.partialCount}</td>
                    <td>{cer === null ? "—" : `${(cer * 100).toFixed(1)}%`}</td>
                    <td><span className={`rws-state ${turn.completedAtMs === null ? "is-pending" : "is-complete"}`}>{turn.completedAtMs === null ? "진행 중" : "확정"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rws-panel rws-event-panel">
        <PanelHeading eyebrow="SANITIZED EVENT TRACE" title="이벤트 흐름" trailing={<span className="rws-helper">전사 원문은 이 로그에 포함하지 않습니다.</span>} />
        <div className="rws-event-log">
          {snapshot.events.length === 0 ? <div className="rws-empty">연결 이벤트가 여기에 표시됩니다.</div> : snapshot.events.slice().reverse().map((event) => (
            <div className="rws-event" key={event.sequence}>
              <time>+{event.elapsedMs} ms</time>
              <code>{event.type}</code>
              <span>{event.itemId ? shortId(event.itemId) : ""}</span>
              <span>{event.textLength === undefined ? "" : `${event.textLength} chars`}</span>
              <span>{event.detail ?? ""}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="rws-footer">
        브라우저에는 ephemeral client secret만 전달됩니다. 전사·기준 문장·오디오는 서버 로그나 저장소에 저장하지 않습니다.
      </footer>
    </main>
  );
}

function PanelHeading(props: { eyebrow: string; title: string; trailing?: React.ReactNode }) {
  return <div className="rws-panel-heading"><div><p>{props.eyebrow}</p><h2>{props.title}</h2></div>{props.trailing}</div>;
}

function Metric(props: { label: string; value: string; note: string }) {
  return <article className="rws-metric"><span>{props.label}</span><strong>{props.value}</strong><small>{props.note}</small></article>;
}

function StatusDot({ active }: { active: boolean }) {
  return <span aria-hidden="true" className={`rws-status-dot ${active ? "is-active" : ""}`} />;
}

function ReadinessBanner({ snapshot }: { snapshot: RealtimeWhisperSpikeSnapshot }) {
  const message =
    snapshot.phase === "calibrating"
      ? `${Math.max(snapshot.calibrationRemainingMs ?? 0, 0)}ms 동안 말하지 말고 주변 소음을 측정해 주세요.`
      : snapshot.phase === "ready"
        ? "설정 확인과 소음 측정이 끝났습니다. 지금 말하세요."
        : snapshot.phase === "idle"
          ? "측정 시작 후 준비 완료 안내가 나타날 때까지 말하지 마세요."
          : "마이크와 Realtime 세션을 준비하고 있습니다.";
  return (
    <div
      className={`rws-readiness ${snapshot.phase === "ready" ? "is-ready" : ""}`}
      role="status"
    >
      <strong>{snapshot.phase === "ready" ? "지금 말하세요" : phaseLabels[snapshot.phase]}</strong>
      <span>{message}</span>
    </div>
  );
}

function StatusRow(props: { label: string; value: string; ok: boolean }) {
  return <div><dt>{props.label}</dt><dd><span className={`rws-mini-dot ${props.ok ? "is-ok" : ""}`} />{props.value}</dd></div>;
}

function Timing(props: { label: string; value: number | null }) {
  return <div><span>{props.label}</span><strong>{props.value === null ? "—" : `${props.value} ms`}</strong></div>;
}

function AudioMeter({
  rmsDb,
  thresholdDb
}: {
  rmsDb: number;
  thresholdDb: number | null;
}) {
  const position = Math.max(0, Math.min(100, ((rmsDb + 80) / 80) * 100));
  const thresholdPosition = thresholdDb === null
    ? null
    : Math.max(0, Math.min(100, ((thresholdDb + 80) / 80) * 100));
  return <div className="rws-audio-meter" aria-label={`마이크 레벨 ${rmsDb.toFixed(1)} 데시벨`}><div className="rws-meter-track"><div className="rws-meter-fill" style={{ width: `${position}%` }} />{thresholdPosition === null ? null : <i style={{ left: `${thresholdPosition}%` }} />}</div><span>{rmsDb.toFixed(1)} dB</span></div>;
}

function difference(end: number | null, start: number | null) {
  return end === null || start === null ? null : Math.max(end - start, 0);
}

function round(value: number) {
  return Math.round(value);
}

function formatDuration(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function formatPair(median: number | null, p95: number | null) {
  return median === null || p95 === null ? "—" : `${median} / ${p95} ms`;
}

function formatConfidence(value: number | null) {
  return value === null ? "confidence —" : `confidence ${(value * 100).toFixed(0)}%`;
}

function formatDb(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} dB`;
}

function readinessLabel(snapshot: RealtimeWhisperSpikeSnapshot) {
  if (snapshot.phase === "calibrating") {
    return "말하지 마세요";
  }
  if (snapshot.phase !== "ready") {
    return "연결 대기";
  }
  return snapshot.isSpeaking ? "말하는 중" : "말해도 됩니다";
}

function shortId(value: string | null) {
  if (!value) return "—";
  return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`;
}
