import type { GenerateDeckRequest } from "@orbit/shared/deck";
import { z } from "zod";

import {
  contentPlanningArtifactPayloadSchema,
  designPlanningArtifactPayloadSchema,
  layoutCompileArtifactPayloadSchema,
  sourceGroundingArtifactPayloadSchema,
  type AiDeckPlanningArtifactPayload,
  type AiDeckPlanningStage,
  type ContentPlanningArtifactPayload,
  type DesignPlanningArtifactPayload,
  type SourceGroundingArtifactPayload,
} from "./planning-stage-contract";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const endpointByStage: Record<AiDeckPlanningStage, string> = {
  "source-grounding": "/internal/ai/deck-generation/source-grounding",
  "content-planning": "/internal/ai/deck-generation/content-planning",
  "design-planning": "/internal/ai/deck-generation/design-planning",
  "layout-compile": "/internal/ai/deck-generation/layout-compile",
};

const responseSchemaByStage = {
  "source-grounding": sourceGroundingArtifactPayloadSchema,
  "content-planning": contentPlanningArtifactPayloadSchema,
  "design-planning": designPlanningArtifactPayloadSchema,
  "layout-compile": layoutCompileArtifactPayloadSchema,
} as const;

const planningReasonCodeSchema = z.enum([
  "SOURCE_GROUNDING_REQUIRED",
  "CONTENT_LLM_PROVIDER_FAILURE",
  "CONTENT_LLM_EMPTY_RESPONSE",
  "CONTENT_LLM_INVALID_RESPONSE",
  "CONTENT_LLM_SLIDE_COUNT_REPAIR_FAILED",
  "ART_DIRECTOR_INVALID_RESPONSE",
  "ART_DIRECTOR_UNAVAILABLE",
  "DESIGN_COMPOSITION_UNSUPPORTED",
  "PLANNING_FAILURE_UNCLASSIFIED",
]);
const structuredErrorDetailSchema = z
  .object({
    reasonCode: planningReasonCodeSchema,
    provider: z
      .enum(["openai", "openverse", "official-web", "user-upload", "storage"])
      .optional(),
    providerHttpStatus: z.number().int().min(100).max(599).optional(),
    providerRequestId: z.string().min(1).max(256).optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const errorResponseSchema = z
  .object({ detail: z.union([z.string(), structuredErrorDetailSchema]) })
  .passthrough();

export type AiDeckPlanningStageDiagnostics = {
  reasonCode: string;
  httpStatus?: number;
  provider?: string;
  providerHttpStatus?: number;
  providerRequestId?: string;
  retryAfterMs?: number;
};

export interface AiDeckPlanningStagePythonClientOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}

export class AiDeckPlanningStageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly diagnostics: AiDeckPlanningStageDiagnostics,
  ) {
    super(message);
    this.name = "AiDeckPlanningStageError";
  }
}

export async function executeAiDeckPlanningStage(
  pythonWorkerUrl: string,
  stage: AiDeckPlanningStage,
  input: unknown,
  options: AiDeckPlanningStagePythonClientOptions = {},
): Promise<AiDeckPlanningArtifactPayload> {
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL(endpointByStage[stage], pythonWorkerUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: options.signal ?? AbortSignal.timeout(180_000),
      },
    );
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AiDeckPlanningStageError(
      "PYTHON_WORKER_UNAVAILABLE",
      "AI deck planning provider is temporarily unavailable.",
      true,
      {
        reasonCode: timeout
          ? "PYTHON_WORKER_TIMEOUT"
          : "PYTHON_WORKER_UNAVAILABLE",
      },
    );
  }

  const rawBody = await readJson(response);
  if (!response.ok) {
    throw normalizeHttpError(stage, response.status, rawBody);
  }
  const parsed = responseSchemaByStage[stage].safeParse(rawBody);
  if (!parsed.success) {
    throw new AiDeckPlanningStageError(
      "PYTHON_WORKER_STAGE_RESPONSE_INVALID",
      "AI deck planning returned an invalid stage response.",
      false,
      {
        reasonCode: "PLANNING_RESPONSE_CONTRACT_INVALID",
        httpStatus: response.status,
      },
    );
  }
  return parsed.data;
}

export function sourceGroundingStageInput(
  projectId: string,
  request: GenerateDeckRequest,
  savedDesignPreferences: Record<string, unknown> = {},
) {
  return {
    request: {
      projectId,
      ...request,
      designProgramContext: { savedDesignPreferences },
    },
  };
}

export function contentPlanningStageInput(
  grounding: SourceGroundingArtifactPayload,
  regenerationContext?: {
    instruction?: string;
    previousSlideTitles: string[];
  },
) {
  return {
    groundingResult: grounding,
    ...(regenerationContext ? { regenerationContext } : {}),
  };
}

