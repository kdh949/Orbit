import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { jobSchema } from "../jobs/job.schema";
import { deckSchema } from "./deck.schema";
import { deckIdSchema } from "./id.schema";
import { deckChangeRecordSchema, deckPatchSchema } from "./patch.schema";
import { qualityReportSchema } from "./template-blueprint.schema";

type DeckApiIssuePath = Array<string | number>;

function addMismatchIssue(
  ctx: z.RefinementCtx,
  path: DeckApiIssuePath,
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
}

function requireMatchingProject(
  ctx: z.RefinementCtx,
  projectId: string,
  deckProjectId: string,
  path: DeckApiIssuePath,
): void {
  if (projectId !== deckProjectId) {
    addMismatchIssue(ctx, path, "projectId must match deck.projectId");
  }
}

function requireMatchingDeckId(
  ctx: z.RefinementCtx,
  deckId: string,
  nestedDeckId: string,
  path: DeckApiIssuePath,
): void {
  if (deckId !== nestedDeckId) {
    addMismatchIssue(ctx, path, "deckId must match nested deckId");
  }
}

function requireMatchingVersion(
  ctx: z.RefinementCtx,
  version: number,
  deckVersion: number,
  path: DeckApiIssuePath,
): void {
  if (version !== deckVersion) {
    addMismatchIssue(ctx, path, "version must match deck.version");
  }
}

export const deckApiProjectIdSchema = z.string().min(1);

export const deckSnapshotIdSchema = z
  .string()
  .regex(/^snapshot_[A-Za-z0-9_-]+$/);

export const deckSnapshotReasonSchema = z.enum([
  "auto-save",
  "deck-replaced",
  "patch-applied",
  "snapshot-restore",
]);

export const deckApiErrorCodeSchema = z.enum([
  "DECK_NOT_FOUND",
  "DECK_MISMATCH",
  "SNAPSHOT_NOT_FOUND",
  "PROJECT_MISMATCH",
  "DECK_VALIDATION_FAILED",
  "PATCH_VALIDATION_FAILED",
  "STALE_BASE_VERSION",
  "SNAPSHOT_PROJECT_MISMATCH",
  "PATCH_APPLY_FAILED",
  "PATCH_CHAIN_INVALID",
  "PATCH_CHAIN_CHECKPOINT_MISMATCH",
]);

export const deckApiErrorSchema = z.object({
  code: deckApiErrorCodeSchema,
  message: z.string().min(1),
  details: z.array(z.string()).default([]),
});

export const deckSnapshotSchema = z.object({
  snapshotId: deckSnapshotIdSchema,
  projectId: deckApiProjectIdSchema,
  deckId: deckIdSchema,
  version: z.number().int().positive(),
  reason: deckSnapshotReasonSchema,
  createdAt: isoDateTimeSchema,
});

export const deckSnapshotDetailSchema = deckSnapshotSchema
  .extend({
    deck: deckSchema,
  })
  .superRefine((snapshot, ctx) => {
    requireMatchingProject(ctx, snapshot.projectId, snapshot.deck.projectId, [
      "deck",
      "projectId",
    ]);
    requireMatchingDeckId(ctx, snapshot.deckId, snapshot.deck.deckId, [
      "deck",
      "deckId",
    ]);
    requireMatchingVersion(ctx, snapshot.version, snapshot.deck.version, [
      "deck",
      "version",
    ]);
  });

export const deckPatchLogEntrySchema = z.object({
  projectId: deckApiProjectIdSchema,
  changeRecord: deckChangeRecordSchema,
});

