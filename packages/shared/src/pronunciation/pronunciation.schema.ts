import { z } from "zod";

export const pronunciationAliasOriginSchema = z.enum([
  "static",
  "domain",
  "rule",
  "existing-keyword",
  "existing-semantic-cue",
  "llm",
  "user",
]);

export const pronunciationTermCategorySchema = z.enum([
  "acronym",
  "word",
  "product",
  "numeric-symbol",
  "mixed",
]);

export const pronunciationAliasCandidateSchema = z
  .object({
    text: z.string().trim().min(1),
    normalizedText: z.string().min(1),
    origin: pronunciationAliasOriginSchema,
    confidence: z.number().min(0).max(1),
    enabled: z.boolean(),
  })
  .strict();

export const pronunciationScriptOccurrenceSchema = z
  .object({
    slideId: z.string().trim().min(1),
    sentenceId: z.string().trim().min(1).optional(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((occurrence) => occurrence.end > occurrence.start, {
    message: "pronunciation occurrence end must be greater than start.",
    path: ["end"],
  });

export const pronunciationLexiconEntrySchema = z
  .object({
    id: z.string().trim().min(1),
    sourceText: z.string().trim().min(1),
    normalizedSource: z.string().trim().min(1),
    canonicalText: z.string().trim().min(1),
    canonicalKey: z.string().trim().min(1),
    category: pronunciationTermCategorySchema,
    aliases: z.array(pronunciationAliasCandidateSchema),
    confidence: z.number().min(0).max(1),
    status: z.enum(["active", "needs-review", "disabled"]),
    scriptOccurrences: z.array(pronunciationScriptOccurrenceSchema).min(1),
  })
  .strict();

export const pronunciationLexiconSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatorVersion: z.string().trim().min(1),
    deckId: z.string().trim().min(1),
    deckVersion: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{16}$/),
    entries: z.array(pronunciationLexiconEntrySchema),
  })
  .strict();

export const canonicalTermEvidenceSchema = z
  .object({
    entryId: z.string().trim().min(1),
    canonicalKey: z.string().trim().min(1),
    matchedText: z.string().min(1),
    originalStart: z.number().int().nonnegative(),
    originalEnd: z.number().int().positive(),
    segmentIndex: z.number().int().nonnegative().optional(),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().nonnegative().optional(),
    matchOrigin: z.union([pronunciationAliasOriginSchema, z.literal("source")]),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type PronunciationAliasOrigin = z.infer<
  typeof pronunciationAliasOriginSchema
>;
export type PronunciationTermCategory = z.infer<
  typeof pronunciationTermCategorySchema
>;
export type PronunciationAliasCandidate = z.infer<
  typeof pronunciationAliasCandidateSchema
>;
export type PronunciationScriptOccurrence = z.infer<
  typeof pronunciationScriptOccurrenceSchema
>;
export type PronunciationLexiconEntry = z.infer<
  typeof pronunciationLexiconEntrySchema
>;
export type PronunciationLexiconSnapshot = z.infer<
  typeof pronunciationLexiconSnapshotSchema
>;
export type CanonicalTermEvidence = z.infer<typeof canonicalTermEvidenceSchema>;