export function designPlanningStageInput(
  content: ContentPlanningArtifactPayload,
  preserveApprovedContent = false,
) {
  return {
    rawInput: content.rawInput,
    contentPlan: content.contentPlan,
    preserveApprovedContent,
  };
}

export function layoutCompileStageInput(
  content: ContentPlanningArtifactPayload,
  design: DesignPlanningArtifactPayload,
  sourceWarnings: string[],
) {
  return {
    rawInput: content.rawInput,
    contentPlan: content.contentPlan,
    designPlan: design.designPlan,
    sourceWarnings,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeHttpError(
  stage: AiDeckPlanningStage,
  status: number,
  body: unknown,
): AiDeckPlanningStageError {
  const detail = errorResponseSchema.safeParse(body).data?.detail ?? "";
  const structured =
    typeof detail === "string"
      ? undefined
      : structuredErrorDetailSchema.parse(detail);
  const reasonCode =
    structured?.reasonCode ?? classifyLegacyDetail(stage, detail as string);
  const diagnostics = {
    reasonCode,
    httpStatus: status,
    provider: structured?.provider,
    providerHttpStatus: structured?.providerHttpStatus,
    providerRequestId: structured?.providerRequestId,
    retryAfterMs: structured?.retryAfterMs,
  };
  if (reasonCode === "SOURCE_GROUNDING_REQUIRED") {
    return new AiDeckPlanningStageError(
      "SOURCE_GROUNDING_REQUIRED",
      "The selected reference policy requires usable grounding.",
      false,
      diagnostics,
    );
  }
  if (reasonCode === "ART_DIRECTOR_INVALID_RESPONSE") {
    return new AiDeckPlanningStageError(
      "ART_DIRECTOR_INVALID_RESPONSE",
      "Art Director could not create a valid design plan.",
      false,
      diagnostics,
    );
  }
  if (reasonCode === "ART_DIRECTOR_UNAVAILABLE") {
    return new AiDeckPlanningStageError(
      "ART_DIRECTOR_UNAVAILABLE",
      "Art Director is temporarily unavailable.",
      true,
      diagnostics,
    );
  }
  if (reasonCode === "DESIGN_COMPOSITION_UNSUPPORTED") {
    return new AiDeckPlanningStageError(
      "DESIGN_COMPOSITION_UNSUPPORTED",
      "The content plan cannot be composed with the available layouts.",
      false,
      diagnostics,
    );
  }
  if (status === 422) {
    return new AiDeckPlanningStageError(
      "PYTHON_WORKER_STAGE_REQUEST_INVALID",
      "AI deck planning stage request is invalid.",
      false,
      diagnostics,
    );
  }
  return new AiDeckPlanningStageError(
    "PYTHON_WORKER_PLANNING_FAILED",
    "AI deck planning provider failed.",
    status === 429 || status >= 500,
    diagnostics,
  );
}

function classifyLegacyDetail(
  stage: AiDeckPlanningStage,
  detail: string,
): string {
  if (detail.includes("SOURCE_GROUNDING_REQUIRED")) {
    return "SOURCE_GROUNDING_REQUIRED";
  }
  if (detail.includes("Art Director could not create a valid design plan")) {
    return "ART_DIRECTOR_INVALID_RESPONSE";
  }
  if (detail.includes("Art Director model is unavailable")) {
    return "ART_DIRECTOR_UNAVAILABLE";
  }
  if (stage === "content-planning") {
    if (detail.startsWith("LLM deck content generation failed:")) {
      return "CONTENT_LLM_PROVIDER_FAILURE";
    }
    if (detail.startsWith("LLM returned empty deck content.")) {
      return "CONTENT_LLM_EMPTY_RESPONSE";
    }
    if (detail.startsWith("LLM returned invalid deck content:")) {
      return "CONTENT_LLM_INVALID_RESPONSE";
    }
    if (
      detail.startsWith("LLM content plan reused content item IDs:") ||
      detail.startsWith("LLM content plan referenced unavailable source IDs:") ||
      detail.startsWith("UNSUPPORTED_NUMERIC_CLAIM:") ||
      detail.startsWith("LLM returned fewer slides than the requested minimum")
    ) {
      return "CONTENT_LLM_INVALID_RESPONSE";
    }
    if (detail.startsWith("LLM slide count repair failed:")) {
      return "CONTENT_LLM_SLIDE_COUNT_REPAIR_FAILED";
    }
    if (
      detail.startsWith(
        "OPENAI_API_KEY is required for prompt or reference-based deck generation.",
      ) ||
      detail.startsWith(
        "LLM deck content generation is required for prompt or reference-based decks.",
      )
    ) {
      return "CONTENT_LLM_PROVIDER_FAILURE";
    }
  }
  return "PLANNING_FAILURE_UNCLASSIFIED";
}