export const getDeckResponseSchema = z
  .object({
    projectId: deckApiProjectIdSchema,
    deck: deckSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((response, ctx) => {
    requireMatchingProject(ctx, response.projectId, response.deck.projectId, [
      "deck",
      "projectId",
    ]);
  });

export const pptxImportQualitySchema = z.object({
  qualityReport: qualityReportSchema,
});

export const getPptxImportQualityResponseSchema = z.object({
  importQuality: pptxImportQualitySchema.nullable(),
});

export const ooxmlSyncStatusSchema = z.enum([
  "not-applicable",
  "pending",
  "synced",
  "stale",
  "failed",
]);

export const ooxmlSyncStateSchema = z.object({
  status: ooxmlSyncStatusSchema,
  deckId: deckIdSchema,
  deckVersion: z.number().int().positive(),
  syncedDeckVersion: z.number().int().positive().nullable(),
  retryable: z.boolean(),
  job: jobSchema.optional(),
});

export const getOoxmlSyncStateResponseSchema = z.object({
  ooxmlSyncState: ooxmlSyncStateSchema,
});

export const retryOoxmlSyncResponseSchema = z.object({
  ooxmlSyncState: ooxmlSyncStateSchema,
});

export const putDeckRequestSchema = z.object({
  baseVersion: z.number().int().positive().optional(),
  deck: deckSchema,
  snapshotReason: deckSnapshotReasonSchema.optional(),
});

export const putDeckResponseSchema = z
  .object({
    deck: deckSchema,
    snapshot: deckSnapshotSchema,
    ooxmlSyncJob: jobSchema.optional(),
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((response, ctx) => {
    requireMatchingProject(
      ctx,
      response.snapshot.projectId,
      response.deck.projectId,
      ["snapshot", "projectId"],
    );
    requireMatchingDeckId(ctx, response.snapshot.deckId, response.deck.deckId, [
      "snapshot",
      "deckId",
    ]);
    requireMatchingVersion(
      ctx,
      response.snapshot.version,
      response.deck.version,
      ["snapshot", "version"],
    );
  });

export const appendDeckPatchRequestSchema: z.ZodObject<{
  patch: typeof deckPatchSchema;
  responseMode: z.ZodOptional<z.ZodLiteral<"ack">>;
  snapshotReason: z.ZodOptional<typeof deckSnapshotReasonSchema>;
}> = z.object({
  patch: deckPatchSchema,
  responseMode: z.literal("ack").optional(),
  snapshotReason: deckSnapshotReasonSchema.optional(),
});

export const appendDeckPatchAckResponseSchema = z
  .object({
    deckId: deckIdSchema,
    version: z.number().int().positive(),
    changeRecord: deckChangeRecordSchema,
    snapshot: deckSnapshotSchema.optional(),
    ooxmlSyncJob: jobSchema.optional(),
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((response, ctx) => {
    requireMatchingDeckId(ctx, response.deckId, response.changeRecord.deckId, [
      "changeRecord",
      "deckId",
    ]);
    requireMatchingVersion(
      ctx,
      response.version,
      response.changeRecord.afterVersion,
      ["changeRecord", "afterVersion"],
    );
    if (response.snapshot) {
      requireMatchingDeckId(ctx, response.deckId, response.snapshot.deckId, [
        "snapshot",
        "deckId",
      ]);
      requireMatchingVersion(ctx, response.version, response.snapshot.version, [
        "snapshot",
        "version",
      ]);
    }
  });

const appendDeckPatchResponseObjectSchema: z.ZodObject<{
  deck: typeof deckSchema;
  changeRecord: typeof deckChangeRecordSchema;
  snapshot: z.ZodNullable<typeof deckSnapshotSchema>;
  ooxmlSyncJob: z.ZodOptional<typeof jobSchema>;
  updatedAt: typeof isoDateTimeSchema;
}> = z.object({
  deck: deckSchema,
  changeRecord: deckChangeRecordSchema,
  snapshot: deckSnapshotSchema.nullable(),
  ooxmlSyncJob: jobSchema.optional(),
  updatedAt: isoDateTimeSchema,
});

export const appendDeckPatchResponseSchema: z.ZodEffects<
  typeof appendDeckPatchResponseObjectSchema
> = appendDeckPatchResponseObjectSchema.superRefine((response, ctx) => {
    requireMatchingDeckId(
      ctx,
      response.changeRecord.deckId,
      response.deck.deckId,
      ["changeRecord", "deckId"],
    );
    requireMatchingVersion(
      ctx,
      response.changeRecord.afterVersion,
      response.deck.version,
      ["changeRecord", "afterVersion"],
    );
    if (response.snapshot) {
      requireMatchingProject(
        ctx,
        response.snapshot.projectId,
        response.deck.projectId,
        ["snapshot", "projectId"],
      );
      requireMatchingDeckId(
        ctx,
        response.snapshot.deckId,
        response.deck.deckId,
        ["snapshot", "deckId"],
      );
      requireMatchingVersion(
        ctx,
        response.snapshot.version,
        response.deck.version,
        ["snapshot", "version"],
      );
    }
});

export const listDeckSnapshotsResponseSchema = z
  .object({
    projectId: deckApiProjectIdSchema,
    snapshots: z.array(deckSnapshotSchema),
  })
  .superRefine((response, ctx) => {
    response.snapshots.forEach((snapshot, index) => {
      if (snapshot.projectId !== response.projectId) {
        addMismatchIssue(
          ctx,
          ["snapshots", index, "projectId"],
          "snapshot.projectId must match response.projectId",
        );
      }
    });
  });

export const restoreDeckSnapshotResponseSchema = z
  .object({
    deck: deckSchema,
    restoredSnapshot: deckSnapshotSchema,
    ooxmlSyncJob: jobSchema.optional(),
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((response, ctx) => {
    requireMatchingProject(
      ctx,
      response.restoredSnapshot.projectId,
      response.deck.projectId,
      ["restoredSnapshot", "projectId"],
    );
    requireMatchingDeckId(
      ctx,
      response.restoredSnapshot.deckId,
      response.deck.deckId,
      ["restoredSnapshot", "deckId"],
    );
    if (response.ooxmlSyncJob) {
      requireMatchingProject(
        ctx,
        response.ooxmlSyncJob.projectId,
        response.deck.projectId,
        ["ooxmlSyncJob", "projectId"],
      );
    }
    if (response.deck.version !== response.restoredSnapshot.version) {
      if (response.ooxmlSyncJob?.type !== "pptx-ooxml-sync") {
        addMismatchIssue(
          ctx,
          ["ooxmlSyncJob", "type"],
          "version-normalized restore requires a pptx-ooxml-sync job",
        );
      }
    }
  });

export type DeckApiProjectId = z.infer<typeof deckApiProjectIdSchema>;
export type DeckSnapshotId = z.infer<typeof deckSnapshotIdSchema>;
export type DeckSnapshotReason = z.infer<typeof deckSnapshotReasonSchema>;
export type DeckApiErrorCode = z.infer<typeof deckApiErrorCodeSchema>;
export type DeckApiError = z.infer<typeof deckApiErrorSchema>;
export type DeckSnapshot = z.infer<typeof deckSnapshotSchema>;
export type DeckSnapshotDetail = z.infer<typeof deckSnapshotDetailSchema>;
export type DeckPatchLogEntry = z.infer<typeof deckPatchLogEntrySchema>;
export type GetDeckResponse = z.infer<typeof getDeckResponseSchema>;
export type PptxImportQuality = z.infer<typeof pptxImportQualitySchema>;
export type GetPptxImportQualityResponse = z.infer<
  typeof getPptxImportQualityResponseSchema
>;
export type OoxmlSyncStatus = z.infer<typeof ooxmlSyncStatusSchema>;
export type OoxmlSyncState = z.infer<typeof ooxmlSyncStateSchema>;
export type GetOoxmlSyncStateResponse = z.infer<
  typeof getOoxmlSyncStateResponseSchema
>;
export type RetryOoxmlSyncResponse = z.infer<
  typeof retryOoxmlSyncResponseSchema
>;
export type PutDeckRequest = z.infer<typeof putDeckRequestSchema>;
export type PutDeckResponse = z.infer<typeof putDeckResponseSchema>;
export type AppendDeckPatchRequest = z.infer<
  typeof appendDeckPatchRequestSchema
>;
export type AppendDeckPatchAckRequest = Omit<
  AppendDeckPatchRequest,
  "responseMode"
> & { responseMode: "ack" };
export type AppendDeckPatchFullRequest = Omit<
  AppendDeckPatchRequest,
  "responseMode"
> & { responseMode?: undefined };
export type AppendDeckPatchAckResponse = z.infer<
  typeof appendDeckPatchAckResponseSchema
>;
export type AppendDeckPatchResponse = z.infer<
  typeof appendDeckPatchResponseSchema
>;
export type ListDeckSnapshotsResponse = z.infer<
  typeof listDeckSnapshotsResponseSchema
>;
export type RestoreDeckSnapshotResponse = z.infer<
  typeof restoreDeckSnapshotResponseSchema
>;
