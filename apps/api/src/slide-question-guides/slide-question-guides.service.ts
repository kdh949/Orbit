import { loadOrbitConfig } from "@orbit/config";
import { enqueueSlideQuestionGuideGenerationJob } from "@orbit/job-queue";
import {
  autoCreateSlideQuestionGuidesRequestSchema,
  autoCreateSlideQuestionGuidesResponseSchema,
  createSlideQuestionGuideRequestSchema,
  jobSchema,
  slideQuestionGuideJobResponseSchema,
  slideQuestionGuideListResponseSchema,
  slideQuestionGuideSchema,
  slideQuestionGuideTextHashInput,
  type Deck,
  type Slide,
} from "@orbit/shared";
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";
import { z } from "zod";

import { DecksService } from "../decks/decks.service";
import { JobsService } from "../jobs/jobs.service";
import { sha256Canonical } from "../practice-goals/evaluation-plan";

const promptVersion = "slide-question-guide-v2";
const listQuerySchema = z.object({
  deckId: z.string().trim().min(1).max(128),
  slideId: z.string().trim().min(1).max(128).optional(),
}).strict();

@Injectable()
export class SlideQuestionGuidesService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly decksService: DecksService,
    private readonly jobsService: JobsService,
    @InjectPinoLogger(SlideQuestionGuidesService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(projectId: string, actorUserId: string, body: unknown) {
    this.assertEnabled();
    const request = createSlideQuestionGuideRequestSchema.parse(body);
    const existing = await this.findByClientRequest(projectId, actorUserId, request.clientRequestId);
    if (existing) return existing;

    const { deck } = await this.decksService.getDeck(projectId);
    if (deck.deckId !== request.deckId || deck.version !== request.expectedDeckVersion) {
      throw new ConflictException({
        code: "SLIDE_QUESTION_DECK_VERSION_MISMATCH",
        message: "The expected deck version does not match the current deck version.",
        actualDeckVersion: deck.version,
      });
    }
    const slide = deck.slides.find((candidate) => candidate.slideId === request.slideId);
    if (!slide) throw new NotFoundException("Slide not found in the current deck.");

    const snapshot = await this.decksService.getOrCreateSnapshot(deck);
    return this.createForSlide({
      projectId,
      actorUserId,
      clientRequestId: request.clientRequestId,
      deck,
      slide,
      deckSnapshotId: snapshot.snapshotId,
    });
  }

  async autoCreate(projectId: string, actorUserId: string, body: unknown) {
    this.assertEnabled();
    const request = autoCreateSlideQuestionGuidesRequestSchema.parse(body);
    const { deck } = await this.decksService.getDeck(projectId);
    if (deck.deckId !== request.deckId || deck.version !== request.expectedDeckVersion) {
      throw new ConflictException({
        code: "SLIDE_QUESTION_DECK_VERSION_MISMATCH",
        message: "The expected deck version does not match the current deck version.",
        actualDeckVersion: deck.version,
      });
    }

    const snapshot = await this.decksService.getOrCreateSnapshot(deck);
    const slides: Array<Record<string, unknown>> = [];
    for (const slide of deck.slides) {
      try {
        const slideContentHash = sha256Canonical(slideQuestionGuideTextHashInput(slide));
        const reusable = await this.findReusableGuide(
          projectId,
          deck.deckId,
          slide.slideId,
          slideContentHash,
        );
        const accepted = reusable ?? await this.createForSlide({
          projectId,
          actorUserId,
          clientRequestId: `slide-guide-auto_${sha256Canonical({
            clientRequestId: request.clientRequestId,
            slideId: slide.slideId,
          })}`,
          deck,
          slide,
          deckSnapshotId: snapshot.snapshotId,
        });
        slides.push({ status: "accepted", slideId: slide.slideId, ...accepted });
      } catch (error) {
        slides.push({
          status: "failed",
          slideId: slide.slideId,
          errorCode: autoErrorCode(error),
        });
      }
    }

    const response = autoCreateSlideQuestionGuidesResponseSchema.parse({
      deckId: deck.deckId,
      deckVersion: deck.version,
      slides,
    });
    this.logger.info({
      event: "slide_question_guide.auto_batch.completed",
      projectId,
      deckId: deck.deckId,
      deckVersion: deck.version,
      slideCount: deck.slides.length,
      acceptedCount: response.slides.filter((slide) => slide.status === "accepted").length,
      failedCount: response.slides.filter((slide) => slide.status === "failed").length,
    }, "Slide question guide auto batch completed.");
    return response;
  }

  private async createForSlide(input: {
    projectId: string;
    actorUserId: string;
    clientRequestId: string;
    deck: Deck;
    slide: Slide;
    deckSnapshotId: string;
  }) {
    const existing = await this.findByClientRequest(
      input.projectId,
      input.actorUserId,
      input.clientRequestId,
    );
    if (existing) return existing;

    const guideId = `slide_guide_${randomUUID()}`;
    const now = new Date().toISOString();
    const textHashInput = slideQuestionGuideTextHashInput(input.slide);
    const slideContentHash = sha256Canonical(textHashInput);
    try {
      await this.dataSource.query(
        `INSERT INTO slide_question_guides (
          guide_id, project_id, deck_id, deck_version, slide_id, slide_content_hash, source_snapshot_json,
          client_request_id, status, generation_job_id, created_by, question_count,
          schema_version, prompt_version, model, error_code, created_at, updated_at, generated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',NULL,$9,3,2,$10,NULL,NULL,$11,$11,NULL)`,
        [
          guideId,
          input.projectId,
          input.deck.deckId,
          input.deck.version,
          input.slide.slideId,
          slideContentHash,
          {
            deckSnapshotId: input.deckSnapshotId,
            contentHashVersion: "slide-text-v1",
            slideId: input.slide.slideId,
            deckVersion: input.deck.version,
            contentHash: slideContentHash,
            title: input.slide.title,
            content: [...textHashInput.textSegments, textHashInput.speakerNotes]
              .filter(Boolean)
              .join("\n")
              .slice(0, 8_000),
          },
          input.clientRequestId,
          input.actorUserId,
          promptVersion,
          now,
        ],
      );
    } catch (error) {
      const raced = firstRow(await this.dataSource.query(
        `SELECT guide_id, generation_job_id FROM slide_question_guides
         WHERE project_id = $1 AND created_by = $2 AND client_request_id = $3`,
        [input.projectId, input.actorUserId, input.clientRequestId],
      ));
      if (!raced?.generation_job_id) throw error;
      const racedJob = await this.jobsService.get(String(raced.generation_job_id));
      if (!racedJob) throw error;
      return slideQuestionGuideJobResponseSchema.parse({ job: racedJob, guideId: raced.guide_id });
    }

    const job = await this.jobsService.create({
      projectId: input.projectId,
      type: "slide-question-guide-generation",
      payload: { guideId },
    });
    await this.dataSource.query(
      `UPDATE slide_question_guides SET generation_job_id = $2, updated_at = now()
       WHERE guide_id = $1 AND project_id = $3`,
      [guideId, job.jobId, input.projectId],
    );

    try {
      await enqueueSlideQuestionGuideGenerationJob({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: job.jobId,
        projectId: input.projectId,
        guideId,
      });
      this.logger.info({
        event: "slide_question_guide.enqueued",
        projectId: input.projectId,
        deckId: input.deck.deckId,
        deckVersion: input.deck.version,
        slideId: input.slide.slideId,
        guideId,
        jobId: job.jobId,
      }, "Slide question guide generation enqueued.");
    } catch {
      await this.jobsService.update(job.jobId, {
        status: "failed",
        progress: 0,
        message: "Slide question guide enqueue failed.",
        error: { code: "SLIDE_QUESTION_GUIDE_ENQUEUE_FAILED", message: "Slide question guide enqueue failed." },
      });
      await this.dataSource.query(
        `UPDATE slide_question_guides SET status = 'failed', error_code = $2, updated_at = now()
         WHERE guide_id = $1`,
        [guideId, "SLIDE_QUESTION_GUIDE_ENQUEUE_FAILED"],
      );
      throw new Error("SLIDE_QUESTION_GUIDE_ENQUEUE_FAILED");
    }

    return slideQuestionGuideJobResponseSchema.parse({ job: jobSchema.parse(job), guideId });
  }

  private async findByClientRequest(
    projectId: string,
    actorUserId: string,
    clientRequestId: string,
  ) {
    const existing = firstRow(await this.dataSource.query(
      `SELECT guide_id, generation_job_id FROM slide_question_guides
       WHERE project_id = $1 AND created_by = $2 AND client_request_id = $3`,
      [projectId, actorUserId, clientRequestId],
    ));
    if (!existing?.generation_job_id) return null;
    const job = await this.jobsService.get(String(existing.generation_job_id));
    return job
      ? slideQuestionGuideJobResponseSchema.parse({ job, guideId: existing.guide_id })
      : null;
  }

  private async findReusableGuide(
    projectId: string,
    deckId: string,
    slideId: string,
    slideContentHash: string,
  ) {
    const existing = firstRow(await this.dataSource.query(
      `SELECT guide_id, generation_job_id FROM slide_question_guides
       WHERE project_id = $1 AND deck_id = $2 AND slide_id = $3
         AND slide_content_hash = $4 AND prompt_version = $5
         AND status IN ('queued','running','succeeded')
         AND generation_job_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, deckId, slideId, slideContentHash, promptVersion],
    ));
    if (!existing?.generation_job_id) return null;
    const job = await this.jobsService.get(String(existing.generation_job_id));
    return job
      ? slideQuestionGuideJobResponseSchema.parse({ job, guideId: existing.guide_id })
      : null;
  }

  async get(projectId: string, guideId: string) {
    this.assertEnabled();
    const row = firstRow(await this.dataSource.query(
      `SELECT * FROM slide_question_guides WHERE project_id = $1 AND guide_id = $2`,
      [projectId, guideId],
    ));
    if (!row) throw new NotFoundException("Slide question guide not found.");
    if (row.status !== "succeeded") {
      throw new ConflictException({
        code: "SLIDE_QUESTION_GUIDE_NOT_READY",
        message: "Slide question guide is not ready.",
        status: row.status,
        jobId: row.generation_job_id,
      });
    }
    return { guide: await this.toGuide(row) };
  }

  async list(projectId: string, rawQuery: Record<string, string | undefined>) {
    this.assertEnabled();
    const query = listQuerySchema.parse(rawQuery);
    const rows = await this.dataSource.query(
      `SELECT * FROM slide_question_guides
       WHERE project_id = $1 AND deck_id = $2
         AND ($3::text IS NULL OR slide_id = $3)
         AND status = 'succeeded'
       ORDER BY created_at DESC LIMIT 50`,
      [projectId, query.deckId, query.slideId ?? null],
    );
    return slideQuestionGuideListResponseSchema.parse({
      guides: await Promise.all(rows.map((row: Record<string, any>) => this.toGuide(row))),
    });
  }

  private async toGuide(row: Record<string, any>) {
    const itemRows = await this.dataSource.query(
      `SELECT item_json FROM slide_question_guide_items
       WHERE project_id = $1 AND guide_id = $2 ORDER BY question_order`,
      [row.project_id, row.guide_id],
    );
    const guide = {
      schemaVersion: row.schema_version,
      guideId: row.guide_id,
      projectId: row.project_id,
      deckId: row.deck_id,
      deckVersion: row.deck_version,
      slideId: row.slide_id,
      slideContentHash: row.slide_content_hash,
      items: itemRows.map((item: Record<string, any>) => item.item_json),
      generatedAt: toIso(row.generated_at),
      promptVersion: row.prompt_version,
      model: row.model,
    };
    if (Number(row.schema_version) === 2) {
      return slideQuestionGuideSchema.parse({
        ...guide,
        schemaVersion: 2,
        research: {
          status: row.research_status,
          attempts: Number(row.research_attempts),
          officialSourceCount: Number(row.official_source_count),
          issueCodes: jsonArray(row.research_issue_codes),
          researchedAt: row.researched_at ? toIso(row.researched_at) : null,
        },
      });
    }
    return slideQuestionGuideSchema.parse({ ...guide, schemaVersion: 1 });
  }

  private assertEnabled() {
    if (!this.config.SLIDE_QUESTION_GUIDES_ENABLED) {
      throw new ForbiddenException("Slide question guides are not enabled.");
    }
  }
}

function firstRow(value: unknown): Record<string, any> | null {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return Array.isArray(first) ? (first[0] ?? null) : (first ?? null);
}

function toIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function autoErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z0-9_]{1,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return "SLIDE_QUESTION_GUIDE_AUTO_FAILED";
}
