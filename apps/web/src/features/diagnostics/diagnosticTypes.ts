export const orbitDiagnosticSchemaVersion = 1 as const;

export type DiagnosticMode = "off" | "metadata" | "full";

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticOutcome =
  | "received"
  | "accepted"
  | "rejected"
  | "queued"
  | "started"
  | "committed"
  | "settled"
  | "skipped"
  | "failed";

export type DiagnosticStage =
  | "session"
  | "audio"
  | "stt"
  | "bias"
  | "transcript"
  | "matcher"
  | "action"
  | "runtime"
  | "react"
  | "transition";

export type DiagnosticSessionSurface =
  | "presentation"
  | "rehearsal"
  | "editor-partial-rehearsal"
  | "unknown";

export type DiagnosticJsonValue =
  | boolean
  | null
  | number
  | string
  | DiagnosticJsonValue[]
  | { [key: string]: DiagnosticJsonValue };

export type DiagnosticData = Record<string, DiagnosticJsonValue>;

export type DiagnosticTrace = {
  slideId?: string;
  sourceEventId?: string;
  itemId?: string;
  contentIndex?: number;
  utteranceId?: string;
  resultRevision?: number;
  speechSequence?: number;
  triggerTraceId?: string;
  keywordId?: string;
  occurrenceId?: string;
  actionId?: string;
  animationId?: string;
  stateTransitionId?: string;
  transitionId?: string;
};

export type OrbitDiagnosticEvent = {
  schemaVersion: typeof orbitDiagnosticSchemaVersion;
  sessionId: string;
  seq: number;
  wallTimeIso: string;
  monotonicMs: number;
  level: DiagnosticLevel;
  stage: DiagnosticStage;
  name: string;
  outcome?: DiagnosticOutcome;
  reason?: string;
  trace: DiagnosticTrace;
  data: DiagnosticData;
};

export type DiagnosticEventInput = {
  level?: DiagnosticLevel;
  stage: DiagnosticStage;
  name: string;
  outcome?: DiagnosticOutcome;
  reason?: string;
  trace?: DiagnosticTrace;
  data?: DiagnosticData;
};

export type DiagnosticSessionMetadata = {
  appVersion?: string;
  browser?: string;
  deckRevision?: string;
  projectIdHash?: string;
  sttEngine?: string;
  [key: string]: DiagnosticJsonValue | undefined;
};

export type DiagnosticSession = {
  schemaVersion: typeof orbitDiagnosticSchemaVersion;
  sessionId: string;
  mode: Exclude<DiagnosticMode, "off">;
  surface: DiagnosticSessionSurface;
  startedAt: string;
  endedAt: string | null;
  eventCount: number;
  estimatedBytes: number;
  metadata: DiagnosticSessionMetadata;
};

export type DiagnosticSessionStartInput = {
  mode: Exclude<DiagnosticMode, "off">;
  surface: DiagnosticSessionSurface;
  metadata?: DiagnosticSessionMetadata;
};

export type DiagnosticRecorderSnapshot = {
  activeSession: DiagnosticSession | null;
  mode: DiagnosticMode;
  recentEvents: readonly OrbitDiagnosticEvent[];
  storageWarning: string | null;
};

export type DiagnosticEventWriter = {
  append: (event: OrbitDiagnosticEvent) => void;
  finishSession: (session: DiagnosticSession) => void;
  flush: () => Promise<void>;
  startSession: (session: DiagnosticSession) => void;
  subscribeWarnings?: (listener: (warning: string) => void) => () => void;
};

export type DiagnosticSink = {
  readonly mode: DiagnosticMode;
  readonly sessionId: string | null;
  createTriggerTraceId: (identity?: {
    resultRevision?: number;
    utteranceId?: string;
  }) => string | null;
  emit: (input: DiagnosticEventInput) => OrbitDiagnosticEvent | null;
};
