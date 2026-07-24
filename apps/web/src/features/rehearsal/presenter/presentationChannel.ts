import {
  presentationCompanionAnnotationCommandSchema,
  presentationCompanionAnnotationSnapshotSchema,
  presentationCompanionLaserSchema,
  type Deck,
  type PresentationCompanionAnnotationCommand,
  type PresentationCompanionAnnotationSnapshot,
  type PresentationCompanionLaser,
} from "@orbit/shared";
import type {
  AudienceOutputMode,
  PresenterSlideshowState,
} from "./presenterStateStore";

export const presentationChannelPrefix = "orbit:presenter-screen";

export type PresentationChannelIdentity = {
  deckId: string;
  sessionId: string;
};

export type LivePresentationHostIdentity = {
  localChannel: PresentationChannelIdentity;
  persistedSessionId: string | null;
};

export function createLivePresentationHostIdentity(input: {
  deckId: string;
  localWindowSessionId: string;
  persistedSessionId?: string | null;
}): LivePresentationHostIdentity {
  return {
    localChannel: {
      deckId: input.deckId,
      sessionId: input.localWindowSessionId,
    },
    persistedSessionId: input.persistedSessionId ?? null,
  };
}

export type SlideWindowDeckSnapshot = Deck;

export type PresenterSnapshotMessage = {
  deck: SlideWindowDeckSnapshot;
  deckId: string;
  sentAt: number;
  sessionId: string;
  state: PresenterSlideshowState;
  triggerAnimationIds: string[];
  type: "presenter-snapshot";
};

export type PresenterStateMessage = {
  deckId: string;
  sentAt: number;
  sessionId: string;
  state: PresenterSlideshowState;
  triggerAnimationIds: string[];
  type: "presenter-state";
};

export type PresenterRemoteSnapshotMessage = Omit<
  PresenterSnapshotMessage,
  "type"
> & {
  type: "presenter-remote-snapshot";
};

export type PresenterRemoteStateMessage = Omit<PresenterStateMessage, "type"> & {
  type: "presenter-remote-state";
};

export type PresenterHeartbeatMessage = {
  deckId: string;
  sentAt: number;
  sessionId: string;
  type: "presenter-heartbeat";
};

export type SlideWindowReadyMessage = {
  deckId: string;
  sentAt: number;
  sessionId: string;
  type: "slide-window-ready";
};

export type SlideWindowHeartbeatMessage = {
  deckId: string;
  sentAt: number;
  sessionId: string;
  type: "slide-window-heartbeat";
};

export type PresenterRemoteReadyMessage = {
  deckId: string;
  sentAt: number;
  sessionId: string;
  type: "presenter-remote-ready";
};

export type PresenterRemoteHeartbeatMessage = {
  deckId: string;
  sentAt: number;
  sessionId: string;
  type: "presenter-remote-heartbeat";
};

export type PresenterRemoteCommand =
  | { action: "finish" }
  | { action: "goto"; slideIndex: number; stepIndex?: number }
  | { action: "next-step" }
  | { action: "prev" }
  | { action: "set-audience-output"; mode: AudienceOutputMode }
  | { action: "timer-pause" }
  | { action: "timer-reset" }
  | { action: "timer-start" };

export type PresenterCommandMessage = {
  command: PresenterRemoteCommand;
  deckId: string;
  sentAt: number;
  sessionId: string;
  type: "presenter-command";
};

export type ScreenShareEndedReason =
  | "playback-failed"
  | "track-ended"
  | "stream-missing"
  | "receiver-reset";

export type ScreenShareEndedMessage = {
  deckId: string;
  reason: ScreenShareEndedReason;
  sentAt: number;
  sessionId: string;
  type: "screen-share-ended";
};

export type PresenterAnnotationSnapshotMessage = {
  annotation: PresentationCompanionAnnotationSnapshot;
  deckId: string;
  sentAt: number;
  sessionId: string;
  type: "presenter-annotation-snapshot";
};

export type PresenterAnnotationDeltaMessage = {
  command: PresentationCompanionAnnotationCommand;
  deckId: string;
  sentAt: number;
  sessionId: string;
  surfaceRevision: number;
  type: "presenter-annotation-delta";
};

export type PresenterLaserMessage = {
  deckId: string;
  laser: PresentationCompanionLaser;
  sentAt: number;
  sessionId: string;
  type: "presenter-laser";
};

