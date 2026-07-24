import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import {
  activityIdSchema,
  activityRunIdSchema
} from "../activity/activity-id.schema";
import { activityPublicResultSchema } from "../activity/activity-results.schema";
import { activityRuntimeStatusSchema } from "../activity/activity-runtime.schema";
import {
  deckElementIdSchema,
  deckIdSchema,
  deckSlideIdSchema
} from "../deck/id.schema";
import { companionAccessScopesSchema } from "../presentation/presenter-companion.schema";

export const websocketEventTypeSchema = z.enum([
  "project-joined",
  "project-presence",
  "deck-updated",
  "slide-changed",
  "highlight-changed",
  "presentation-started",
  "audience-joined",
  "question-created",
  "poll-voted",
  "survey-submitted",
  "active-activity-changed",
  "activity-state-changed",
  "activity-results-updated",
  "presentation:companion:authority-changed",
  "presentation:companion:joined",
  "presentation:companion:presence",
  "presentation:companion:output-state",
  "presentation:companion:annotation-command",
  "presentation:companion:annotation-ack",
  "presentation:companion:annotation-snapshot",
  "presentation:companion:snapshot-request",
  "presentation:companion:laser",
  "presentation:companion:signal",
  "presentation:companion:revoked",
  "presentation:error"
]);

export const websocketEventSchema = z.object({
  type: websocketEventTypeSchema,
  roomId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  userId: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  sentAt: isoDateTimeSchema
});

export const slideChangedPayloadSchema = z.object({
  deckId: deckIdSchema,
  slideId: deckSlideIdSchema,
  slideIndex: z.number().int().nonnegative()
});

export const highlightChangedPayloadSchema = z.object({
  slideId: deckSlideIdSchema,
  elementId: deckElementIdSchema,
  state: z.enum(["active", "inactive"])
});

export const activeActivityChangedPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    activityId: activityIdSchema,
    activityRunId: activityRunIdSchema,
    revision: z.number().int().nonnegative()
  })
  .strict();

export const activityStateChangedPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    activityId: activityIdSchema,
    activityRunId: activityRunIdSchema,
    status: activityRuntimeStatusSchema,
    revision: z.number().int().nonnegative()
  })
  .strict();

export const activityResultsUpdatedPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    activityRunId: activityRunIdSchema,
    revision: z.number().int().nonnegative(),
    refetch: z.boolean(),
    publicResult: activityPublicResultSchema.optional()
  })
  .strict();

const presentationEventEnvelopeShape = {
  roomId: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.literal("system"),
  sentAt: isoDateTimeSchema
};

export const activeActivityChangedEventSchema = z
  .object({
    ...presentationEventEnvelopeShape,
    type: z.literal("active-activity-changed"),
    payload: activeActivityChangedPayloadSchema
  })
  .strict();

export const activityStateChangedEventSchema = z
  .object({
    ...presentationEventEnvelopeShape,
    type: z.literal("activity-state-changed"),
    payload: activityStateChangedPayloadSchema
  })
  .strict();

export const activityResultsUpdatedEventSchema = z
  .object({
    ...presentationEventEnvelopeShape,
    type: z.literal("activity-results-updated"),
    payload: activityResultsUpdatedPayloadSchema
  })
  .strict();

export const presentationActivityEventSchema = z.discriminatedUnion("type", [
  activeActivityChangedEventSchema,
  activityStateChangedEventSchema,
  activityResultsUpdatedEventSchema
]);

export type WebsocketEvent = z.infer<typeof websocketEventSchema>;
export type WebsocketEventType = z.infer<typeof websocketEventTypeSchema>;
export type SlideChangedPayload = z.infer<typeof slideChangedPayloadSchema>;
export type HighlightChangedPayload = z.infer<
  typeof highlightChangedPayloadSchema
>;
export type ActiveActivityChangedPayload = z.infer<
  typeof activeActivityChangedPayloadSchema
>;
export type ActivityStateChangedPayload = z.infer<
  typeof activityStateChangedPayloadSchema
>;
export type ActivityResultsUpdatedPayload = z.infer<
  typeof activityResultsUpdatedPayloadSchema
>;
export type PresentationActivityEvent = z.infer<
  typeof presentationActivityEventSchema
>;

export const presentationCompanionMaxCommandBytes = 32 * 1024;
export const presentationCompanionMaxPointBatch = 64;
export const presentationCompanionMaxStrokePoints = 4_096;
export const presentationCompanionMaxSurfaceStrokes = 500;
export const presentationCompanionMaxSurfacePoints = 50_000;
export const presentationCompanionMaxSdpLength = 32 * 1024;
export const presentationCompanionMaxIceCandidateLength = 4 * 1024;

const companionOpaqueIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);
const companionSessionIdSchema = z.string().min(1).max(128);
const companionGenerationSchema = z.number().int().positive();
const companionRevisionSchema = z.number().int().nonnegative();
const companionSequenceSchema = z.number().int().nonnegative();
const normalizedCoordinateSchema = z.number().finite().min(0).max(1);

export const presentationCompanionRttBucketSchema = z.enum([
  "fast",
  "moderate",
  "slow",
  "unknown"
]);

export const presentationCompanionPointSchema = z
  .object({
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    pressure: z.number().finite().min(0).max(1),
    t: z.number().finite().min(0).max(120_000)
  })
  .strict();

const annotationCommandBase = {
  sessionId: companionSessionIdSchema,
  authorityEpochId: companionOpaqueIdSchema,
  surfaceId: companionOpaqueIdSchema,
  clientOperationId: companionOpaqueIdSchema,
  baseRevision: companionRevisionSchema,
  sequence: companionSequenceSchema
};

const strokeCommandFields = {
  strokeId: companionOpaqueIdSchema
};

export const presentationCompanionAnnotationCommandSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...annotationCommandBase,
        ...strokeCommandFields,
        kind: z.literal("stroke-begin"),
        tool: z.enum(["pen", "highlighter"]),
        color: z.enum([
          "ink-black",
          "ink-blue",
          "ink-red",
          "ink-green",
          "ink-yellow"
        ]),
        width: z.number().finite().min(0.001).max(0.05),
        point: presentationCompanionPointSchema
      })
      .strict(),
    z
      .object({
        ...annotationCommandBase,
        ...strokeCommandFields,
        kind: z.literal("stroke-points"),
        points: z
          .array(presentationCompanionPointSchema)
          .min(1)
          .max(presentationCompanionMaxPointBatch)
      })
      .strict(),
    z
      .object({
        ...annotationCommandBase,
        ...strokeCommandFields,
        kind: z.literal("stroke-end")
      })
      .strict(),
    z
      .object({
        ...annotationCommandBase,
        ...strokeCommandFields,
        kind: z.literal("stroke-delete")
      })
      .strict(),
    z
      .object({
        ...annotationCommandBase,
        kind: z.literal("undo")
      })
      .strict(),
    z
      .object({
        ...annotationCommandBase,
        kind: z.literal("clear-surface")
      })
      .strict()
  ])
  .superRefine((command, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(command)).byteLength >
      presentationCompanionMaxCommandBytes
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "annotation command exceeds byte limit"
      });
    }
  });

export const presentationCompanionAuthorityPayloadSchema = z
  .object({
    sessionId: companionSessionIdSchema,
    authorityEpochId: companionOpaqueIdSchema
  })
  .strict();

export const presentationCompanionJoinPayloadSchema = z
  .object({
    sessionId: companionSessionIdSchema
  })
  .strict();

export const presentationCompanionHeartbeatPayloadSchema = z
  .object({
    sessionId: companionSessionIdSchema,
    rttMs: z.number().finite().min(0).max(60_000).optional()
  })
  .strict();

const presentationCompanionOutputStateBase = {
  sessionId: companionSessionIdSchema,
  authorityEpochId: companionOpaqueIdSchema,
  outputRevision: companionRevisionSchema,
  slideId: deckSlideIdSchema,
  slideIndex: z.number().int().nonnegative(),
  animationStep: z.number().int().nonnegative(),
};

const presentationCompanionDrawableOutputStateBase = {
  ...presentationCompanionOutputStateBase,
  surfaceRevision: companionRevisionSchema,
  surfaceId: companionOpaqueIdSchema
};

export const presentationCompanionOutputStateSchema = z.discriminatedUnion(
  "outputMode",
  [
    z
      .object({
        ...presentationCompanionDrawableOutputStateBase,
        outputMode: z.literal("slide")
      })
      .strict(),
    z
      .object({
        ...presentationCompanionDrawableOutputStateBase,
        outputMode: z.literal("screen-share"),
        shareEpochId: companionOpaqueIdSchema
      })
      .strict(),
    z
      .object({
        ...presentationCompanionOutputStateBase,
        outputMode: z.literal("black")
      })
      .strict()
  ]
);

export const presentationCompanionAnnotationAckSchema = z
  .object({
    sessionId: companionSessionIdSchema,
    authorityEpochId: companionOpaqueIdSchema,
    clientOperationId: companionOpaqueIdSchema,
    accepted: z.boolean(),
    reason: z
      .enum([
        "accepted",
        "stale-revision",
        "invalid-surface",
        "limit-exceeded",
        "not-authority"
      ]),
    surfaceRevision: companionRevisionSchema
  })
  .strict()
  .superRefine((acknowledgement, context) => {
    if (
      acknowledgement.accepted !==
      (acknowledgement.reason === "accepted")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "annotation acknowledgement reason is inconsistent"
      });
    }
  });

