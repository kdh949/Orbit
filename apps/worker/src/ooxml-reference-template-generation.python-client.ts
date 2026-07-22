import {
  ooxmlReferenceTemplateGenerationRequestSchema,
  ooxmlReferenceTemplateGenerationStageSchema,
  type OoxmlReferenceTemplateGenerationRequest,
  type OoxmlReferenceTemplateGenerationStage,
} from "@orbit/shared";
import { z } from "zod";

const pythonStageTimeoutMs = 120_000;

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

const dependencyArtifactSchema = z
  .object({
    stage: ooxmlReferenceTemplateGenerationStageSchema.exclude([
      "publication",
    ]),
    payload: jsonObjectSchema,
  })
  .strict();

const stageRequestSchema = z
  .object({
    jobId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    stage: ooxmlReferenceTemplateGenerationStageSchema.exclude([
      "publication",
    ]),
    templateId: z.string().trim().min(1).max(200),
    templateVersion: z.number().int().positive(),
    request: ooxmlReferenceTemplateGenerationRequestSchema,
    dependencies: z.array(dependencyArtifactSchema).max(7),
  })
  .strict();

const stageResponseSchema = z
  .object({
    stage: ooxmlReferenceTemplateGenerationStageSchema.exclude([
      "publication",
    ]),
    templateId: z.string().trim().min(1).max(200),
    templateVersion: z.number().int().positive(),
    sourceSlideCount: z.number().int().nonnegative().max(500),
    slotCount: z.number().int().nonnegative().max(10_000),
    artifact: jsonObjectSchema,
    issueCodes: z
      .array(z.string().regex(/^OOXML_REFERENCE_[A-Z0-9_]+$/))
      .max(500),
  })
  .strict()
  .refine(
    (response) =>
      Buffer.byteLength(JSON.stringify(response.artifact), "utf8") <= 1_048_576,
    { message: "Python stage artifact exceeds 1 MiB." },
  );

export type OoxmlReferencePythonStageArtifact = {
  stage: Exclude<OoxmlReferenceTemplateGenerationStage, "publication">;
  payload: Record<string, JsonValue>;
};

export type RunOoxmlReferencePythonStageInput = {
  pythonWorkerUrl: string;
  jobId: string;
  projectId: string;
  stage: Exclude<OoxmlReferenceTemplateGenerationStage, "publication">;
  templateId: string;
  templateVersion: number;
  request: OoxmlReferenceTemplateGenerationRequest;
  dependencies: OoxmlReferencePythonStageArtifact[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type OoxmlReferencePythonStageResponse = z.infer<
  typeof stageResponseSchema
>;

export type OoxmlReferencePythonClientErrorCode =
  | "OOXML_REFERENCE_PYTHON_UNAVAILABLE"
  | "OOXML_REFERENCE_PYTHON_FAILED"
  | "OOXML_REFERENCE_PYTHON_INVALID_RESPONSE";

export class OoxmlReferencePythonClientError extends Error {
  override readonly name = "OoxmlReferencePythonClientError";

  constructor(
    readonly code: OoxmlReferencePythonClientErrorCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export async function runOoxmlReferencePythonStage(
  rawInput: RunOoxmlReferencePythonStageInput,
): Promise<OoxmlReferencePythonStageResponse> {
  const input = stageRequestSchema.parse({
    jobId: rawInput.jobId,
    projectId: rawInput.projectId,
    stage: rawInput.stage,
    templateId: rawInput.templateId,
    templateVersion: rawInput.templateVersion,
    request: rawInput.request,
    dependencies: rawInput.dependencies,
  });
  let response: Response;
  try {
    response = await (rawInput.fetchImpl ?? fetch)(
      new URL(
        "/internal/ai/ooxml-reference-template-generation/stage",
        rawInput.pythonWorkerUrl.endsWith("/")
          ? rawInput.pythonWorkerUrl
          : `${rawInput.pythonWorkerUrl}/`,
      ).toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: rawInput.signal
          ? AbortSignal.any([
              rawInput.signal,
              AbortSignal.timeout(pythonStageTimeoutMs),
            ])
          : AbortSignal.timeout(pythonStageTimeoutMs),
      },
    );
  } catch {
    throw new OoxmlReferencePythonClientError(
      "OOXML_REFERENCE_PYTHON_UNAVAILABLE",
      true,
      "OOXML reference template Python stage is unavailable.",
    );
  }

  if (!response.ok) {
    await discardBody(response);
    throw new OoxmlReferencePythonClientError(
      "OOXML_REFERENCE_PYTHON_FAILED",
      response.status === 429 || response.status >= 500,
      `OOXML reference template Python stage failed with status ${response.status}.`,
    );
  }

  let parsed: OoxmlReferencePythonStageResponse;
  try {
    parsed = stageResponseSchema.parse(await response.json());
    assertNoPrivateLocator(parsed.artifact);
  } catch {
    throw new OoxmlReferencePythonClientError(
      "OOXML_REFERENCE_PYTHON_INVALID_RESPONSE",
      false,
      "OOXML reference template Python stage returned an invalid response.",
    );
  }
  if (
    parsed.stage !== input.stage ||
    parsed.templateId !== input.templateId ||
    parsed.templateVersion !== input.templateVersion
  ) {
    throw new OoxmlReferencePythonClientError(
      "OOXML_REFERENCE_PYTHON_INVALID_RESPONSE",
      false,
      "OOXML reference template Python stage identity did not match the request.",
    );
  }
  return parsed;
}

function assertNoPrivateLocator(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (/^data:[^,]*;base64,/i.test(value) || /^UEsDB[A-Za-z0-9+/=]{4,}$/.test(value)) {
      throw new Error("private payload");
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new Error("private payload");
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoPrivateLocator(item, seen);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:storageKey|signedUrl|rawPackageBytes|rawPackageXml|packageBase64)$/i.test(key)) {
      throw new Error("private payload");
    }
    assertNoPrivateLocator(item, seen);
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Provider details are intentionally discarded.
  }
}
