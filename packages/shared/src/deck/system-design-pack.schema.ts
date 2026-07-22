import { z } from "zod";

const systemDesignPackIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const systemDesignPackLayoutIdSchema = systemDesignPackIdSchema;
const systemDesignPackProfileSchema = z.enum([
  "proposal",
  "executive-report",
  "product-launch",
  "education",
  "technical",
  "research",
  "general-inform"
]);
const systemDesignPackPurposeSchema = z.enum([
  "inform",
  "persuade",
  "teach",
  "report"
]);
const systemDesignPackMediaPolicySchema = z.enum([
  "avoid",
  "balanced",
  "placeholder-ok",
  "provided-only",
  "public-assets",
  "ai-generated",
  "hybrid",
  "minimal"
]);

export const systemDesignPackLayoutCapacitySchema = z
  .object({
    titleMaxLines: z.number().int().min(1).max(3),
    messageMaxChars: z.number().int().min(20).max(400),
    itemMin: z.number().int().min(0).max(12),
    itemMax: z.number().int().min(0).max(12)
  })
  .strict()
  .superRefine((capacity, context) => {
    if (capacity.itemMin > capacity.itemMax) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemMax"],
        message: "itemMax must be greater than or equal to itemMin"
      });
    }
  });

export const systemDesignPackLayoutSchema = z
  .object({
    layoutId: systemDesignPackLayoutIdSchema,
    rendererId: systemDesignPackLayoutIdSchema,
    slideRoles: z
      .array(
        z.enum([
          "cover",
          "section",
          "summary",
          "statement",
          "content",
          "comparison",
          "process",
          "timeline",
          "data",
          "chart",
          "decision",
          "closing"
        ])
      )
      .min(1),
    silhouetteId: systemDesignPackIdSchema,
    backgroundModes: z.array(z.enum(["light", "dark", "image"])).min(1),
    contentCapacity: systemDesignPackLayoutCapacitySchema,
    dataRequirement: z
      .enum(["none", "grounded-metrics", "table", "chart", "timeline"])
      .default("none"),
    mediaRequirement: z.enum(["none", "optional", "required"]).default("none"),
    slots: z
      .array(
        z
          .object({
            role: z.enum([
              "title",
              "subtitle",
              "body",
              "metric",
              "evidence",
              "source",
              "media",
              "table",
              "chart"
            ]),
            required: z.boolean()
          })
          .strict()
      )
      .min(1),
    previewId: systemDesignPackIdSchema
  })
  .strict();

export const systemDesignPackManifestSchema = z
  .object({
    id: systemDesignPackIdSchema,
    version: z.number().int().positive(),
    family: z.enum([
      "neutral",
      "executive-review",
      "kickoff-alignment",
      "editorial-insight"
    ]),
    variant: z.enum(["light", "dark", "mixed"]),
    status: z.enum(["draft", "active", "disabled"]),
    baseStylePackId: systemDesignPackIdSchema,
    supportedProfiles: z.array(systemDesignPackProfileSchema).min(1),
    supportedPurposes: z.array(systemDesignPackPurposeSchema).min(1),
    selectionTags: z.array(systemDesignPackIdSchema).min(1),
    layoutIds: z.array(systemDesignPackLayoutIdSchema).min(1),
    backgroundRhythm: z.enum([
      "light-dominant",
      "dark-dominant",
      "mixed"
    ]),
    mediaPolicy: z.array(systemDesignPackMediaPolicySchema).min(1),
    previewManifestId: systemDesignPackIdSchema,
    provenance: z
      .object({
        source: z.enum(["orbit-native", "curated-reference"]),
        sourceId: z.string().trim().min(1).optional(),
        licenseStatus: z.enum(["approved", "pending", "rejected"])
      })
      .strict()
  })
  .strict()
  .superRefine((pack, context) => {
    if (pack.status === "active" && pack.provenance.licenseStatus !== "approved") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenance", "licenseStatus"],
        message: "active packs require approved provenance"
      });
    }
  });

export const systemDesignPackRegistrySchema = z
  .object({
    catalogVersion: z.number().int().positive(),
    packs: z.array(systemDesignPackManifestSchema).min(1),
    layouts: z.array(systemDesignPackLayoutSchema).min(1)
  })
  .strict()
  .superRefine((registry, context) => {
    reportDuplicates(registry.layouts.map((layout) => layout.layoutId), ["layouts"], context);
    reportDuplicates(
      registry.packs.map((pack) => `${pack.id}@${pack.version}`),
      ["packs"],
      context
    );
    const layoutIds = new Set(registry.layouts.map((layout) => layout.layoutId));
    registry.packs.forEach((pack, packIndex) => {
      pack.layoutIds.forEach((layoutId, layoutIndex) => {
        if (!layoutIds.has(layoutId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["packs", packIndex, "layoutIds", layoutIndex],
            message: `unknown layoutId: ${layoutId}`
          });
        }
      });
    });
  });

function reportDuplicates(
  values: string[],
  path: Array<string | number>,
  context: z.RefinementCtx
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: `duplicate catalog entry: ${value}`
      });
    }
    seen.add(value);
  });
}

export type SystemDesignPackLayout = z.infer<typeof systemDesignPackLayoutSchema>;
export type SystemDesignPackManifest = z.infer<typeof systemDesignPackManifestSchema>;
export type SystemDesignPackRegistry = z.infer<typeof systemDesignPackRegistrySchema>;
