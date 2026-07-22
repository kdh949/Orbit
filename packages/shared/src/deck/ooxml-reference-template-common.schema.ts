import { z } from "zod";

export const ooxmlReferenceSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);

export const ooxmlReferenceTemplateIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

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
