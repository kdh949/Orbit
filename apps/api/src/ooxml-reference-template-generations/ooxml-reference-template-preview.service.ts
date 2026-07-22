import {
  ooxmlReferenceTemplateGenerationJobResultSchema,
  ooxmlReferenceTemplatePreviewResponseSchema,
  type OoxmlReferenceTemplatePreviewResponse,
} from "@orbit/shared";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { z } from "zod";

const jobRowSchema = z.object({
  job_id: z.string().min(1),
  project_id: z.string().min(1),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  progress: z.number().int().min(0).max(100),
  result: z.unknown().nullable(),
  error: z
    .object({
      code: z.string().min(1),
      retryable: z.boolean().optional(),
    })
    .passthrough()
    .nullable(),
  updated_at: z.union([z.date(), z.string().min(1)]),
});

const artifactRowSchema = z.object({
  stage: z.enum(["content-planning", "slide-render"]),
  shard_key: z.string(),
  payload_json: z.unknown(),
});

const outlinePayloadSchema = z
  .object({
    data: z
      .object({
        outline: z
          .array(
            z
              .object({
                order: z.number().int().positive().max(500),
                title: z.string().trim().min(1).max(500),
              })
              .strict(),
          )
          .max(500),
      })
      .passthrough(),
  })
  .passthrough();

const slideRenderPayloadSchema = z
  .object({
    slideId: z.string().min(1).max(200),
    order: z.number().int().positive().max(500),
    renderAssetFileId: z.string().min(1).max(200),
  })
  .strict();

@Injectable()
export class OoxmlReferenceTemplatePreviewService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getPreview(
    projectId: string,
    generationId: string,
  ): Promise<OoxmlReferenceTemplatePreviewResponse> {
    const job = await this.loadJob(projectId, generationId);
    const artifacts = await this.loadArtifacts(projectId, generationId);
    const outline = outlineFrom(artifacts);
    const completedSlides = completedPrefix(artifacts, outline.length);
    const pendingSlideOrders = Array.from(
      { length: outline.length - completedSlides.length },
      (_, index) => completedSlides.length + index + 1,
    );
    const result = job.status === "succeeded"
      ? ooxmlReferenceTemplateGenerationJobResultSchema.safeParse(job.result)
      : null;
    const canonicalDeckId = result?.success
      ? await this.loadCanonicalDeckId(projectId, result.data.deckId)
      : null;
    const publicationMismatch =
      job.status === "succeeded" &&
      (!result?.success || canonicalDeckId !== result.data.deckId);
    const failed = job.status === "failed" || publicationMismatch;

    return ooxmlReferenceTemplatePreviewResponseSchema.parse({
      jobId: job.job_id,
      projectId: job.project_id,
      status: failed
        ? "failed"
        : job.status === "succeeded"
          ? "succeeded"
          : previewPhase(job.progress),
      progress: publicationMismatch ? 99 : job.progress,
      editable: false,
      outline,
      completedSlides,
      pendingSlideOrders,
      deckId:
        job.status === "succeeded" && !publicationMismatch
          ? canonicalDeckId
          : null,
      updatedAt: toIso(job.updated_at),
      error: failed
        ? {
            code: publicationMismatch
              ? "OOXML_REFERENCE_PUBLICATION_IDENTITY_MISMATCH"
              : boundedIssueCode(job.error?.code),
            retryable: publicationMismatch
              ? false
              : job.error?.retryable === true,
          }
        : null,
    });
  }

  private async loadJob(projectId: string, generationId: string) {
    const rows = rowsFrom(
      await this.dataSource.query(
        `
          SELECT job_id, project_id, status, progress, result, error, updated_at
          FROM jobs
          WHERE job_id = $1 AND project_id = $2
            AND type = 'ooxml-reference-template-generation'
          LIMIT 1
        `,
        [generationId, projectId],
      ),
    );
    const parsed = jobRowSchema.safeParse(rows[0]);
    if (!parsed.success) {
      throw new NotFoundException("OOXML reference template generation not found.");
    }
    return parsed.data;
  }

  private async loadArtifacts(projectId: string, generationId: string) {
    return z.array(artifactRowSchema).parse(
      rowsFrom(
        await this.dataSource.query(
          `
            SELECT stage, shard_key, payload_json
            FROM ooxml_reference_template_generation_artifacts
            WHERE job_id = $1 AND project_id = $2
              AND stage IN ('content-planning', 'slide-render')
            ORDER BY stage, shard_key
          `,
          [generationId, projectId],
        ),
      ),
    );
  }

  private async loadCanonicalDeckId(
    projectId: string,
    expectedDeckId: string,
  ): Promise<string | null> {
    const rows = rowsFrom(
      await this.dataSource.query(
        `
          SELECT deck_id FROM decks
          WHERE project_id = $1 AND deck_id = $2
          LIMIT 1
        `,
        [projectId, expectedDeckId],
      ),
    );
    const parsed = z.object({ deck_id: z.string().min(1) }).safeParse(rows[0]);
    return parsed.success ? parsed.data.deck_id : null;
  }
}

function outlineFrom(
  artifacts: z.infer<typeof artifactRowSchema>[],
): Array<{ order: number; title: string }> {
  const artifact = artifacts.find((item) => item.stage === "content-planning");
  if (!artifact) return [];
  const parsed = outlinePayloadSchema.safeParse(artifact.payload_json);
  return parsed.success ? parsed.data.data.outline : [];
}

function completedPrefix(
  artifacts: z.infer<typeof artifactRowSchema>[],
  outlineLength: number,
): Array<{ slideId: string; order: number; renderAssetFileId: string }> {
  const byOrder = new Map<number, z.infer<typeof slideRenderPayloadSchema>>();
  for (const artifact of artifacts) {
    if (artifact.stage !== "slide-render") continue;
    const parsed = slideRenderPayloadSchema.safeParse(artifact.payload_json);
    if (
      parsed.success &&
      artifact.shard_key === String(parsed.data.order).padStart(3, "0") &&
      parsed.data.order <= outlineLength
    ) {
      byOrder.set(parsed.data.order, parsed.data);
    }
  }
  const prefix = [];
  for (let order = 1; order <= outlineLength; order += 1) {
    const slide = byOrder.get(order);
    if (!slide) break;
    prefix.push(slide);
  }
  return prefix;
}

function previewPhase(progress: number): "planning" | "rendering" | "materializing" {
  if (progress < 60) return "planning";
  if (progress < 88) return "rendering";
  return "materializing";
}

function boundedIssueCode(code: string | undefined): string {
  return code && /^OOXML_REFERENCE_[A-Z0-9_]+$/.test(code)
    ? code
    : "OOXML_REFERENCE_GENERATION_FAILED";
}

function rowsFrom(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return Array.isArray(value[0]) ? value[0] : value;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Job timestamp.");
  return date.toISOString();
}
