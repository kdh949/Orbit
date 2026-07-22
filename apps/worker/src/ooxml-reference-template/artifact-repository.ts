import {
  ooxmlReferenceTemplateGenerationJobResultSchema,
  ooxmlTemplateFidelityReportSchema,
} from "@orbit/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";

interface QueryExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

const generationArtifactStageSchema = z.enum([
  "reference-extract-file",
  "source-grounding",
  "content-planning",
  "template-planning",
  "package-generation",
  "slide-render",
  "render-validation",
  "materialization",
  "publication",
]);

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
type JsonValue =
  | z.infer<typeof jsonPrimitiveSchema>
  | JsonValue[]
  | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

const slideRenderPayloadSchema = z
  .object({
    slideId: z.string().trim().min(1).max(200),
    order: z.number().int().min(1).max(500),
    renderAssetFileId: z.string().trim().min(1).max(200),
  })
  .strict();
const generatedAssetRefSchema = z
  .object({
    fileId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    originalName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !/[\\/]/.test(value)),
    size: z.number().int().nonnegative(),
  })
  .strict();
const renderValidationPayloadSchema = z
  .object({
    data: z
      .object({
        fidelityReport: ooxmlTemplateFidelityReportSchema,
        renderAssets: z.array(generatedAssetRefSchema).max(500),
      })
      .strict(),
    metrics: z
      .object({
        sourceSlideCount: z.number().int().nonnegative().max(500),
        slotCount: z.number().int().nonnegative().max(10_000),
      })
      .strict(),
    issueCodes: z
      .array(z.string().regex(/^OOXML_REFERENCE_[A-Z0-9_]+$/))
      .max(500),
  })
  .strict();

const timestampSchema = z
  .union([z.date(), z.string().min(1)])
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid artifact timestamp",
  });

const artifactRowSchema = z.object({
  artifact_id: z.string().uuid(),
  job_id: z.string().trim().min(1).max(200),
  project_id: z.string().trim().min(1).max(200),
  stage: generationArtifactStageSchema,
  shard_key: z.string(),
  payload_json: z.unknown(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type OoxmlReferenceTemplateArtifactStage = z.infer<
  typeof generationArtifactStageSchema
>;

export interface OoxmlReferenceTemplateArtifactIdentity {
  jobId: string;
  projectId: string;
  stage: OoxmlReferenceTemplateArtifactStage;
  shardKey: string;
}

export interface OoxmlReferenceTemplateArtifact extends OoxmlReferenceTemplateArtifactIdentity {
  artifactId: string;
  payload: Record<string, JsonValue>;
}

const identitySchema = z
  .object({
    jobId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    stage: generationArtifactStageSchema,
    shardKey: z.string().max(3),
  })
  .strict()
  .superRefine((identity, ctx) => {
    if (identity.stage === "slide-render") {
      if (!/^\d{3}$/.test(identity.shardKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["shardKey"],
          message: "slide-render requires a zero-padded shard",
        });
        return;
      }
      const order = Number(identity.shardKey);
      if (order < 1 || order > 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["shardKey"],
          message: "slide-render shard order must be between 001 and 500",
        });
      }
    } else if (identity.shardKey !== "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shardKey"],
        message: "singleton generation artifacts require an empty shard",
      });
    }
  });

export class OoxmlReferenceTemplateArtifactRepository {
  constructor(private readonly db: QueryExecutor) {}

  async storeSucceeded(
    rawIdentity: unknown,
    rawPayload: unknown,
  ): Promise<OoxmlReferenceTemplateArtifact> {
    const identity = identitySchema.parse(rawIdentity);
    const payload = parsePayload(identity, rawPayload);
    const rows = await this.db.query(
      `
        INSERT INTO ooxml_reference_template_generation_artifacts (
          artifact_id, job_id, project_id, stage, shard_key, payload_json
        )
        SELECT $1, jobs.job_id, jobs.project_id, $4, $5, $6::jsonb
        FROM jobs
        WHERE jobs.job_id = $2
          AND jobs.project_id = $3
          AND jobs.type = 'ooxml-reference-template-generation'
          AND jobs.status IN ('queued','running')
        ON CONFLICT (job_id, stage, shard_key) DO NOTHING
        RETURNING *
      `,
      [
        randomUUID(),
        identity.jobId,
        identity.projectId,
        identity.stage,
        identity.shardKey,
        payload,
      ],
    );
    const inserted = firstQueryRow(rows);
    const artifact = inserted
      ? artifactFromRow(inserted)
      : await this.findSucceeded(identity);
    if (!artifact) {
      throw new Error(
        "OOXML reference template artifact not found or Job identity is invalid.",
      );
    }
    assertIdentity(artifact, identity);
    if (canonicalJson(artifact.payload) !== canonicalJson(payload)) {
      throw new Error(
        "OOXML reference template artifact immutable replay conflict.",
      );
    }
    return artifact;
  }

