import {
  autoCreateSlideQuestionGuidesResponseSchema,
  canonicalJson,
  jobSchema,
  slideQuestionGuideJobResponseSchema,
  slideQuestionGuideListResponseSchema,
  slideQuestionGuideSchema,
  type SlideQuestionGuide,
} from "@orbit/shared";

export async function autoCreateSlideQuestionGuides(input: {
  projectId: string;
  clientRequestId: string;
  deckId: string;
  expectedDeckVersion: number;
}) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/slide-question-guides/auto`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: input.clientRequestId,
        deckId: input.deckId,
        expectedDeckVersion: input.expectedDeckVersion,
        questionCount: 3,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await responseMessage(response, "예상 질문 자동 생성을 시작하지 못했습니다."));
  }
  return autoCreateSlideQuestionGuidesResponseSchema.parse(await response.json());
}

export async function sha256Canonical(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAutoSlideQuestionGuidesClientRequestId(input: {
  projectId: string;
  deckId: string;
  deckVersion: number;
}) {
  return `slide-guide-auto-batch_${await sha256Canonical(input)}`;
}

export async function createSlideQuestionGuide(input: {
  projectId: string;
  deckId: string;
  slideId: string;
  expectedDeckVersion: number;
}) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/slide-question-guides`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: crypto.randomUUID(),
        deckId: input.deckId,
        slideId: input.slideId,
        expectedDeckVersion: input.expectedDeckVersion,
        questionCount: 3,
      }),
    },
  );
  if (!response.ok) throw new Error(await responseMessage(response, "예상 질문 생성을 시작하지 못했습니다."));
  return slideQuestionGuideJobResponseSchema.parse(await response.json());
}

export async function waitForSlideQuestionGuideJob(
  jobId: string,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
) {
  const startedAt = Date.now();
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 120_000;
  for (;;) {
    const response = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { credentials: "include" });
    if (!response.ok) throw new Error(await responseMessage(response, "질문 생성 상태를 확인하지 못했습니다."));
    const job = jobSchema.parse(await response.json());
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(job.error?.message ?? "예상 질문 생성에 실패했습니다.");
    if (Date.now() - startedAt > timeoutMs) throw new Error("예상 질문 생성 시간이 초과되었습니다.");
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function getSlideQuestionGuide(projectId: string, guideId: string) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/slide-question-guides/${encodeURIComponent(guideId)}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error(await responseMessage(response, "예상 질문을 불러오지 못했습니다."));
  const payload = await response.json() as { guide?: unknown };
  return slideQuestionGuideSchema.parse(payload.guide);
}

export async function listSlideQuestionGuides(input: {
  projectId: string;
  deckId: string;
  slideId?: string;
}): Promise<SlideQuestionGuide[]> {
  const query = new URLSearchParams({ deckId: input.deckId });
  if (input.slideId) query.set("slideId", input.slideId);
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/slide-question-guides?${query}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error(await responseMessage(response, "예상 질문 기록을 불러오지 못했습니다."));
  return slideQuestionGuideListResponseSchema.parse(await response.json()).guides;
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { message?: string | { message?: string } };
    return typeof payload.message === "string" ? payload.message : payload.message?.message ?? fallback;
  } catch {
    return fallback;
  }
}