export const presentationCompanionStrokeSchema = z
  .object({
    strokeId: companionOpaqueIdSchema,
    tool: z.enum(["pen", "highlighter"]),
    color: z.enum([
      "ink-black",
      "ink-blue",
      "ink-red",
      "ink-green",
      "ink-yellow"
    ]),
    width: z.number().finite().min(0.001).max(0.05),
    points: z
      .array(presentationCompanionPointSchema)
      .min(1)
      .max(presentationCompanionMaxStrokePoints)
  })
  .strict();

export const presentationCompanionAnnotationSnapshotSchema = z
  .object({
    sessionId: companionSessionIdSchema,
    authorityEpochId: companionOpaqueIdSchema,
    surfaceId: companionOpaqueIdSchema,
    surfaceRevision: companionRevisionSchema,
    strokes: z
      .array(presentationCompanionStrokeSchema)
      .max(presentationCompanionMaxSurfaceStrokes)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const pointCount = snapshot.strokes.reduce(
      (count, stroke) => count + stroke.points.length,
      0
    );
    if (pointCount > presentationCompanionMaxSurfacePoints) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["strokes"],
        message: "annotation snapshot exceeds point limit"
      });
    }
  });

export const presentationCompanionSnapshotRequestSchema = z
  .object({
    sessionId: companionSessionIdSchema,
    authorityEpochId: companionOpaqueIdSchema,
    surfaceId: companionOpaqueIdSchema,
    lastOutputRevision: companionRevisionSchema,
    lastSurfaceRevision: companionRevisionSchema
  })
  .strict();

const laserBase = {
  sessionId: companionSessionIdSchema,
  authorityEpochId: companionOpaqueIdSchema,
  surfaceId: companionOpaqueIdSchema,
  sequence: companionSequenceSchema
};

export const presentationCompanionLaserSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        ...laserBase,
        kind: z.literal("move"),
        x: normalizedCoordinateSchema,
        y: normalizedCoordinateSchema
      })
      .strict(),
    z
      .object({
        ...laserBase,
        kind: z.literal("hide")
      })
      .strict()
  ]
);

const signalBase = {
  sessionId: companionSessionIdSchema,
  authorityEpochId: companionOpaqueIdSchema,
  targetGeneration: companionGenerationSchema,
  shareEpochId: companionOpaqueIdSchema,
  signalId: companionOpaqueIdSchema
};

export const presentationCompanionSignalSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        ...signalBase,
        kind: z.literal("offer"),
        sdp: z.string().min(1).max(presentationCompanionMaxSdpLength)
      })
      .strict(),
    z
      .object({
        ...signalBase,
        kind: z.literal("answer"),
        sdp: z.string().min(1).max(presentationCompanionMaxSdpLength)
      })
      .strict(),
    z
      .object({
        ...signalBase,
        kind: z.literal("ice"),
        candidate: z
          .string()
          .min(1)
          .max(presentationCompanionMaxIceCandidateLength),
        sdpMid: z.string().max(256).nullable(),
        sdpMLineIndex: z.number().int().min(0).max(1_024).nullable(),
        usernameFragment: z.string().max(256).optional()
      })
      .strict(),
    z
      .object({
        ...signalBase,
        kind: z.literal("end"),
        reason: z.enum([
          "capture-ended",
          "replaced",
          "revoked",
          "closed",
          "failed"
        ])
      })
      .strict()
  ]
);

const companionEventEnvelopeShape = {
  roomId: z.string().min(1).max(256),
  sessionId: companionSessionIdSchema,
  userId: z.union([
    z.literal("system"),
    z.string().regex(/^presenter:[A-Za-z0-9_-]{1,128}$/),
    z.string().regex(/^companion:companion_[A-Za-z0-9_-]{1,128}$/)
  ]),
  sentAt: isoDateTimeSchema
};

function companionEventSchema<
  Type extends string,
  PayloadSchema extends z.ZodTypeAny
>(type: Type, payload: PayloadSchema) {
  return z
    .object({
      ...companionEventEnvelopeShape,
      type: z.literal(type),
      payload
    })
    .strict();
}

export const presentationCompanionAuthorityChangedEventSchema =
  companionEventSchema(
    "presentation:companion:authority-changed",
    z
      .object({
        authorityEpochId: companionOpaqueIdSchema.nullable()
      })
      .strict()
  );

