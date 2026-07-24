import {
  WebsocketEvent,
  WebsocketEventType,
  PresentationActivityEvent,
  PresentationCompanionEvent,
  demoIds,
  nowIso,
  presentationActivityEventSchema,
  presentationCompanionEventSchema,
  websocketEventSchema
} from "@orbit/shared";

export function projectRoomId(projectId = demoIds.projectId): string {
  return projectId;
}

export function presentationPresenterRoomId(sessionId: string): string {
  return `presentation:${sessionId}:presenter`;
}

export function presentationAudienceRoomId(sessionId: string): string {
  return `presentation:${sessionId}:audience`;
}

export function presentationCompanionAuthorityRoomId(
  sessionId: string,
  authorityEpochId: string
): string {
  return `presentation:${roomSegment(sessionId)}:companion-authority:${roomSegment(
    authorityEpochId
  )}`;
}

export function presentationCompanionRoomId(
  sessionId: string,
  pairingGeneration: number
): string {
  if (
    !Number.isSafeInteger(pairingGeneration) ||
    pairingGeneration <= 0
  ) {
    throw new Error("Companion generation must be a positive integer");
  }
  return `presentation:${roomSegment(
    sessionId
  )}:companion:${pairingGeneration}`;
}

export function parsePresentationActivityEvent(
  input: unknown
): PresentationActivityEvent {
  return presentationActivityEventSchema.parse(input);
}

export function createRealtimeEvent(input: {
  type: WebsocketEventType;
  roomId?: string;
  sessionId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
}): WebsocketEvent {
  return websocketEventSchema.parse({
    type: input.type,
    roomId: input.roomId ?? projectRoomId(),
    sessionId: input.sessionId,
    userId: input.userId ?? demoIds.userId,
    payload: input.payload ?? {},
    sentAt: nowIso()
  });
}

export function createPresentationCompanionEvent(input: {
  type: PresentationCompanionEvent["type"];
  roomId: string;
  sessionId: string;
  userId: string;
  payload: unknown;
}): PresentationCompanionEvent {
  return presentationCompanionEventSchema.parse({
    ...input,
    sentAt: nowIso()
  });
}

function roomSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Realtime room segment is invalid");
  }
  return value;
}
