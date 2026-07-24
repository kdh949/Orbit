import {
  aiDeckGenerationStageSchema,
  aiDeckGenerationStageStatusSchema,
  aiDeckPreviewResponseSchema,
  deckShellSchema,
  deckSchema,
  effectiveGeneratedSlideCountRange,
  generateDeckResponseSchema,
  generateDeckStoredJobPayloadSchema,
  jobErrorSchema,
  slideSchema,
  type AiDeckPreviewResponse,
  type Deck,
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
  payload: z.unknown().optional(),
  error: jobErrorSchema.nullable(),
  updated_at: z.union([z.date(), z.string().min(1)]),
});
const planningRowSchema = z.object({
  stage: z.enum(["content-planning", "layout-compile"]),
  payload_json: z.unknown(),
});
const stageRowSchema = z.object({
  stage: aiDeckGenerationStageSchema,
  status: aiDeckGenerationStageStatusSchema,
});
const contentPayloadSchema = z
  .object({
    contentPlan: z
      .object({
        slidePlans: z.array(
          z
            .object({
              order: z.number().int().positive(),
              title: z.string(),
              message: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();
const visualRequirementsSchema = z.object({
  items: z.array(
    z.object({
      slideId: z.string().min(1),
      visualPlan: z
        .object({ imageNeeded: z.boolean().optional() })
        .passthrough(),
    }),
  ),
});
const legacyLayoutPayloadSchema = z
  .object({
    workerPayload: generateDeckResponseSchema,
    visualRequirements: visualRequirementsSchema,
  })
  .passthrough();
const layoutManifestSlideSchema = z.object({
  sourceOrder: z.number().int().positive(),
  order: z.number().int().positive(),
  slideId: z.string().min(1),
  shardKey: z.string().min(1),
});
const layoutV2PayloadSchema = z
  .object({
    artifactVersion: z.literal(2),
    deckShell: deckShellSchema,
    slides: z.array(layoutManifestSlideSchema).min(1),
    warnings: z.array(z.string()),
  })
  .strict();
const imageRowSchema = z.object({
  shard_key: z.string().min(1),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  payload_json: z.unknown().nullable(),
});
const imagePayloadSchema = z
  .object({ slide: slideSchema, warnings: z.array(z.string()) })
  .strict();
const imageV2PayloadSchema = z
  .object({
    artifactVersion: z.literal(2),
    sourceOrder: z.number().int().positive(),
    order: z.number().int().positive(),
    slideId: z.string().min(1),
    slide: slideSchema,
    warnings: z.array(z.string()),
    validation: z.record(z.unknown()),
  })
  .strict();
const qualityRowSchema = z.object({ payload_json: z.unknown() });
const coverRowSchema = z.object({ payload_json: z.unknown() });
const coverPayloadSchema = z
  .object({
    deck: deckSchema,
    warnings: z.array(z.string()),
    validation: z.record(z.unknown()),
  })
  .strict();
const qualityPayloadSchema = z
  .object({ workerPayload: generateDeckResponseSchema })
  .strict();
const deckRowSchema = z.object({ deck_json: z.unknown() });

@Injectable()
export class AiDeckPreviewService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async get(projectId: string, jobId: string): Promise<AiDeckPreviewResponse> {
    const job = firstRow(
      await this.dataSource.query(
        `
          SELECT job_id, project_id, status, progress, payload, error, updated_at
          FROM jobs
          WHERE job_id = $1 AND project_id = $2
            AND type = 'ai-deck-generation'
        `,
        [jobId, projectId],
      ),
    );
    if (!job) throw new NotFoundException(`Job not found: ${jobId}`);
    const parsedJob = jobRowSchema.parse(job);

    const [
      planningRows,
      imageRows,
      qualityRows,
      deckRows,
      coverRows,
      stageRows,
    ] = await Promise.all([
      this.dataSource.query(
        `
          SELECT artifacts.stage, artifacts.payload_json
          FROM ai_deck_planning_artifacts artifacts
          JOIN ai_deck_generation_stages stages
            ON stages.pipeline_job_id = artifacts.pipeline_job_id
           AND stages.stage = artifacts.stage
           AND stages.shard_key = artifacts.shard_key
           AND stages.status = 'succeeded'
          WHERE artifacts.pipeline_job_id = $1
            AND artifacts.project_id = $2
            AND artifacts.stage IN ('content-planning', 'layout-compile')
        `,
        [jobId, projectId],
      ),
      this.dataSource.query(
        `
          SELECT stages.shard_key, stages.status, artifacts.payload_json
          FROM ai_deck_generation_stages stages
          LEFT JOIN ai_deck_execution_artifacts artifacts
            ON artifacts.pipeline_job_id = stages.pipeline_job_id
           AND artifacts.stage = stages.stage
           AND artifacts.shard_key = stages.shard_key
          WHERE stages.pipeline_job_id = $1
            AND stages.stage = 'image-slide'
        `,
        [jobId],
      ),
      this.dataSource.query(
        `
          SELECT artifacts.payload_json
          FROM ai_deck_execution_artifacts artifacts
          JOIN ai_deck_generation_stages stages
            ON stages.pipeline_job_id = artifacts.pipeline_job_id
           AND stages.stage = artifacts.stage
           AND stages.shard_key = artifacts.shard_key
           AND stages.status = 'succeeded'
          WHERE artifacts.pipeline_job_id = $1
            AND artifacts.project_id = $2
            AND artifacts.stage IN ('semantic-quality', 'rendered-visual-quality')
          ORDER BY artifacts.updated_at DESC
          LIMIT 1
        `,
        [jobId, projectId],
      ),
      parsedJob.status === "succeeded"
        ? this.dataSource.query(
            `SELECT deck_json FROM decks WHERE project_id = $1 ORDER BY updated_at DESC LIMIT 1`,
            [projectId],
          )
        : Promise.resolve([]),
      this.dataSource.query(
        `
          SELECT artifacts.payload_json
          FROM ai_deck_execution_artifacts artifacts
          JOIN ai_deck_generation_stages stages
            ON stages.pipeline_job_id = artifacts.pipeline_job_id
           AND stages.stage = artifacts.stage
           AND stages.shard_key = artifacts.shard_key
           AND stages.status = 'succeeded'
          WHERE artifacts.pipeline_job_id = $1
            AND artifacts.project_id = $2
            AND artifacts.stage = 'cover-slide'
          LIMIT 1
        `,
        [jobId, projectId],
      ),
      this.dataSource.query(
        `
          SELECT stage, status
          FROM ai_deck_generation_stages
          WHERE pipeline_job_id = $1
        `,
        [jobId],
      ),
    ]);

    const storedPayload = generateDeckStoredJobPayloadSchema.parse(
      parsedJob.payload,
    );

    return projectAiDeckPreview({
      job: parsedJob,
      // The worker floors the generated count/range to a minimum (see
      // effectiveGeneratedSlideCountRange), so surface the same floored range or
      // the preview would promise fewer slides than the deck actually produces.
      expectedSlideCountRange: effectiveGeneratedSlideCountRange(
        storedPayload.request.slideCountRange,
      ),
      stageRows: rows(stageRows).map((row) => stageRowSchema.parse(row)),
      planningRows: rows(planningRows).map((row) =>
        planningRowSchema.parse(row),
      ),
      imageRows: rows(imageRows).map((row) => imageRowSchema.parse(row)),
      qualityRow: firstRow(qualityRows),
      deckRow: firstRow(deckRows),
      coverRow: firstRow(coverRows),
    });
  }
}

export function projectAiDeckPreview(input: {
  job: z.infer<typeof jobRowSchema>;
  expectedSlideCountRange?: { min: number; max: number };
  stageRows?: z.infer<typeof stageRowSchema>[];
  planningRows: z.infer<typeof planningRowSchema>[];
  imageRows: z.infer<typeof imageRowSchema>[];
  qualityRow: Record<string, unknown> | null;
  deckRow: Record<string, unknown> | null;
  coverRow?: Record<string, unknown> | null;
}): AiDeckPreviewResponse {
  const contentRow = input.planningRows.find(
    (row) => row.stage === "content-planning",
  );
  const layoutRow = input.planningRows.find(
    (row) => row.stage === "layout-compile",
  );
  const outline = contentRow
    ? contentPayloadSchema
        .parse(contentRow.payload_json)
        .contentPlan.slidePlans.map(({ order, title, message }) => ({
          order,
          title,
          message,
        }))
        .sort((left, right) => left.order - right.order)
    : [];

  let deck: Deck | null = null;
  let completedSlideIds: string[] = [];
  let pendingSlideIds: string[] = [];

  if (input.job.status === "succeeded" && input.deckRow) {
    deck = deckSchema.parse(deckRowSchema.parse(input.deckRow).deck_json);
    completedSlideIds = deck.slides.map((slide) => slide.slideId);
  } else if (input.qualityRow) {
    deck = qualityPayloadSchema.parse(
      qualityRowSchema.parse(input.qualityRow).payload_json,
    ).workerPayload.deck;
    completedSlideIds = deck.slides.map((slide) => slide.slideId);
  } else if (layoutRow) {
    const parsedV2Layout = layoutV2PayloadSchema.safeParse(
      layoutRow.payload_json,
    );
    if (parsedV2Layout.success) {
      const v2Layout = parsedV2Layout.data;
      const completedBySourceOrder = new Map(
        input.imageRows.flatMap((row) => {
          if (row.status !== "succeeded" || !row.payload_json) return [];
          const parsed = imageV2PayloadSchema.safeParse(row.payload_json);
          return parsed.success
            ? [[parsed.data.sourceOrder, parsed.data] as const]
            : [];
        }),
      );
      const coverSlide = input.coverRow
        ? coverPayloadSchema.parse(
            coverRowSchema.parse(input.coverRow).payload_json,
          ).deck.slides[0]
        : undefined;
      const prefix: z.infer<typeof slideSchema>[] = [];
      for (const descriptor of v2Layout.slides) {
        const completed = completedBySourceOrder.get(descriptor.sourceOrder);
        if (
          !completed &&
          descriptor.order === 1 &&
          coverSlide?.slideId === descriptor.slideId &&
          coverSlide.order === descriptor.order
        ) {
          prefix.push(coverSlide);
          continue;
        }
        if (
          !completed ||
          completed.slideId !== descriptor.slideId ||
          completed.order !== descriptor.order
        ) {
          break;
        }
        prefix.push(completed.slide);
      }
      if (prefix.length > 0) {
        deck = deckSchema.parse({ ...v2Layout.deckShell, slides: prefix });
        completedSlideIds = prefix.map((slide) => slide.slideId);
      }
      pendingSlideIds = v2Layout.slides
        .slice(prefix.length)
        .map((slide) => slide.slideId);
    } else {
      const legacyLayout = legacyLayoutPayloadSchema.parse(
        layoutRow.payload_json,
      );
      const imageSlides = new Map(
        input.imageRows.flatMap((row) => {
          if (row.status !== "succeeded" || !row.payload_json) return [];
          const parsed = imagePayloadSchema.safeParse(row.payload_json);
          return parsed.success
            ? [[parsed.data.slide.slideId, parsed.data.slide] as const]
            : [];
        }),
      );
      const imageNeeded = new Set(
        legacyLayout.visualRequirements.items
          .filter((item) => item.visualPlan.imageNeeded === true)
          .map((item) => item.slideId),
      );
      const legacyDeck = {
        ...legacyLayout.workerPayload.deck,
        slides: legacyLayout.workerPayload.deck.slides.map(
          (slide) => imageSlides.get(slide.slideId) ?? slide,
        ),
      };
      deck = legacyDeck;
      completedSlideIds = legacyDeck.slides
        .filter(
          (slide) =>
            !imageNeeded.has(slide.slideId) || imageSlides.has(slide.slideId),
        )
        .map((slide) => slide.slideId);
      pendingSlideIds = legacyDeck.slides
        .filter(
          (slide) =>
            imageNeeded.has(slide.slideId) && !imageSlides.has(slide.slideId),
        )
        .map((slide) => slide.slideId);
    }
  } else if (input.coverRow) {
    deck = coverPayloadSchema.parse(
      coverRowSchema.parse(input.coverRow).payload_json,
    ).deck;
    completedSlideIds = deck.slides.map((slide) => slide.slideId);
    pendingSlideIds = outline
      .slice(completedSlideIds.length)
      .map((item) => `slide_${item.order}`);
  }

  const cancelled =
    input.job.status === "failed" &&
    input.job.error?.code === "AI_DECK_GENERATION_CANCELLED";
  const activeStages = new Set<string>(
    (input.stageRows ?? [])
      .filter((row) => row.status === "queued" || row.status === "running")
      .map((row) => row.stage),
  );
  const hasQualityWork = [
    "semantic-quality",
    "rendered-visual-quality",
    "publication",
  ].some((stage) => activeStages.has(stage));
  const hasRenderingWork = activeStages.has("image-slide");
  const hasComposingWork = [
    "content-planning",
    "design-planning",
    "layout-compile",
  ].some((stage) => activeStages.has(stage));
  const hasGroundingWork = ["reference-extract-file", "source-grounding"].some(
    (stage) => activeStages.has(stage),
  );
  const status = cancelled
    ? "cancelled"
    : input.job.status === "failed"
      ? "failed"
      : input.job.status === "succeeded"
        ? "ready"
        : hasQualityWork || (layoutRow && pendingSlideIds.length === 0)
          ? "quality-check"
          : hasRenderingWork || (layoutRow && pendingSlideIds.length > 0)
            ? "rendering"
            : hasComposingWork || outline.length > 0
              ? "composing"
              : hasGroundingWork
                ? "grounding"
                : "planning";

  return aiDeckPreviewResponseSchema.parse({
    jobId: input.job.job_id,
    projectId: input.job.project_id,
    status,
    progress: input.job.progress,
    expectedSlideCountRange: input.expectedSlideCountRange ?? { min: 5, max: 8 },
    editable: false,
    outline,
    deck,
    completedSlideIds,
    pendingSlideIds,
    updatedAt: new Date(input.job.updated_at).toISOString(),
    error:
      status === "failed" || status === "cancelled"
        ? {
            code: input.job.error?.code ?? "AI_DECK_GENERATION_FAILED",
            message:
              status === "cancelled"
                ? "생성이 취소되었습니다."
                : "슬라이드를 생성하지 못했습니다.",
            retryable:
              status === "failed" && (input.job.error?.retryable ?? true),
          }
        : null,
  });
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function firstRow(value: unknown): Record<string, unknown> | null {
  return rows(value)[0] ?? null;
}
