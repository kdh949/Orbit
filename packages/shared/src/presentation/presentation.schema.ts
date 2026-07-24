import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { deckSchema } from "../deck/deck.schema";
import { deckIdSchema } from "../deck/id.schema";
import { activityRunIdSchema } from "../activity/activity-id.schema";
import { activityPresenterResultSchema } from "../activity/activity-results.schema";
import { activityRunSchema } from "../activity/activity-runtime.schema";
import { assetUploadUrlResponseSchema } from "../files/file.schema";
import { jobSchema } from "../jobs/job.schema";
import { rehearsalReportSchema } from "../rehearsals/rehearsal.schema";
import { slideTranscriptSnapshotsSchema } from "../rehearsals/slide-transcript-snapshot.schema";

export const presentationAccessModeSchema = z.enum(["passcode", "public"]);
export const presentationSessionPurposeSchema = z.enum([
  "presentation",
  "rehearsal",
]);

export const presentationSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    deckId: deckIdSchema,
    deckVersion: z.number().int().positive(),
    presenterUserId: z.string().min(1),
    createdBy: z.string().min(1),
    status: z.enum(["draft", "live", "ended"]),
    sessionPurpose: presentationSessionPurposeSchema.default("presentation"),
    audienceAccessEnabled: z.boolean().default(true),
    accessMode: presentationAccessModeSchema,
    startsAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    activeActivityRunId: activityRunIdSchema.nullable(),
    startedAt: isoDateTimeSchema.nullable(),
    endedAt: isoDateTimeSchema.nullable(),
    closedAt: isoDateTimeSchema.nullable(),
    rawResponsesDeleteAfter: isoDateTimeSchema.nullable(),
    rawResponsesDeletedAt: isoDateTimeSchema.nullable(),
    resultsDeletedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((session, ctx) => {
    const startsAt = new Date(session.startsAt).getTime();
    const expiresAt = new Date(session.expiresAt).getTime();
    if (expiresAt <= startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must be later than startsAt",
      });
    }
    if (expiresAt - startsAt > 30 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "presentation access cannot exceed 30 days",
      });
    }
    if (
      session.sessionPurpose === "rehearsal" &&
      session.audienceAccessEnabled
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audienceAccessEnabled"],
        message: "rehearsal sessions cannot enable audience access",
      });
    }
  });

const presentationSessionWindowFields = {
  startsAt: isoDateTimeSchema.optional(),
  expiresAt: isoDateTimeSchema.optional(),
};

const disabledPresentationSessionRequestSchema = z
  .object({
    deckId: deckIdSchema,
    ...presentationSessionWindowFields,
    sessionPurpose: presentationSessionPurposeSchema.default("presentation"),
    audienceAccessEnabled: z.literal(false),
    reuseCurrent: z.boolean().optional(),
  })
  .strict();

const passcodePresentationSessionRequestSchema = z
  .object({
    deckId: deckIdSchema,
    ...presentationSessionWindowFields,
    sessionPurpose: z.literal("presentation").default("presentation"),
    audienceAccessEnabled: z.literal(true),
    accessMode: z.literal("passcode"),
    passcode: z.string().regex(/^\d{4}$/),
    reuseCurrent: z.boolean().optional(),
  })
  .strict();

const publicPresentationSessionRequestSchema = z
  .object({
    deckId: deckIdSchema,
    ...presentationSessionWindowFields,
    sessionPurpose: z.literal("presentation").default("presentation"),
    audienceAccessEnabled: z.literal(true),
    accessMode: z.literal("public"),
    reuseCurrent: z.boolean().optional(),
  })
  .strict();

export const createPresentationSessionRequestSchema = z.preprocess(
  withAudienceAccessCompatibilityDefault,
  z.union([
    disabledPresentationSessionRequestSchema,
    passcodePresentationSessionRequestSchema,
    publicPresentationSessionRequestSchema,
  ]),
);

