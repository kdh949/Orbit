import {
  jobSchema,
  ooxmlReferenceTemplateOptionsResponseSchema,
  type Job,
  type OoxmlReferenceTemplateGenerationRequest,
  type OoxmlReferenceTemplateOption,
  type OoxmlReferenceTemplateOptionsResponse,
} from "@orbit/shared";

export async function requestOoxmlReferenceTemplateOptions(): Promise<OoxmlReferenceTemplateOptionsResponse> {
  const response = await fetch("/api/v1/ooxml-reference-templates", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("원본 템플릿을 불러오지 못했습니다.");
  }
  return ooxmlReferenceTemplateOptionsResponseSchema.parse(
    await response.json(),
  );
}

export async function startOoxmlReferenceTemplateGeneration(
  projectId: string,
  request: OoxmlReferenceTemplateGenerationRequest,
): Promise<Job> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/ooxml-reference-template-generations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || "원본 템플릿 생성을 시작하지 못했습니다.");
  }
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("job" in payload) ||
    Object.keys(payload).some((key) => key !== "job")
  ) {
    throw new Error("원본 템플릿 생성 응답이 올바르지 않습니다.");
  }
  return jobSchema.parse(payload.job);
}

export function buildOoxmlReferenceTemplateGenerationRequest(input: {
  topic: string;
  content: string;
  audience: string;
  tone: "professional" | "friendly" | "confident" | "concise";
  allowWebResearch: boolean;
  referenceFileIds: string[];
  targetDurationMinutes: number;
  slideCountRange: { min: number; max: number };
  template: Pick<OoxmlReferenceTemplateOption, "templateId" | "version">;
}): OoxmlReferenceTemplateGenerationRequest {
  const hasReferences = input.referenceFileIds.length > 0;
  const referencePolicy = input.allowWebResearch
    ? hasReferences
      ? "references-first"
      : "research-first"
    : hasReferences
      ? "references-only"
      : "user-input-only";
  return {
    topic: input.topic.trim(),
    prompt: input.content.trim(),
    targetDurationMinutes: input.targetDurationMinutes,
    slideCountRange: input.slideCountRange,
    metadata: {
      audience: "general",
      purpose: "inform",
      tone: input.tone,
    },
    referencePolicy,
    referenceFileIds: input.referenceFileIds,
    templateSelection: {
      mode: "user",
      templateId: input.template.templateId,
      version: input.template.version,
    },
  };
}

export function ooxmlReferenceGenerationPath(
  projectId: string,
  jobId: string,
): string {
  return `/projects/${encodeURIComponent(projectId)}/ooxml-reference-generations/${encodeURIComponent(jobId)}`;
}
