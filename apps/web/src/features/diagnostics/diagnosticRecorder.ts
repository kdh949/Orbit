import { redactDiagnosticData } from "./diagnosticRedaction";
import {
  orbitDiagnosticSchemaVersion,
  type DiagnosticEventInput,
  type DiagnosticEventWriter,
  type DiagnosticMode,
  type DiagnosticRecorderSnapshot,
  type DiagnosticSession,
  type DiagnosticSessionMetadata,
  type DiagnosticSessionStartInput,
  type DiagnosticSink,
  type OrbitDiagnosticEvent
} from "./diagnosticTypes";

type DiagnosticRecorderOptions = {
  createId?: () => string;
  maxRecentEvents?: number;
  monotonicNow?: () => number;
  now?: () => Date;
  writer?: DiagnosticEventWriter;
};

const noopWriter: DiagnosticEventWriter = {
  append() {},
  finishSession() {},
  async flush() {},
  startSession() {}
};

export class OrbitDiagnosticRecorder implements DiagnosticSink {
  private readonly createId: () => string;
  private readonly maxRecentEvents: number;
  private readonly monotonicNow: () => number;
  private readonly now: () => Date;
  private readonly writer: DiagnosticEventWriter;
  private readonly textEncoder = new TextEncoder();
  private activeSession: DiagnosticSession | null = null;
  private recentEvents: OrbitDiagnosticEvent[] = [];
  private sequence = 0;
  private speechSequence = 0;
  private storageWarning: string | null = null;
  private readonly listeners = new Set<
    (snapshot: DiagnosticRecorderSnapshot) => void
  >();

  constructor(options: DiagnosticRecorderOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.maxRecentEvents = options.maxRecentEvents ?? 500;
    this.monotonicNow =
      options.monotonicNow ?? (() => globalThis.performance?.now() ?? Date.now());
    this.now = options.now ?? (() => new Date());
    this.writer = options.writer ?? noopWriter;
    this.writer.subscribeWarnings?.((warning) => {
      this.storageWarning = warning;
      this.notify();
    });
  }

  get mode(): DiagnosticMode {
    return this.activeSession?.mode ?? "off";
  }

  get sessionId() {
    return this.activeSession?.sessionId ?? null;
  }

  start(input: DiagnosticSessionStartInput): DiagnosticSession {
    if (this.activeSession) {
      return this.activeSession;
    }

    const startedAt = this.now().toISOString();
    const session: DiagnosticSession = {
      schemaVersion: orbitDiagnosticSchemaVersion,
      sessionId: this.createId(),
      mode: input.mode,
      surface: input.surface,
      startedAt,
      endedAt: null,
      eventCount: 0,
      estimatedBytes: 0,
      metadata: input.metadata ?? {}
    };
    this.activeSession = session;
    this.sequence = 0;
    this.speechSequence = 0;
    this.recentEvents = [];
    this.storageWarning = null;
    this.callWriter(() => this.writer.startSession(session));
    this.emit({
      stage: "session",
      name: "session.started",
      outcome: "started",
      data: {
        mode: session.mode,
        surface: session.surface,
        startedAt,
        ...toDiagnosticMetadata(session.metadata)
      }
    });
    return session;
  }

  updateSessionMetadata(metadata: DiagnosticSessionMetadata) {
    const session = this.activeSession;
    if (!session) {
      return;
    }
    session.metadata = { ...session.metadata, ...metadata };
    this.emit({
      stage: "session",
      name: "session.context_updated",
      outcome: "accepted",
      data: toDiagnosticMetadata(metadata)
    });
  }

  async stop(reason = "manual"): Promise<DiagnosticSession | null> {
    const session = this.activeSession;
    if (!session) {
      return null;
    }

    const endedAt = this.now().toISOString();
    this.emit({
      stage: "session",
      name: "session.stopped",
      outcome: "settled",
      reason,
      data: { endedAt }
    });
    session.endedAt = endedAt;
    this.activeSession = null;
    this.callWriter(() => this.writer.finishSession(session));
    await this.writer.flush().catch((cause: unknown) => {
      this.setStorageWarning(cause);
    });
    this.notify();
    return session;
  }

  emit(input: DiagnosticEventInput): OrbitDiagnosticEvent | null {
    const session = this.activeSession;
    if (!session) {
      return null;
    }

    const event: OrbitDiagnosticEvent = {
      schemaVersion: orbitDiagnosticSchemaVersion,
      sessionId: session.sessionId,
      seq: ++this.sequence,
      wallTimeIso: this.now().toISOString(),
      monotonicMs: this.monotonicNow(),
      level: input.level ?? "info",
      stage: input.stage,
      name: input.name,
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      trace: input.trace ?? {},
      data: redactDiagnosticData(input.data ?? {}, session.mode)
    };
    session.eventCount = event.seq;
    session.estimatedBytes += this.textEncoder.encode(
      `${JSON.stringify(event)}\n`
    ).byteLength;
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.splice(
        0,
        this.recentEvents.length - this.maxRecentEvents
      );
    }
    this.callWriter(() => this.writer.append(event));
    this.notify();
    return event;
  }

  createTriggerTraceId(identity: {
    resultRevision?: number;
    utteranceId?: string;
  } = {}) {
    const session = this.activeSession;
    if (!session) {
      return null;
    }
    this.speechSequence += 1;
    if (identity.utteranceId && identity.resultRevision !== undefined) {
      return `speech:${identity.utteranceId}:${identity.resultRevision}`;
    }
    return `speech:${session.sessionId}:${this.speechSequence}`;
  }

  snapshot(): DiagnosticRecorderSnapshot {
    return {
      activeSession: this.activeSession
        ? {
            ...this.activeSession,
            metadata: { ...this.activeSession.metadata }
          }
        : null,
      mode: this.mode,
      recentEvents: [...this.recentEvents],
      storageWarning: this.storageWarning
    };
  }

  subscribe(listener: (snapshot: DiagnosticRecorderSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  reportStorageWarning(cause: unknown) {
    this.setStorageWarning(cause);
  }

  private callWriter(action: () => void) {
    try {
      action();
    } catch (cause) {
      this.setStorageWarning(cause);
    }
  }

  private setStorageWarning(cause: unknown) {
    this.storageWarning =
      cause instanceof Error ? cause.name : "DiagnosticStorageError";
    this.notify();
  }

  private notify() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function toDiagnosticMetadata(metadata: DiagnosticSessionMetadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
        entry[1] !== undefined
    )
  );
}