export type PresentationChannelMessage =
  | PresenterSnapshotMessage
  | PresenterStateMessage
  | PresenterRemoteSnapshotMessage
  | PresenterRemoteStateMessage
  | PresenterHeartbeatMessage
  | SlideWindowReadyMessage
  | SlideWindowHeartbeatMessage
  | PresenterRemoteReadyMessage
  | PresenterRemoteHeartbeatMessage
  | PresenterCommandMessage
  | ScreenShareEndedMessage
  | PresenterAnnotationSnapshotMessage
  | PresenterAnnotationDeltaMessage
  | PresenterLaserMessage;

export function createPresentationSessionId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return Array.from(values, (value) =>
      value.toString(16).padStart(8, "0"),
    ).join("-");
  }

  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getPresentationChannelName(
  identity: PresentationChannelIdentity,
) {
  return [
    presentationChannelPrefix,
    encodeURIComponent(identity.deckId),
    encodeURIComponent(identity.sessionId),
  ].join(":");
}

export function getPresenterRemoteChannelName(
  identity: PresentationChannelIdentity
) {
  return `${getPresentationChannelName(identity)}:owner`;
}

export function createSlideWindowDeckSnapshot(
  deck: Deck,
): SlideWindowDeckSnapshot {
  return {
    canvas: deck.canvas,
    deckId: deck.deckId,
    metadata: deck.metadata,
    projectId: deck.projectId,
    slides: deck.slides.map(createSlideWindowSlideSnapshot),
    targetDurationMinutes: deck.targetDurationMinutes,
    theme: deck.theme,
    title: deck.title,
    version: deck.version,
  };
}

function createSlideWindowSlideSnapshot(
  slide: Deck["slides"][number],
): Deck["slides"][number] {
  const common = {
    actions: [],
    animations: slide.animations,
    elements: slide.elements,
    estimatedSeconds: slide.estimatedSeconds,
    keywords: [],
    semanticCues: [],
    order: slide.order,
    // 슬라이드 창은 렌더링 전용이므로 발표 대본과 추적 키워드를 받지 않는다.
    speakerNotes: "",
    slideId: slide.slideId,
    style: slide.style,
    thumbnailUrl: slide.thumbnailUrl,
    title: slide.title,
  };

  if (slide.kind === "activity") {
    return { ...common, kind: "activity", activity: slide.activity };
  }
  if (slide.kind === "activity-results") {
    return {
      ...common,
      kind: "activity-results",
      activityResult: slide.activityResult,
    };
  }
  return { ...common, kind: "content" };
}

export function parsePresentationChannelMessage(
  value: unknown,
): PresentationChannelMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.deckId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.sentAt !== "number"
  ) {
    return null;
  }

  switch (value.type) {
    case "presenter-snapshot":
    case "presenter-remote-snapshot": {
      const state = parsePresenterSlideshowState(value.state);
      if (
        !isRecord(value.deck) ||
        !state ||
        !isStringArray(value.triggerAnimationIds)
      ) {
        return null;
      }
      return { ...value, state } as
        | PresenterSnapshotMessage
        | PresenterRemoteSnapshotMessage;
    }
    case "presenter-state":
    case "presenter-remote-state": {
      const state = parsePresenterSlideshowState(value.state);
      if (!state || !isStringArray(value.triggerAnimationIds)) {
        return null;
      }
      return { ...value, state } as
        | PresenterStateMessage
        | PresenterRemoteStateMessage;
    }
    case "presenter-heartbeat":
    case "slide-window-ready":
    case "slide-window-heartbeat":
    case "presenter-remote-ready":
    case "presenter-remote-heartbeat":
      return value as PresentationChannelMessage;
    case "presenter-command":
      return isPresenterRemoteCommand(value.command)
        ? (value as unknown as PresenterCommandMessage)
        : null;
    case "screen-share-ended":
      return isScreenShareEndedReason(value.reason)
        ? (value as unknown as ScreenShareEndedMessage)
        : null;
    case "presenter-annotation-snapshot": {
      const annotation =
        presentationCompanionAnnotationSnapshotSchema.safeParse(
          value.annotation,
        );
      return annotation.success
        ? ({
            ...value,
            annotation: annotation.data,
          } as PresenterAnnotationSnapshotMessage)
        : null;
    }
    case "presenter-annotation-delta": {
      const command =
        presentationCompanionAnnotationCommandSchema.safeParse(
          value.command,
        );
      return command.success &&
        Number.isSafeInteger(value.surfaceRevision) &&
        Number(value.surfaceRevision) >= 0
        ? ({
            ...value,
            command: command.data,
          } as PresenterAnnotationDeltaMessage)
        : null;
    }
    case "presenter-laser": {
      const laser = presentationCompanionLaserSchema.safeParse(
        value.laser,
      );
      return laser.success
        ? ({ ...value, laser: laser.data } as PresenterLaserMessage)
        : null;
    }
    default:
      return null;
  }
}

