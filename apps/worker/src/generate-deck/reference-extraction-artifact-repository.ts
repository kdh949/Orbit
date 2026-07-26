import {
  referenceExtractionResultSchema,
  type ReferenceExtractionFile,
} from "@orbit/shared/deck";
import {
  aiDeckGenerationStageMessageSchema,
  aiDeckReferenceExtractionResultReferenceSchema,
  type AiDeckReferenceExtractionResultReference,
} from "@orbit/shared/jobs";
import { randomUUID } from "node:crypto";
import { z } from "zod";

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
  file_id: z.string().min(1),
  stage: z.literal("reference-extract-file"),
  extraction_json: z.unknown(),
  usable: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export class AiDeckReferenceExtractionArtifactRepository {
  constructor(private readonly db: QueryExecutor) {}

  async upsert(
    rawMessage: unknown,
    rawExtraction: unknown,
  ): Promise<AiDeckReferenceExtractionResultReference> {
    const message = aiDeckGenerationStageMessageSchema.parse(rawMessage);
    if (message.stage !== "reference-extract-file") {
      throw new Error(
        "Reference extraction artifacts require a reference-extract-file stage.",
      );
    }

    const extraction = parseExtraction(rawExtraction);
    assertExtractionIdentity(message.projectId, message.shardKey, extraction);

    const rows = await this.db.query(
      `
        INSERT INTO ai_deck_reference_extraction_artifacts (
          artifact_id,
          pipeline_job_id,
          project_id,
          file_id,
          stage,
          extraction_json,
          usable
        )
        VALUES ($1, $2, $3, $4, 'reference-extract-file', $5::jsonb, $6)
        ON CONFLICT (pipeline_job_id, file_id) DO UPDATE
        SET extraction_json = EXCLUDED.extraction_json,
            usable = EXCLUDED.usable,
            updated_at = now()
        RETURNING *
      `,
      [
        randomUUID(),
        message.pipelineJobId,
        message.projectId,
        message.shardKey,
        extraction,
        extraction.usable,
      ],
    );

    const row = artifactRowSchema.parse(firstQueryRow(rows));
    const storedExtraction = parseExtraction(row.extraction_json);
    assertExtractionIdentity(row.project_id, row.file_id, storedExtraction);
    if (
      row.pipeline_job_id !== message.pipelineJobId ||
      row.project_id !== message.projectId ||
      row.file_id !== message.shardKey ||
      row.usable !== storedExtraction.usable
    ) {
      throw new Error("Stored reference extraction artifact identity is invalid.");
    }

    return aiDeckReferenceExtractionResultReferenceSchema.parse({
      referenceExtractionArtifactId: row.artifact_id,
    });
  }
}

function parseExtraction(rawExtraction: unknown): ReferenceExtractionFile {
  const result = referenceExtractionResultSchema.parse({
    files: [rawExtraction],
  });
  const extraction = result.files[0];
  if (!extraction) {
    throw new Error("Reference extraction artifact requires one file result.");
  }
  return extraction;
}

function assertExtractionIdentity(
  projectId: string,
  fileId: string,
  extraction: ReferenceExtractionFile,
): void {
  if (
    extraction.projectId !== projectId ||
    extraction.referenceDocumentId !== fileId ||
    extraction.fileId !== fileId
  ) {
    throw new Error("Reference extraction artifact identity does not match its stage.");
  }
}

function firstQueryRow(queryResult: unknown): unknown {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}
