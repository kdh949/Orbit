import {
  aiDeckExecutionArtifactReferenceSchema,
  aiDeckGenerationStageMessageSchema,
  type AiDeckExecutionArtifactReference,
  type AiDeckGenerationStageMessage,
} from "@orbit/shared/jobs";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  aiDeckExecutionStageSchema,
  isAiDeckExecutionStage,
  parseExecutionArtifactPayload,
  type AiDeckExecutionArtifactPayload,
  type AiDeckExecutionStage,
} from "./execution-stage-contract";

interface QueryExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

const artifactRowSchema = z.object({
  artifact_id: z.string().uuid(),
  pipeline_job_id: z.string().min(1),
  project_id: z.string().min(1),
  stage: aiDeckExecutionStageSchema,
  shard_key: z.string(),
  payload_json: z.unknown(),
});

export interface AiDeckExecutionArtifact {
  artifactId: string;
  pipelineJobId: string;
  projectId: string;
  stage: AiDeckExecutionStage;
  shardKey: string;
  payload: AiDeckExecutionArtifactPayload;
}

export class AiDeckExecutionArtifactRepository {
  constructor(private readonly db: QueryExecutor) {}

  async upsert(
    rawMessage: unknown,
    rawPayload: unknown,
  ): Promise<AiDeckExecutionArtifactReference> {
    const message = executionMessage(rawMessage);
    const payload = parseExecutionArtifactPayload(message.stage, rawPayload);
    const rows = await this.db.query(
      `
        INSERT INTO ai_deck_execution_artifacts (
          artifact_id, pipeline_job_id, project_id, stage, shard_key, payload_json
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (pipeline_job_id, stage, shard_key) DO UPDATE
        SET payload_json = EXCLUDED.payload_json,
            updated_at = now()
        RETURNING *
      `,
      [
        randomUUID(),
        message.pipelineJobId,
        message.projectId,
        message.stage,
        message.shardKey,
        payload,
      ],
    );
    const artifact = artifactFromQuery(rows);
    assertIdentity(artifact, message);
    return aiDeckExecutionArtifactReferenceSchema.parse({
      executionArtifactId: artifact.artifactId,
    });
  }

  async get(
    rawMessage: unknown,
    rawReference: unknown,
    expectedStage: AiDeckExecutionStage,
    expectedShardKey = "",
  ): Promise<AiDeckExecutionArtifact> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const reference =
      aiDeckExecutionArtifactReferenceSchema.parse(rawReference);
    const rows = await this.db.query(
      `
        SELECT artifacts.*
        FROM ai_deck_execution_artifacts artifacts
        JOIN jobs
          ON jobs.job_id = artifacts.pipeline_job_id
         AND jobs.project_id = artifacts.project_id
        WHERE artifacts.artifact_id = $1
          AND artifacts.pipeline_job_id = $2
          AND artifacts.project_id = $3
          AND artifacts.stage = $4
          AND artifacts.shard_key = $5
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
      `,
      [
        reference.executionArtifactId,
        message.pipelineJobId,
        message.projectId,
        expectedStage,
        expectedShardKey,
      ],
    );
    const artifact = artifactFromQuery(rows);
    if (artifact.artifactId !== reference.executionArtifactId) {
      throw new Error("AI deck execution artifact identity is invalid.");
    }
    assertIdentity(artifact, {
      ...message,
      stage: expectedStage,
      shardKey: expectedShardKey,
    });
    return artifact;
  }

  async listImageSlides(
    rawMessage: unknown,
  ): Promise<AiDeckExecutionArtifact[]> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const rows = await this.db.query(
      `
        SELECT artifacts.*
        FROM ai_deck_execution_artifacts artifacts
        JOIN jobs
          ON jobs.job_id = artifacts.pipeline_job_id
         AND jobs.project_id = artifacts.project_id
        WHERE artifacts.pipeline_job_id = $1
          AND artifacts.project_id = $2
          AND artifacts.stage = 'image-slide'
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
        ORDER BY artifacts.shard_key
      `,
      [message.pipelineJobId, message.projectId],
    );
    return queryRows(rows).map(artifactFromRow);
  }

  async findByStage(
    rawMessage: unknown,
    expectedStage: AiDeckExecutionStage,
    expectedShardKey = "",
  ): Promise<AiDeckExecutionArtifact | undefined> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    const rows = await this.db.query(
      `
        SELECT artifacts.*
        FROM ai_deck_execution_artifacts artifacts
        JOIN jobs
          ON jobs.job_id = artifacts.pipeline_job_id
         AND jobs.project_id = artifacts.project_id
        WHERE artifacts.pipeline_job_id = $1
          AND artifacts.project_id = $2
          AND artifacts.stage = $3
          AND artifacts.shard_key = $4
          AND jobs.type = 'ai-deck-generation'
          AND jobs.status IN ('queued','running')
        LIMIT 1
      `,
      [
        message.pipelineJobId,
        message.projectId,
        expectedStage,
        expectedShardKey,
      ],
    );
    const row = queryRows(rows)[0];
    return row ? artifactFromRow(row) : undefined;
  }
}

function executionMessage(
  rawMessage: unknown,
): AiDeckGenerationStageMessage & { stage: AiDeckExecutionStage } {
  const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
  if (!isAiDeckExecutionStage(message.stage)) {
    throw new Error("Execution artifacts require a final pipeline stage.");
  }
  return { ...message, stage: message.stage };
}

function artifactFromQuery(queryResult: unknown): AiDeckExecutionArtifact {
  const raw = firstQueryRow(queryResult);
  if (!raw) throw new Error("AI deck execution artifact not found.");
  return artifactFromRow(raw);
}

function artifactFromRow(raw: unknown): AiDeckExecutionArtifact {
  const row = artifactRowSchema.parse(raw);
  return {
    artifactId: row.artifact_id,
    pipelineJobId: row.pipeline_job_id,
    projectId: row.project_id,
    stage: row.stage,
    shardKey: row.shard_key,
    payload: parseExecutionArtifactPayload(row.stage, row.payload_json),
  };
}

function assertIdentity(
  artifact: AiDeckExecutionArtifact,
  message: AiDeckGenerationStageMessage,
): void {
  if (
    artifact.pipelineJobId !== message.pipelineJobId ||
    artifact.projectId !== message.projectId ||
    artifact.stage !== message.stage ||
    artifact.shardKey !== message.shardKey
  ) {
    throw new Error("Stored AI deck execution artifact identity is invalid.");
  }
}

function firstQueryRow(queryResult: unknown): unknown | null {
  const rows = queryRows(queryResult);
  return rows[0] ?? null;
}

function queryRows(queryResult: unknown): unknown[] {
  if (!Array.isArray(queryResult)) return [];
  const first = queryResult[0];
  return Array.isArray(first) ? first : queryResult;
}