export function matchesPresentationChannelIdentity(
  message: PresentationChannelMessage,
  identity: PresentationChannelIdentity,
) {
  return (
    message.deckId === identity.deckId &&
    message.sessionId === identity.sessionId
  );
}

export function createPresenterSnapshotMessage(args: {
  deck: Deck;
  identity: PresentationChannelIdentity;
  sentAt?: number;
  state: PresenterSlideshowState;
  triggerAnimationIds?: Iterable<string>;
}): PresenterSnapshotMessage {
  return {
    deck: createSlideWindowDeckSnapshot(args.deck),
    deckId: args.identity.deckId,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    state: createAudiencePresenterState(args.state),
    triggerAnimationIds: Array.from(args.triggerAnimationIds ?? []),
    type: "presenter-snapshot",
  };
}

export function createPresenterStateMessage(args: {
  identity: PresentationChannelIdentity;
  sentAt?: number;
  state: PresenterSlideshowState;
  triggerAnimationIds?: Iterable<string>;
}): PresenterStateMessage {
  return {
    deckId: args.identity.deckId,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    state: createAudiencePresenterState(args.state),
    triggerAnimationIds: Array.from(args.triggerAnimationIds ?? []),
    type: "presenter-state",
  };
}

export function createPresenterRemoteSnapshotMessage(args: {
  deck: Deck;
  identity: PresentationChannelIdentity;
  sentAt?: number;
  state: PresenterSlideshowState;
  triggerAnimationIds?: Iterable<string>;
}): PresenterRemoteSnapshotMessage {
  return {
    deck: createSlideWindowDeckSnapshot(args.deck),
    deckId: args.identity.deckId,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    state: args.state,
    triggerAnimationIds: Array.from(args.triggerAnimationIds ?? []),
    type: "presenter-remote-snapshot"
  };
}

export function createPresenterRemoteStateMessage(args: {
  identity: PresentationChannelIdentity;
  sentAt?: number;
  state: PresenterSlideshowState;
  triggerAnimationIds?: Iterable<string>;
}): PresenterRemoteStateMessage {
  return {
    deckId: args.identity.deckId,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    state: args.state,
    triggerAnimationIds: Array.from(args.triggerAnimationIds ?? []),
    type: "presenter-remote-state"
  };
}

export function createAudiencePresenterState(
  state: PresenterSlideshowState
): PresenterSlideshowState {
  const { speech: _presenterSpeech, ...audienceState } = state;
  return audienceState;
}

export function createPresenterHeartbeatMessage(
  identity: PresentationChannelIdentity,
  sentAt = Date.now(),
): PresenterHeartbeatMessage {
  return {
    deckId: identity.deckId,
    sentAt,
    sessionId: identity.sessionId,
    type: "presenter-heartbeat",
  };
}

export function createSlideWindowReadyMessage(
  identity: PresentationChannelIdentity,
  sentAt = Date.now(),
): SlideWindowReadyMessage {
  return {
    deckId: identity.deckId,
    sentAt,
    sessionId: identity.sessionId,
    type: "slide-window-ready",
  };
}

export function createSlideWindowHeartbeatMessage(
  identity: PresentationChannelIdentity,
  sentAt = Date.now(),
): SlideWindowHeartbeatMessage {
  return {
    deckId: identity.deckId,
    sentAt,
    sessionId: identity.sessionId,
    type: "slide-window-heartbeat",
  };
}

export function createPresenterRemoteReadyMessage(
  identity: PresentationChannelIdentity,
  sentAt = Date.now(),
): PresenterRemoteReadyMessage {
  return {
    deckId: identity.deckId,
    sentAt,
    sessionId: identity.sessionId,
    type: "presenter-remote-ready",
  };
}

