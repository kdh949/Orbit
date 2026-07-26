import {
  aiDeckGenerationStageMessageSchema,
  aiDeckPlanningArtifactReferenceSchema,
  type AiDeckGenerationStageMessage,
  type AiDeckPlanningArtifactReference,
} from "@orbit/shared/jobs";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  aiDeckPlanningStageSchema,
  isAiDeckPlanningStage,
  parsePlanningArtifactPayload,
  type AiDeckPlanningArtifactPayload,
  type AiDeckPlanningStage,
} from "./planning-stage-contract";

interface QueryExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

const timestampSchema = z
  .union([z.date(), z.string().min(1)])
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid artifact timestamp",
  });

const artifactRowSchema = z.object({
  artifact_id: z.string().uuid(),
  pipeline_job_id: z.string().min(1),
  project_id: z.string().min(1),
  stage: aiDeckPlanningStageSchema,
  shard_key: z.literal(""),
  payload_json: z.unknown(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export interface AiDeckPlanningArtifact {
  artifactId: string;
  pipelineJobId: string;
  projectId: string;
  stage: AiDeckPlanningStage;
  payload: AiDeckPlanningArtifactPayload;
}

export class AiDeckPlanningArtifactRepository {
  constructor(private readonly db: QueryExecutor) {}

  async upsert(
    rawMessage: unknown,
    rawPayload: unknown,
  ): Promise<AiDeckPlanningArtifactReference> {
    const message = planningMessage(rawMessage);
    const payload = parsePlanningArtifactPayload(message.stage, rawPayload);
    const rows = await this.db.query(
      `
        INSERT INTO ai_deck_planning_artifacts (
          artifact_id,
          pipeline_job_id,
          project_id,
          stage,
          shard_key,
          payload_json
        )
        VALUES ($1, $2, $3, $4, '', $5::jsonb)
        ON CONFLICT (pipeline_job_id, stage) DO UPDATE
        SET payload_json = EXCLUDED.payload_json,
            updated_at = now()
        RETURNING *
      `,
      [
        randomUUID(),
        message.pipelineJobId,
        message.projectId,
        message.stage,
        payload,
      ],
    );
    const artifact = artifactFromQuery(rows);
    assertArtifactIdentity(artifact, message);
    return aiDeckPlanningArtifactReferenceSchema.parse({
      planningArtifactId: artifact.artifactId,
    });
  }

  async get(
    rawMessage: unknown,
    rawReference: unknown,
    expectedStage: AiDeckPlanningStage,
  ): Promise<AiDeckPlanningArtifact> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const reference = aiDeckPlanningArtifactReferenceSchema.parse(rawReference);
    const rows = await this.db.query(
      `
        SELECT artifacts.*
        FROM ai_deck_planning_artifacts artifacts
        JOIN jobs
          ON jobs.job_id = artifacts.pipeline_job_id
         AND jobs.project_id = artifacts.project_id
        WHERE artifacts.artifact_id = $1
          AND artifacts.pipeline_job_id = $2
          AND artifacts.project_id = $3
          AND artifacts.stage = $4
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
      `,
      [
        reference.planningArtifactId,
        message.pipelineJobId,
        message.projectId,
        expectedStage,
      ],
    );
    const artifact = artifactFromQuery(rows);
    if (
      artifact.artifactId !== reference.planningArtifactId ||
      artifact.pipelineJobId !== message.pipelineJobId ||
      artifact.projectId !== message.projectId ||
      artifact.stage !== expectedStage
    ) {
      throw new Error("Planning artifact identity is invalid.");
    }
    return artifact;
  }

  async getByStage(
    rawMessage: unknown,
    expectedStage: AiDeckPlanningStage,
  ): Promise<AiDeckPlanningArtifact> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const rows = await this.db.query(
      `
        SELECT artifacts.*
        FROM ai_deck_planning_artifacts artifacts
        JOIN jobs
          ON jobs.job_id = artifacts.pipeline_job_id
         AND jobs.project_id = artifacts.project_id
        WHERE artifacts.pipeline_job_id = $1
          AND artifacts.project_id = $2
          AND artifacts.stage = $3
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
      `,
      [message.pipelineJobId, message.projectId, expectedStage],
    );
    const artifact = artifactFromQuery(rows);
    if (
      artifact.pipelineJobId !== message.pipelineJobId ||
      artifact.projectId !== message.projectId ||
      artifact.stage !== expectedStage
    ) {
      throw new Error("Planning artifact identity is invalid.");
    }
    return artifact;
  }
}

function planningMessage(
  rawMessage: unknown,
): AiDeckGenerationStageMessage & { stage: AiDeckPlanningStage } {
  const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
  if (!isAiDeckPlanningStage(message.stage)) {
    throw new Error("Planning artifacts require a planning stage.");
  }
  return { ...message, stage: message.stage };
}

function artifactFromQuery(queryResult: unknown): AiDeckPlanningArtifact {
  const raw = firstQueryRow(queryResult);
  if (!raw) throw new Error("Planning artifact not found.");
  const row = artifactRowSchema.parse(raw);
  return {
    artifactId: row.artifact_id,
    pipelineJobId: row.pipeline_job_id,
    projectId: row.project_id,
    stage: row.stage,
    payload: parsePlanningArtifactPayload(row.stage, row.payload_json),
  };
}

function assertArtifactIdentity(
  artifact: AiDeckPlanningArtifact,
  message: AiDeckGenerationStageMessage,
): void {
  if (
    artifact.pipelineJobId !== message.pipelineJobId ||
    artifact.projectId !== message.projectId ||
    artifact.stage !== message.stage
  ) {
    throw new Error("Stored planning artifact identity is invalid.");
  }
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}
