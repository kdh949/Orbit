import {
  applyDesignAgentProposalResponseSchema,
  createDesignAgentMessageResponseSchema,
  createDesignImageGenerationResponseSchema,
  designImageGenerationResultSchema,
  type ApplyDesignAgentProposalResponse,
  type CreateDesignAgentMessageRequest,
  type CreateDesignAgentMessageResponse,
  type CreateDesignImageGenerationRequest,
  type CreateDesignImageGenerationResponse,
  type DesignImageGenerationResult,
} from "@orbit/shared/deck";
import { jobSchema } from "@orbit/shared/jobs";

export async function createDesignAgentMessage(
  projectId: string,
  input: CreateDesignAgentMessageRequest
): Promise<CreateDesignAgentMessageResponse> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/design-agent/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `Design agent request failed: ${response.status}`;
    throw new Error(message);
  }

  return createDesignAgentMessageResponseSchema.parse(await response.json());
}

export async function createDesignImageGeneration(
  projectId: string,
  input: CreateDesignImageGenerationRequest
): Promise<CreateDesignImageGenerationResponse> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/design-agent/image-generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  if (!response.ok) throw new Error(await readApiError(response, "이미지 생성을 시작하지 못했습니다."));
  return createDesignImageGenerationResponseSchema.parse(await response.json());
}

export async function pollDesignImageGeneration(
  jobId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<DesignImageGenerationResult> {
  const intervalMs = options.intervalMs ?? 1_200;
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  while (Date.now() < deadline) {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) throw new Error(await readApiError(response, "이미지 생성 상태를 확인하지 못했습니다."));
    const job = jobSchema.parse(await response.json());
    if (job.status === "succeeded") {
      return designImageGenerationResultSchema.parse(job.result);
    }
    if (job.status === "failed") {
      throw new Error(toDesignImageError(job.error?.code, job.error?.message));
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, intervalMs));
  }
  throw new Error("이미지 생성 시간이 초과되었습니다. 다시 시도해 주세요.");
}

function toDesignImageError(code?: string, fallback?: string) {
  if (code === "DESIGN_IMAGE_DAILY_LIMIT_EXCEEDED") return "오늘 사용할 수 있는 이미지 생성 횟수를 모두 사용했습니다.";
  if (code === "DESIGN_IMAGE_PROVIDER_UNAVAILABLE") return "현재 이미지 생성 기능을 사용할 수 없습니다.";
  if (code === "DESIGN_IMAGE_RESULT_INVALID") return "생성된 이미지가 품질 기준을 통과하지 못했습니다. 다시 시도해 주세요.";
  return fallback || "이미지를 생성하지 못했습니다. 다시 시도해 주세요.";
}

async function readApiError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => undefined);
  return payload && typeof payload === "object" && "message" in payload
    ? String(payload.message)
    : fallback;
}

export async function applyDesignAgentProposal(
  projectId: string,
  proposalId: string
): Promise<ApplyDesignAgentProposalResponse> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/design-agent/proposals/${encodeURIComponent(proposalId)}/apply`,
    { method: "POST" }
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `Design agent apply failed: ${response.status}`;
    if (response.status === 409) {
      throw new DesignAgentProposalStaleError(message);
    }
    throw new Error(message);
  }

  return applyDesignAgentProposalResponseSchema.parse(await response.json());
}

export class DesignAgentProposalStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignAgentProposalStaleError";
  }
}

export function isDesignAgentProposalStaleError(
  error: unknown,
): error is DesignAgentProposalStaleError {
  return error instanceof DesignAgentProposalStaleError;
}