export function createPresenterRemoteHeartbeatMessage(
  identity: PresentationChannelIdentity,
  sentAt = Date.now(),
): PresenterRemoteHeartbeatMessage {
  return {
    deckId: identity.deckId,
    sentAt,
    sessionId: identity.sessionId,
    type: "presenter-remote-heartbeat",
  };
}

export function createPresenterCommandMessage(args: {
  command: PresenterRemoteCommand;
  identity: PresentationChannelIdentity;
  sentAt?: number;
}): PresenterCommandMessage {
  return {
    command: args.command,
    deckId: args.identity.deckId,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    type: "presenter-command",
  };
}

export function createScreenShareEndedMessage(args: {
  identity: PresentationChannelIdentity;
  reason: ScreenShareEndedReason;
  sentAt?: number;
}): ScreenShareEndedMessage {
  return {
    deckId: args.identity.deckId,
    reason: args.reason,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    type: "screen-share-ended",
  };
}

export function createPresenterAnnotationSnapshotMessage(args: {
  annotation: PresentationCompanionAnnotationSnapshot;
  identity: PresentationChannelIdentity;
  sentAt?: number;
}): PresenterAnnotationSnapshotMessage {
  return {
    annotation:
      presentationCompanionAnnotationSnapshotSchema.parse(
        args.annotation,
      ),
    deckId: args.identity.deckId,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    type: "presenter-annotation-snapshot",
  };
}

export function createPresenterAnnotationDeltaMessage(args: {
  command: PresentationCompanionAnnotationCommand;
  identity: PresentationChannelIdentity;
  sentAt?: number;
  surfaceRevision: number;
}): PresenterAnnotationDeltaMessage {
  return {
    command: presentationCompanionAnnotationCommandSchema.parse(
      args.command,
    ),
    deckId: args.identity.deckId,
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    surfaceRevision: args.surfaceRevision,
    type: "presenter-annotation-delta",
  };
}

export function createPresenterLaserMessage(args: {
  identity: PresentationChannelIdentity;
  laser: PresentationCompanionLaser;
  sentAt?: number;
}): PresenterLaserMessage {
  return {
    deckId: args.identity.deckId,
    laser: presentationCompanionLaserSchema.parse(args.laser),
    sentAt: args.sentAt ?? Date.now(),
    sessionId: args.identity.sessionId,
    type: "presenter-laser",
  };
}

function parsePresenterSlideshowState(
  value: unknown,
): PresenterSlideshowState | null {
  if (!isRecord(value)) {
    return null;
  }

  const audienceOutputMode =
    value.audienceOutputMode === undefined
      ? "slide"
      : isAudienceOutputMode(value.audienceOutputMode)
        ? value.audienceOutputMode
        : null;
  if (
    audienceOutputMode !== null &&
    typeof value.slideId === "string" &&
    typeof value.slideIndex === "number" &&
    typeof value.stepIndex === "number" &&
    Array.isArray(value.highlights) &&
    value.highlights.every(
      (highlight) =>
        isRecord(highlight) &&
        typeof highlight.elementId === "string" &&
        typeof highlight.active === "boolean",
    ) &&
    (value.speech === undefined || isPresenterSpeechState(value.speech)) &&
    (value.timing === undefined || isPresenterTimingState(value.timing))
  ) {
    return { ...value, audienceOutputMode } as PresenterSlideshowState;
  }
  return null;
}

function isPresenterSpeechState(value: unknown) {
  return (
    isRecord(value) &&
    isStringArray(value.coveredSentenceIds) &&
    isCoveredSentenceMatchKindRecord(value.coveredSentenceMatchKinds) &&
    typeof value.matchableSentenceCount === "number" &&
    isSemanticUtteranceDebugState(value.semanticDebug) &&
    typeof value.semanticMatchingEnabled === "boolean" &&
    (value.snapshot === null || isSpeechTrackerSnapshot(value.snapshot)) &&
    (value.semanticCapabilityItems === undefined ||
      (Array.isArray(value.semanticCapabilityItems) &&
        value.semanticCapabilityItems.every(isSemanticCapabilityStatusItem)))
  );
}

function isSemanticCapabilityStatusItem(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    (value.severity === "info" ||
      value.severity === "warning" ||
      value.severity === "error") &&
    typeof value.shortLabel === "string" &&
    typeof value.detail === "string" &&
    typeof value.retryable === "boolean" &&
    typeof value.affectedCount === "number" &&
    value.source === "system-status" &&
    typeof value.recovered === "boolean" &&
    (value.measurementMode === "full" ||
      value.measurementMode === "basic" ||
      value.measurementMode === "none")
  );
}