const updatePresentationSessionAccessEnabledSchema = z.union([
  z
    .object({
      audienceAccessEnabled: z.literal(true),
      startsAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema,
      accessMode: z.literal("passcode"),
      passcode: z.string().regex(/^\d{4}$/),
    })
    .strict(),
  z
    .object({
      audienceAccessEnabled: z.literal(true),
      startsAt: isoDateTimeSchema,
      expiresAt: isoDateTimeSchema,
      accessMode: z.literal("public"),
    })
    .strict(),
]).superRefine((request, ctx) => {
  const startsAt = new Date(request.startsAt).getTime();
  const expiresAt = new Date(request.expiresAt).getTime();
  if (
    expiresAt <= startsAt ||
    expiresAt - startsAt > 30 * 24 * 60 * 60 * 1000
  ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message:
          "presentation access must be later than startsAt and no longer than 30 days",
      });
    }
});

export const updatePresentationSessionAccessRequestSchema = z.union([
  z.object({ audienceAccessEnabled: z.literal(false) }).strict(),
  updatePresentationSessionAccessEnabledSchema,
]);

export const presentationSessionResponseSchema = z
  .object({ session: presentationSessionSchema })
  .strict();

export const presentationSessionWithAudienceUrlResponseSchema = z
  .object({
    session: presentationSessionSchema,
    audienceUrl: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine(assertAudienceUrlMatchesSession);

export const presentationRunStatusSchema = z.enum([
  "created",
  "uploading",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
]);

export const presentationRecordingModeSchema = z.enum(["microphone", "none"]);

export const presentationRunErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const presentationVoiceReportSchema = z
  .object({
    durationSeconds: z.number().nonnegative(),
    wordsPerMinute: z.number().nonnegative(),
    averageVolumeDbfs: z.number().finite().nullable(),
    fillerWordCount: z.number().int().nonnegative(),
    longSilenceCount: z.number().int().nonnegative(),
    averagePitchHz: z.number().nonnegative().nullable(),
    scriptFeedback: z.string().default(""),
  })
  .strict();

export const presentationRunSchema = z
  .object({
    runId: z.string().min(1),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    deckId: deckIdSchema,
    deckVersion: z.number().int().positive(),
    recordingMode: presentationRecordingModeSchema,
    audioFileId: z.string().min(1).nullable(),
    jobId: z.string().min(1).nullable(),
    status: presentationRunStatusSchema,
    error: presentationRunErrorSchema.nullable(),
    voiceReport: presentationVoiceReportSchema.nullable(),
    detailedReport: rehearsalReportSchema.nullable().default(null),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const createPresentationRunRequestSchema = z
  .object({
    expectedDeckVersion: z.number().int().positive(),
    recordingMode: presentationRecordingModeSchema.default("microphone"),
  })
  .strict();

export const createPresentationRunResponseSchema = z
  .object({ run: presentationRunSchema })
  .strict();

export const getPresentationRunResponseSchema =
  createPresentationRunResponseSchema;

export const listPresentationRunsResponseSchema = z
  .object({
    runs: z.array(presentationRunSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export const createPresentationAudioUploadRequestSchema = z
  .object({
    originalName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1),
    size: z.number().int().positive(),
  })
  .strict();

export const createPresentationAudioUploadResponseSchema = z
  .object({
    run: presentationRunSchema,
    upload: assetUploadUrlResponseSchema,
  })
  .strict();

export const completePresentationAudioRequestSchema = z.union([
  z
    .object({
      fileId: z.string().min(1),
      liveTranscript: z.string().max(200_000).nullable().default(null),
      slideTranscriptSnapshots: slideTranscriptSnapshotsSchema.default([]),
    })
    .strict(),
  z.object({ withoutAudio: z.literal(true) }).strict(),
]);

export const completePresentationAudioResponseSchema = z
  .object({
    run: presentationRunSchema,
    job: jobSchema.nullable(),
  })
  .strict();

export const presentationRunReportSchema = z
  .object({
    runId: z.string().min(1),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    analysisStatus: presentationRunStatusSchema,
    recordingMode: presentationRecordingModeSchema,
    voiceReport: presentationVoiceReportSchema.nullable(),
    detailedReport: rehearsalReportSchema.nullable().default(null),
    deck: deckSchema,
    audienceSummary: z
      .object({
        activities: z.array(
          z
            .object({
              availability: z.enum([
                "raw-retained",
                "aggregate-only",
                "results-deleted",
              ]),
              result: activityPresenterResultSchema.nullable(),
              run: activityRunSchema,
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const getPresentationRunReportResponseSchema = z
  .object({ report: presentationRunReportSchema })
  .strict();

export const presentationAnalysisJobPayloadSchema = z
  .object({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    deckId: deckIdSchema,
    audioFileId: z.string().min(1),
    liveTranscript: z.string().max(200_000).nullable().default(null),
    slideTranscriptSnapshots: slideTranscriptSnapshotsSchema.default([]),
  })
  .strict();

export const getCurrentPresentationSessionResponseSchema = z
  .object({
    session: presentationSessionSchema.nullable(),
    audienceUrl: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine(assertAudienceUrlMatchesSession);

function withAudienceAccessCompatibilityDefault(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    "audienceAccessEnabled" in value
  ) {
    return value;
  }
  return {
    ...value,
    audienceAccessEnabled: "accessMode" in value,
  };
}

function assertAudienceUrlMatchesSession(
  response: {
    session: {
      audienceAccessEnabled: boolean;
    } | null;
    audienceUrl: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (response.session === null) {
    if (response.audienceUrl !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audienceUrl"],
        message: "audienceUrl must be null without a session",
      });
    }
    return;
  }
  if (
    response.session.audienceAccessEnabled !==
    (response.audienceUrl !== null)
  ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audienceUrl"],
        message: "audienceUrl must match audienceAccessEnabled",
      });
    }
}

export const listPresentationSessionsResponseSchema = z
  .object({ sessions: z.array(presentationSessionSchema) })
  .strict();

export const rehearsalMetricsSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  deckId: deckIdSchema,
  durationSeconds: z.number().nonnegative(),
  wordsPerMinute: z.number().nonnegative(),
  fillerWordCount: z.number().int().nonnegative(),
  longSilenceCount: z.number().int().nonnegative().nullable(),
  keywordCoverage: z.number().min(0).max(1),
});

export const reportSchema = z.object({
  reportId: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  summary: z.string().default(""),
  questionCount: z.number().int().nonnegative(),
  pollCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
});

export const audienceAccessSessionStatusSchema = z.enum(["open", "closed"]);

export const audienceAccessSessionSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  status: audienceAccessSessionStatusSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});

export const createAudienceAccessSessionRequestSchema = z.object({
  passcode: z.string().regex(/^\d{4}$/, "passcode must be exactly 4 digits"),
  expiresInHours: z.number().int().min(1).max(24),
});

export const createAudienceAccessSessionResponseSchema = z.object({
  session: audienceAccessSessionSchema,
  audienceUrl: z.string().min(1),
});

export const getCurrentAudienceAccessSessionResponseSchema = z.object({
  session: audienceAccessSessionSchema.nullable(),
  audienceUrl: z.string().min(1).nullable(),
});

export const updateAudienceAccessSessionStatusRequestSchema = z.object({
  status: audienceAccessSessionStatusSchema,
});

export const updateAudienceAccessSessionStatusResponseSchema = z.object({
  session: audienceAccessSessionSchema,
});

export const verifyAudienceAccessSessionRequestSchema = z.object({
  passcode: z.string().regex(/^\d{4}$/, "passcode must be exactly 4 digits"),
});

export const verifyAudienceAccessSessionResponseSchema = z.object({
  verified: z.literal(true),
  session: audienceAccessSessionSchema,
});

export const audiencePresentationAvailabilitySchema = z.enum([
  "scheduled",
  "open",
  "closed",
]);

export const audiencePresentationPublicInfoSchema = z
  .object({
    sessionId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    accessMode: presentationAccessModeSchema,
    startsAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    availability: audiencePresentationAvailabilitySchema,
  })
  .strict();

export const getAudiencePresentationPublicInfoResponseSchema = z
  .object({ session: audiencePresentationPublicInfoSchema })
  .strict();

export const joinAudiencePresentationRequestSchema = z
  .object({
    passcode: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
  })
  .strict();

export const audiencePresentationAccessSchema = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    deckId: deckIdSchema,
    accessMode: presentationAccessModeSchema,
    startsAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    activeActivityRunId: activityRunIdSchema.nullable(),
  })
  .strict();

export const audiencePresentationAccessResponseSchema = z
  .object({
    verified: z.literal(true),
    session: audiencePresentationAccessSchema,
  })
  .strict();

export type PresentationSession = z.infer<typeof presentationSessionSchema>;
export type PresentationRun = z.infer<typeof presentationRunSchema>;
export type PresentationRunStatus = z.infer<typeof presentationRunStatusSchema>;
export type ListPresentationRunsResponse = z.infer<
  typeof listPresentationRunsResponseSchema
>;
export type PresentationRecordingMode = z.infer<
  typeof presentationRecordingModeSchema
>;
export type PresentationVoiceReport = z.infer<
  typeof presentationVoiceReportSchema
>;
export type CreatePresentationRunRequest = z.infer<
  typeof createPresentationRunRequestSchema
>;
export type CreatePresentationAudioUploadRequest = z.infer<
  typeof createPresentationAudioUploadRequestSchema
>;
export type CompletePresentationAudioRequest = z.infer<
  typeof completePresentationAudioRequestSchema
>;
export type PresentationAnalysisJobPayload = z.infer<
  typeof presentationAnalysisJobPayloadSchema
>;
export type PresentationAccessMode = z.infer<
  typeof presentationAccessModeSchema
>;
export type PresentationSessionPurpose = z.infer<
  typeof presentationSessionPurposeSchema
>;
export type CreatePresentationSessionRequest = z.infer<
  typeof createPresentationSessionRequestSchema
>;
export type UpdatePresentationSessionAccessRequest = z.infer<
  typeof updatePresentationSessionAccessRequestSchema
>;
export type PresentationSessionWithAudienceUrlResponse = z.infer<
  typeof presentationSessionWithAudienceUrlResponseSchema
>;
export type GetCurrentPresentationSessionResponse = z.infer<
  typeof getCurrentPresentationSessionResponseSchema
>;
export type RehearsalMetrics = z.infer<typeof rehearsalMetricsSchema>;
export type PresentationReport = z.infer<typeof reportSchema>;
export type AudienceAccessSession = z.infer<typeof audienceAccessSessionSchema>;
export type AudienceAccessSessionStatus = z.infer<
  typeof audienceAccessSessionStatusSchema
>;
export type CreateAudienceAccessSessionRequest = z.infer<
  typeof createAudienceAccessSessionRequestSchema
>;
export type CreateAudienceAccessSessionResponse = z.infer<
  typeof createAudienceAccessSessionResponseSchema
>;
export type GetCurrentAudienceAccessSessionResponse = z.infer<
  typeof getCurrentAudienceAccessSessionResponseSchema
>;
export type UpdateAudienceAccessSessionStatusRequest = z.infer<
  typeof updateAudienceAccessSessionStatusRequestSchema
>;
export type UpdateAudienceAccessSessionStatusResponse = z.infer<
  typeof updateAudienceAccessSessionStatusResponseSchema
>;
export type VerifyAudienceAccessSessionRequest = z.infer<
  typeof verifyAudienceAccessSessionRequestSchema
>;
export type VerifyAudienceAccessSessionResponse = z.infer<
  typeof verifyAudienceAccessSessionResponseSchema
>;
export type AudiencePresentationPublicInfo = z.infer<
  typeof audiencePresentationPublicInfoSchema
>;
export type JoinAudiencePresentationRequest = z.infer<
  typeof joinAudiencePresentationRequestSchema
>;
export type AudiencePresentationAccess = z.infer<
  typeof audiencePresentationAccessSchema
>;