export const presentationCompanionJoinedEventSchema =
  companionEventSchema(
    "presentation:companion:joined",
    z
      .object({
        pairingGeneration: companionGenerationSchema,
        scopes: companionAccessScopesSchema
      })
      .strict()
  );

export const presentationCompanionPresenceEventSchema =
  companionEventSchema(
    "presentation:companion:presence",
    z
      .object({
        connected: z.boolean(),
        pairingGeneration: companionGenerationSchema.nullable(),
        connectedAt: isoDateTimeSchema.nullable(),
        rttBucket: presentationCompanionRttBucketSchema.nullable()
      })
      .strict()
  );

export const presentationCompanionOutputStateEventSchema =
  companionEventSchema(
    "presentation:companion:output-state",
    presentationCompanionOutputStateSchema
  );

export const presentationCompanionAnnotationCommandEventSchema =
  companionEventSchema(
    "presentation:companion:annotation-command",
    presentationCompanionAnnotationCommandSchema
  );

export const presentationCompanionAnnotationAckEventSchema =
  companionEventSchema(
    "presentation:companion:annotation-ack",
    presentationCompanionAnnotationAckSchema
  );

export const presentationCompanionAnnotationSnapshotEventSchema =
  companionEventSchema(
    "presentation:companion:annotation-snapshot",
    presentationCompanionAnnotationSnapshotSchema
  );

export const presentationCompanionSnapshotRequestEventSchema =
  companionEventSchema(
    "presentation:companion:snapshot-request",
    presentationCompanionSnapshotRequestSchema
  );

export const presentationCompanionLaserEventSchema =
  companionEventSchema(
    "presentation:companion:laser",
    presentationCompanionLaserSchema
  );

export const presentationCompanionSignalEventSchema =
  companionEventSchema(
    "presentation:companion:signal",
    presentationCompanionSignalSchema
  );

export const presentationCompanionRevokedEventSchema =
  companionEventSchema(
    "presentation:companion:revoked",
    z
      .object({
        reason: z.enum([
          "replaced",
          "disconnected",
          "session-ended",
          "expired"
        ])
      })
      .strict()
  );

export const presentationCompanionErrorEventSchema =
  companionEventSchema(
    "presentation:error",
    z
      .object({
        code: z.enum([
          "AUTH_REQUIRED",
          "SESSION_UNAVAILABLE",
          "NOT_AUTHORITY",
          "STALE_GENERATION",
          "INVALID_PAYLOAD",
          "RATE_LIMITED"
        ]),
        message: z.enum([
          "Authentication required",
          "Presentation session unavailable",
          "Presenter authority unavailable",
          "Companion credential expired",
          "Invalid presentation command",
          "Too many presentation commands"
        ])
      })
      .strict()
  );

export const presentationCompanionEventSchema =
  z.discriminatedUnion("type", [
    presentationCompanionAuthorityChangedEventSchema,
    presentationCompanionJoinedEventSchema,
    presentationCompanionPresenceEventSchema,
    presentationCompanionOutputStateEventSchema,
    presentationCompanionAnnotationCommandEventSchema,
    presentationCompanionAnnotationAckEventSchema,
    presentationCompanionAnnotationSnapshotEventSchema,
    presentationCompanionSnapshotRequestEventSchema,
    presentationCompanionLaserEventSchema,
    presentationCompanionSignalEventSchema,
    presentationCompanionRevokedEventSchema,
    presentationCompanionErrorEventSchema
  ]);

export type PresentationCompanionPoint = z.infer<
  typeof presentationCompanionPointSchema
>;
export type PresentationCompanionAnnotationCommand = z.infer<
  typeof presentationCompanionAnnotationCommandSchema
>;
export type PresentationCompanionOutputState = z.infer<
  typeof presentationCompanionOutputStateSchema
>;
export type PresentationCompanionAnnotationAck = z.infer<
  typeof presentationCompanionAnnotationAckSchema
>;
export type PresentationCompanionAnnotationSnapshot = z.infer<
  typeof presentationCompanionAnnotationSnapshotSchema
>;
export type PresentationCompanionStroke = z.infer<
  typeof presentationCompanionStrokeSchema
>;
export type PresentationCompanionSnapshotRequest = z.infer<
  typeof presentationCompanionSnapshotRequestSchema
>;
export type PresentationCompanionLaser = z.infer<
  typeof presentationCompanionLaserSchema
>;
export type PresentationCompanionSignal = z.infer<
  typeof presentationCompanionSignalSchema
>;
export type PresentationCompanionEvent = z.infer<
  typeof presentationCompanionEventSchema
>;