function isSemanticUtteranceDebugState(value: unknown) {
  return (
    isRecord(value) &&
    isSemanticDebugStatus(value.status) &&
    (value.slideId === null || typeof value.slideId === "string") &&
    typeof value.transcript === "string" &&
    typeof value.isFinal === "boolean" &&
    Array.isArray(value.topMatches) &&
    value.topMatches.every(isSemanticUtteranceMatch) &&
    (value.decision === null || isSemanticUtteranceDecision(value.decision)) &&
    (value.error === null || typeof value.error === "string")
  );
}

function isSemanticDebugStatus(value: unknown) {
  return (
    value === "idle" ||
    value === "loading-model" ||
    value === "model-ready" ||
    value === "indexing-script" ||
    value === "matching" ||
    value === "ready" ||
    value === "error"
  );
}

function isSemanticUtteranceDecision(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.accepted === "boolean" &&
    (value.acceptedMatch === null || isSemanticUtteranceMatch(value.acceptedMatch)) &&
    typeof value.ambiguousMargin === "number" &&
    typeof value.isFinal === "boolean" &&
    typeof value.lexicalOverlap === "number" &&
    (value.outcome === null ||
      value.outcome === "covered" ||
      value.outcome === "paraphrased" ||
      value.outcome === "ad-lib" ||
      value.outcome === "missed") &&
    typeof value.reason === "string" &&
    typeof value.scoreThreshold === "number" &&
    typeof value.slideId === "string" &&
    Array.isArray(value.topMatches) &&
    value.topMatches.every(isSemanticUtteranceMatch) &&
    typeof value.transcript === "string"
  );
}

function isSemanticUtteranceMatch(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.rank === "number" &&
    typeof value.sentenceId === "string" &&
    typeof value.sentenceIndex === "number" &&
    typeof value.text === "string" &&
    typeof value.similarity === "number" &&
    typeof value.covered === "boolean"
  );
}

function isSpeechTrackerSnapshot(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.slideId === "string" &&
    isStringArray(value.coveredSentenceIds) &&
    isCoveredSentenceMatchKindRecord(value.coveredSentenceMatchKinds) &&
    typeof value.matchableSentenceCount === "number" &&
    typeof value.sentenceCoverage === "number" &&
    typeof value.wordCoverage === "number" &&
    typeof value.effectiveCoverage === "number" &&
    typeof value.finalSentenceSpoken === "boolean" &&
    isStringArray(value.hitKeywordIds) &&
    isStringArray(value.provisionalMissingKeywordIds)
  );
}

function isCoveredSentenceMatchKindRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (kind) => kind === "covered" || kind === "paraphrased"
    )
  );
}

function isPresenterTimingState(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.canStartLiveStt === "boolean" &&
    typeof value.currentSlideElapsedSeconds === "number" &&
    typeof value.currentSlideTargetSeconds === "number" &&
    typeof value.displayedSeconds === "number" &&
    typeof value.elapsedSeconds === "number" &&
    typeof value.isLiveSttActive === "boolean" &&
    typeof value.isRunning === "boolean" &&
    typeof value.liveStatus === "string" &&
    (value.mode === "stopwatch" || value.mode === "timer") &&
    typeof value.timerDurationSeconds === "number"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isPresenterRemoteCommand(
  value: unknown,
): value is PresenterRemoteCommand {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.action === "finish" ||
    value.action === "next-step" ||
    value.action === "prev" ||
    value.action === "timer-pause" ||
    value.action === "timer-reset" ||
    value.action === "timer-start"
  ) {
    return true;
  }

  if (value.action === "set-audience-output") {
    return isAudienceOutputMode(value.mode);
  }

  return (
    value.action === "goto" &&
    isNonNegativeInteger(value.slideIndex) &&
    (value.stepIndex === undefined || isNonNegativeInteger(value.stepIndex))
  );
}

function isAudienceOutputMode(value: unknown): value is AudienceOutputMode {
  return value === "slide" || value === "screen-share" || value === "black";
}

function isScreenShareEndedReason(
  value: unknown,
): value is ScreenShareEndedReason {
  return (
    value === "playback-failed" ||
    value === "track-ended" ||
    value === "stream-missing" ||
    value === "receiver-reset"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