  async findSucceeded(
    rawIdentity: unknown,
  ): Promise<OoxmlReferenceTemplateArtifact | undefined> {
    const identity = identitySchema.parse(rawIdentity);
    const rows = await this.db.query(
      `
        SELECT artifacts.*
        FROM ooxml_reference_template_generation_artifacts artifacts
        JOIN jobs
          ON jobs.job_id = artifacts.job_id
         AND jobs.project_id = artifacts.project_id
        WHERE artifacts.job_id = $1
          AND artifacts.project_id = $2
          AND artifacts.stage = $3
          AND artifacts.shard_key = $4
          AND jobs.type = 'ooxml-reference-template-generation'
          AND jobs.status IN ('queued','running','succeeded')
        LIMIT 1
      `,
      [identity.jobId, identity.projectId, identity.stage, identity.shardKey],
    );
    const row = firstQueryRow(rows);
    if (!row) return undefined;
    const artifact = artifactFromRow(row);
    assertIdentity(artifact, identity);
    return artifact;
  }
}

export function slideRenderShardKey(order: number): string {
  if (!Number.isInteger(order) || order < 1 || order > 500) {
    throw new Error("slide-render order must be an integer between 1 and 500.");
  }
  return String(order).padStart(3, "0");
}

function parsePayload(
  identity: OoxmlReferenceTemplateArtifactIdentity,
  rawPayload: unknown,
): Record<string, JsonValue> {
  assertNoPrivateBinaryLocator(rawPayload);
  let payload: Record<string, JsonValue>;
  if (identity.stage === "slide-render") {
    const parsed = slideRenderPayloadSchema.parse(rawPayload);
    if (parsed.order !== Number(identity.shardKey)) {
      throw new Error("slide-render artifact order must match its shard.");
    }
    payload = parsed;
  } else if (identity.stage === "render-validation") {
    payload = renderValidationPayloadSchema.parse(rawPayload);
  } else if (identity.stage === "publication") {
    payload = ooxmlReferenceTemplateGenerationJobResultSchema.parse(rawPayload);
  } else {
    payload = jsonObjectSchema.parse(rawPayload);
  }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 1_048_576) {
    throw new Error("OOXML reference template artifact payload exceeds 1 MiB.");
  }
  return payload;
}

function artifactFromRow(raw: unknown): OoxmlReferenceTemplateArtifact {
  const row = artifactRowSchema.parse(raw);
  const identity = identitySchema.parse({
    jobId: row.job_id,
    projectId: row.project_id,
    stage: row.stage,
    shardKey: row.shard_key,
  });
  return {
    artifactId: row.artifact_id,
    ...identity,
    payload: parsePayload(identity, row.payload_json),
  };
}

function assertIdentity(
  artifact: OoxmlReferenceTemplateArtifact,
  identity: OoxmlReferenceTemplateArtifactIdentity,
): void {
  if (
    artifact.jobId !== identity.jobId ||
    artifact.projectId !== identity.projectId ||
    artifact.stage !== identity.stage ||
    artifact.shardKey !== identity.shardKey
  ) {
    throw new Error("OOXML reference template artifact identity is invalid.");
  }
}

function assertNoPrivateBinaryLocator(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (typeof value === "string") {
    if (
      /^data:[^,]*;base64,/i.test(value) ||
      /^UEsDB[A-Za-z0-9+/=]{4,}$/.test(value)
    ) {
      throw new Error(
        "OOXML reference template artifact payload contains a private binary locator.",
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new Error(
      "OOXML reference template artifact payload contains a private binary locator.",
    );
  }
  if (seen.has(value)) {
    throw new Error("OOXML reference template artifact payload must be JSON.");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoPrivateBinaryLocator(item, seen));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const forbidden =
      normalized.includes("rawpackage") ||
      normalized.includes("base64") ||
      normalized.includes("storagekey") ||
      normalized.includes("objectkey") ||
      normalized.includes("signedurl") ||
      normalized.includes("presignedurl") ||
      normalized.includes("privatebinarylocator") ||
      normalized.includes("packagelocator") ||
      ((normalized.includes("package") ||
        normalized.includes("pptx") ||
        normalized.includes("binary")) &&
        normalized.includes("bytes"));
    if (forbidden) {
      throw new Error(
        "OOXML reference template artifact payload contains a private binary locator.",
      );
    }
    assertNoPrivateBinaryLocator(nested, seen);
  }
}

function canonicalJson(value: JsonValue | Record<string, JsonValue>): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}
