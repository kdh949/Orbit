import { z } from "zod";

export const ooxmlReferenceSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);

export const ooxmlReferenceTemplateIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const approvedOoxmlReferenceFontAliases = [
  {
    requestedTypeface: "Lora SemiBold",
    targetFamily: "Lora",
    targetStyle: "SemiBold",
    aliasKind: "family-style",
    axisValues: { GRAD: null, opsz: null, wdth: null, wght: 600 },
    sourceFontSha256:
      "822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7",
    license: {
      spdxId: "OFL-1.1",
      sha256:
        "1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716"
    },
    approval: { status: "approved", approvedOn: "2026-07-23" }
  },
  {
    requestedTypeface: "Roboto SemiBold",
    targetFamily: "Roboto",
    targetStyle: "SemiBold",
    aliasKind: "family-style",
    axisValues: { GRAD: null, opsz: null, wdth: 100, wght: 600 },
    sourceFontSha256:
      "d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134",
    license: {
      spdxId: "OFL-1.1",
      sha256:
        "061402327a96aadb0bfb694a960ed289ecd38d383e396243831ab81feb109c41"
    },
    approval: { status: "approved", approvedOn: "2026-07-23" }
  },
  {
    requestedTypeface: "Roboto Serif 14pt",
    targetFamily: "Roboto Serif",
    targetStyle: "Regular",
    aliasKind: "variable-instance",
    axisValues: { GRAD: 0, opsz: 14, wdth: 100, wght: 400 },
    sourceFontSha256:
      "351ced75f3851806aa6d846b669361521eb1925cfc530396df9c1a1b77061ddb",
    license: {
      spdxId: "OFL-1.1",
      sha256:
        "34dbfbb43e0b4fdeef445d77b9ac0b988e5ad7a9bbf16808c97b66c66d51f553"
    },
    approval: { status: "approved", approvedOn: "2026-07-23" }
  },
  {
    requestedTypeface: "Roboto Serif 14pt Medium",
    targetFamily: "Roboto Serif",
    targetStyle: "Medium",
    aliasKind: "variable-instance",
    axisValues: { GRAD: 0, opsz: 14, wdth: 100, wght: 500 },
    sourceFontSha256:
      "351ced75f3851806aa6d846b669361521eb1925cfc530396df9c1a1b77061ddb",
    license: {
      spdxId: "OFL-1.1",
      sha256:
        "34dbfbb43e0b4fdeef445d77b9ac0b988e5ad7a9bbf16808c97b66c66d51f553"
    },
    approval: { status: "approved", approvedOn: "2026-07-23" }
  }
] as const;

export const ooxmlReferenceApprovedTemplateIdSchema = z.enum([
  "business-review",
  "market-trends-report",
  "operating-review",
  "project-kickoff",
  "simple-dark",
  "simple-light",
  "team-alignment"
]);

export const ooxmlReferenceFontAliasSchema = z
  .object({
    requestedTypeface: z.string().min(1).max(200),
    targetFamily: z.string().min(1).max(200),
    targetStyle: z.string().min(1).max(100),
    aliasKind: z.enum(["family-style", "variable-instance"]),
    axisValues: z
      .object({
        GRAD: z.number().int().nullable(),
        opsz: z.number().int().nullable(),
        wdth: z.number().int().nullable(),
        wght: z.number().int()
      })
      .strict(),
    sourceFontSha256: ooxmlReferenceSha256Schema,
    license: z
      .object({
        spdxId: z.literal("OFL-1.1"),
        sha256: ooxmlReferenceSha256Schema
      })
      .strict(),
    approval: z
      .object({
        status: z.literal("approved"),
        approvedOn: z.literal("2026-07-23")
      })
      .strict()
  })
  .strict();

export const ooxmlReferenceFontAliasPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    resolver: z.literal("fontconfig"),
    aliases: z.array(ooxmlReferenceFontAliasSchema).length(4)
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (
      JSON.stringify(policy.aliases) !==
      JSON.stringify(approvedOoxmlReferenceFontAliases)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aliases"],
        message: "font aliases must match the approved v1 mapping"
      });
    }
  });

const ooxmlReferenceIdentityBaselineSchema = z
  .object({
    templateId: ooxmlReferenceApprovedTemplateIdSchema,
    version: z.literal(1),
    renderer: z.string().min(1).max(100),
    rendererVersion: z.string().min(1).max(100),
    reportSha256: ooxmlReferenceSha256Schema
  })
  .strict();

export const ooxmlReferenceFidelityCalibrationSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("calibrated"),
    lockedRegionSsimThreshold: z.number().positive().max(1),
    geometryEdgeTolerancePx: z.literal(0),
    rationale: z.string().min(1).max(500),
    fontAliasPolicy: ooxmlReferenceFontAliasPolicySchema,
    identityBaselines: z
      .array(ooxmlReferenceIdentityBaselineSchema)
      .length(7)
  })
  .strict()
  .superRefine((calibration, ctx) => {
    const templateIds = new Set(
      calibration.identityBaselines.map((baseline) => baseline.templateId)
    );
    if (templateIds.size !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityBaselines"],
        message: "identity baselines must contain every approved template"
      });
    }
    const renderers = new Set(
      calibration.identityBaselines.map(
        (baseline) => `${baseline.renderer}\u0000${baseline.rendererVersion}`
      )
    );
    if (renderers.size !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityBaselines"],
        message: "identity baselines must use one exact renderer version"
      });
    }
  });

export const ooxmlTemplateSlotMutationSchema = z.enum([
  "text-content",
  "image-source",
  "table-cell-text",
  "chart-data"
]);

export const ooxmlTemplateSnapshotSchema = z
  .object({
    catalogTemplateId: ooxmlReferenceTemplateIdSchema,
    catalogTemplateVersion: z.number().int().positive(),
    sourceSha256: ooxmlReferenceSha256Schema,
    sourceSlideIds: z.array(z.string().trim().min(1)).min(1).max(200),
    slotAssignmentCount: z.number().int().nonnegative().max(10_000)
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const sourceSlideIds = new Set(snapshot.sourceSlideIds);
    if (sourceSlideIds.size !== snapshot.sourceSlideIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceSlideIds"],
        message: "source slide IDs must be unique"
      });
    }
  });

export const ooxmlReferenceDeckSnapshotSchema = z
  .object({
    catalogTemplateId: ooxmlReferenceTemplateIdSchema,
    catalogTemplateVersion: z.number().int().positive(),
    sourceSha256: ooxmlReferenceSha256Schema,
    generationId: z.string().trim().min(1).max(128)
  })
  .strict();

export type OoxmlTemplateSlotMutation = z.infer<
  typeof ooxmlTemplateSlotMutationSchema
>;
export type OoxmlTemplateSnapshot = z.infer<
  typeof ooxmlTemplateSnapshotSchema
>;
export type OoxmlReferenceDeckSnapshot = z.infer<
  typeof ooxmlReferenceDeckSnapshotSchema
>;
export type OoxmlReferenceFontAlias = z.infer<
  typeof ooxmlReferenceFontAliasSchema
>;
export type OoxmlReferenceFontAliasPolicy = z.infer<
  typeof ooxmlReferenceFontAliasPolicySchema
>;
export type OoxmlReferenceFidelityCalibration = z.infer<
  typeof ooxmlReferenceFidelityCalibrationSchema
>;
