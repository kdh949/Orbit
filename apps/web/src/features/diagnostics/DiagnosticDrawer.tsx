import { useEffect, useMemo, useState } from "react";

import {
  deleteAllDiagnosticSessions,
  listDiagnosticSessions,
  readDiagnosticSessionEvents
} from "./diagnosticStore";
import { exportDiagnosticSession } from "./diagnosticExport";
import type {
  DiagnosticMode,
  DiagnosticRecorderSnapshot,
  DiagnosticSession,
  DiagnosticSessionSurface,
  OrbitDiagnosticEvent
} from "./diagnosticTypes";
import "./diagnosticDrawer.css";

export function DiagnosticDrawer(props: {
  flush: () => Promise<void>;
  snapshot: DiagnosticRecorderSnapshot;
  start: (
    mode?: Exclude<DiagnosticMode, "off">,
    surface?: DiagnosticSessionSurface
  ) => void;
  stop: (reason?: string) => Promise<void>;
  surface: DiagnosticSessionSurface;
}) {
  const [stageFilter, setStageFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [traceFilter, setTraceFilter] = useState("");
  const [sessions, setSessions] = useState<DiagnosticSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    props.snapshot.activeSession?.sessionId ?? null
  );
  const [storedEvents, setStoredEvents] = useState<OrbitDiagnosticEvent[]>([]);
  const [operationMessage, setOperationMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listDiagnosticSessions()
      .then((nextSessions) => {
        if (cancelled) {
          return;
        }
        setSessions(nextSessions);
        setSelectedSessionId((current) =>
          current ??
          props.snapshot.activeSession?.sessionId ??
          nextSessions[0]?.sessionId ??
          null
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setOperationMessage(getErrorName(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.snapshot.activeSession?.sessionId]);

  const isActiveSession =
    selectedSessionId !== null &&
    selectedSessionId === props.snapshot.activeSession?.sessionId;

  useEffect(() => {
    if (!selectedSessionId || isActiveSession) {
      setStoredEvents([]);
      return;
    }
    let cancelled = false;
    void readDiagnosticSessionEvents(selectedSessionId)
      .then((events) => {
        if (!cancelled) {
          setStoredEvents(events);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setOperationMessage(getErrorName(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isActiveSession, selectedSessionId]);

  const visibleEvents = useMemo(() => {
    const events = isActiveSession
      ? props.snapshot.recentEvents
      : storedEvents;
    const normalizedTraceFilter = traceFilter.trim().toLocaleLowerCase();
    return events.filter((event) => {
      if (stageFilter !== "all" && event.stage !== stageFilter) {
        return false;
      }
      if (outcomeFilter !== "all" && event.outcome !== outcomeFilter) {
        return false;
      }
      if (!normalizedTraceFilter) {
        return true;
      }
      return JSON.stringify(event.trace)
        .toLocaleLowerCase()
        .includes(normalizedTraceFilter);
    });
  }, [
    isActiveSession,
    outcomeFilter,
    props.snapshot.recentEvents,
    stageFilter,
    storedEvents,
    traceFilter
  ]);
  const selectedSession =
    selectedSessionId === props.snapshot.activeSession?.sessionId
      ? props.snapshot.activeSession
      : sessions.find((session) => session.sessionId === selectedSessionId) ??
        null;

  async function handleExport() {
    if (!selectedSessionId) {
      return;
    }
    setOperationMessage("내보내는 중…");
    try {
      const file = await exportDiagnosticSession({
        flush: isActiveSession ? props.flush : undefined,
        sessionId: selectedSessionId
      });
      setOperationMessage(`${file.fileName} 준비 완료`);
    } catch (cause) {
      setOperationMessage(getErrorName(cause));
    }
  }

  async function handleDeleteAll() {
    if (
      !window.confirm(
        "이 브라우저에 저장된 발표 진단 세션을 모두 삭제할까요?"
      )
    ) {
      return;
    }
    await props.stop("delete-all");
    try {
      await deleteAllDiagnosticSessions();
      setSessions([]);
      setStoredEvents([]);
      setSelectedSessionId(null);
      setOperationMessage("저장된 진단 세션을 모두 삭제했습니다.");
    } catch (cause) {
      setOperationMessage(getErrorName(cause));
    }
  }

  return (
    <aside
      aria-label="발표 진단 타임라인"
      className="diagnostic-drawer"
    >
      <header className="diagnostic-drawer__header">
        <div>
          <strong>발표 진단 세션</strong>
          <span
            className={`diagnostic-drawer__status diagnostic-drawer__status--${props.snapshot.mode}`}
          >
            {getModeLabel(props.snapshot.mode)}
          </span>
        </div>
        <p>
          full 기록에는 transcript, speaker notes, STT bias phrase가 포함될
          수 있습니다. 서버로 전송되지 않고 이 브라우저에만 저장됩니다.
        </p>
      </header>

      {props.snapshot.storageWarning ? (
        <p className="diagnostic-drawer__warning" role="alert">
          로컬 저장 실패: {props.snapshot.storageWarning}. 최근 500개 이벤트는
          메모리에 유지됩니다.
        </p>
      ) : null}

      <div className="diagnostic-drawer__actions">
        {props.snapshot.mode === "off" ? (
          <button
            onClick={() => props.start("full", props.surface)}
            type="button"
          >
            새 세션 시작
          </button>
        ) : (
          <button
            onClick={() => void props.stop("manual")}
            type="button"
          >
            세션 중지
          </button>
        )}
        <button
          disabled={!selectedSessionId}
          onClick={() => void handleExport()}
          type="button"
        >
          JSONL 내보내기
        </button>
        <button onClick={() => void handleDeleteAll()} type="button">
          전체 삭제
        </button>
      </div>

      <dl className="diagnostic-drawer__summary">
        <div>
          <dt>선택 세션</dt>
          <dd>{selectedSession?.sessionId ?? "-"}</dd>
        </div>
        <div>
          <dt>이벤트</dt>
          <dd>{selectedSession?.eventCount ?? visibleEvents.length}</dd>
        </div>
        <div>
          <dt>저장 크기</dt>
          <dd>{formatBytes(selectedSession?.estimatedBytes ?? 0)}</dd>
        </div>
      </dl>

      <label className="diagnostic-drawer__session">
        최근 세션
        <select
          onChange={(event) =>
            setSelectedSessionId(event.currentTarget.value || null)
          }
          value={selectedSessionId ?? ""}
        >
          <option value="">세션 없음</option>
          {mergeActiveSession(props.snapshot.activeSession, sessions).map(
            (session) => (
              <option key={session.sessionId} value={session.sessionId}>
                {formatSessionLabel(session)}
              </option>
            )
          )}
        </select>
      </label>

      <div className="diagnostic-drawer__filters">
        <label>
          stage
          <select
            onChange={(event) => setStageFilter(event.currentTarget.value)}
            value={stageFilter}
          >
            <option value="all">전체</option>
            {diagnosticStages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <label>
          outcome
          <select
            onChange={(event) => setOutcomeFilter(event.currentTarget.value)}
            value={outcomeFilter}
          >
            <option value="all">전체</option>
            {diagnosticOutcomes.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </label>
        <label>
          trace
          <input
            onChange={(event) => setTraceFilter(event.currentTarget.value)}
            placeholder="trace id 검색"
            value={traceFilter}
          />
        </label>
      </div>

      <ol className="diagnostic-drawer__timeline">
        {visibleEvents.length === 0 ? (
          <li className="diagnostic-drawer__empty">
            조건에 맞는 이벤트가 없습니다.
          </li>
        ) : (
          visibleEvents.map((event) => (
            <li key={`${event.sessionId}:${event.seq}`}>
              <div>
                <code>#{event.seq}</code>
                <span>{event.stage}</span>
                <strong>{event.name}</strong>
                {event.outcome ? <em>{event.outcome}</em> : null}
              </div>
              {event.reason ? <p>{event.reason}</p> : null}
              <small>{formatEventTime(event.wallTimeIso)}</small>
              <details>
                <summary>trace / data</summary>
                <pre>
                  {JSON.stringify(
                    { trace: event.trace, data: event.data },
                    null,
                    2
                  )}
                </pre>
              </details>
            </li>
          ))
        )}
      </ol>
      {operationMessage ? (
        <p className="diagnostic-drawer__message" role="status">
          {operationMessage}
        </p>
      ) : null}
    </aside>
  );
}

const diagnosticStages = [
  "session",
  "audio",
  "stt",
  "bias",
  "transcript",
  "matcher",
  "action",
  "runtime",
  "react",
  "transition"
];

const diagnosticOutcomes = [
  "received",
  "accepted",
  "rejected",
  "queued",
  "started",
  "committed",
  "settled",
  "skipped",
  "failed"
];

function mergeActiveSession(
  activeSession: DiagnosticSession | null,
  sessions: DiagnosticSession[]
) {
  if (
    !activeSession ||
    sessions.some((session) => session.sessionId === activeSession.sessionId)
  ) {
    return sessions;
  }
  return [activeSession, ...sessions];
}

function formatSessionLabel(session: DiagnosticSession) {
  const state = session.endedAt ? "완료" : "기록 중";
  return `${new Date(session.startedAt).toLocaleString()} · ${session.surface} · ${state}`;
}

function formatEventTime(wallTimeIso: string) {
  return new Date(wallTimeIso).toLocaleTimeString(undefined, {
    hour12: false
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getModeLabel(mode: DiagnosticMode) {
  switch (mode) {
    case "off":
      return "기록 꺼짐";
    case "metadata":
      return "metadata 기록 중";
    case "full":
      return "full 기록 중";
  }
}

function getErrorName(cause: unknown) {
  return cause instanceof Error ? cause.name : "DiagnosticOperationError";
}
