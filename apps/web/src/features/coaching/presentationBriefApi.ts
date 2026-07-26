import {
  evaluatorLensRegistryResponseSchema,
  getPresentationBriefResponseSchema,
  putPresentationBriefRequestSchema,
  putPresentationBriefResponseSchema,
  type PresentationBrief,
  type EvaluatorLensDefinition,
  type PutPresentationBriefRequest,
} from "@orbit/shared/coaching";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchPresentationBrief(projectId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-brief`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Brief를 불러오지 못했습니다.");
  return getPresentationBriefResponseSchema.parse(await response.json()).brief;
}

export async function fetchEvaluatorLenses(
  fetcher: Fetcher = fetch,
): Promise<EvaluatorLensDefinition[]> {
  const response = await fetcher("/api/v1/evaluator-lenses", {
    credentials: "include",
  });
  if (!response.ok) throw new Error("평가 관점을 불러오지 못했습니다.");
  return evaluatorLensRegistryResponseSchema.parse(await response.json()).items;
}

export async function putPresentationBrief(
  projectId: string,
  input: PutPresentationBriefRequest,
  fetcher: Fetcher = fetch,
): Promise<PresentationBrief> {
  const request = putPresentationBriefRequestSchema.parse(input);
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-brief`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    if (error?.code === "REVISION_CONFLICT") {
      throw new PresentationBriefConflictError();
    }
    if (error?.code === "SOURCE_NOT_READY") {
      throw new Error(error.message ?? "참고자료 추출이 아직 완료되지 않았습니다.");
    }
    throw new Error("Brief를 저장하지 못했습니다.");
  }
  return putPresentationBriefResponseSchema.parse(await response.json()).brief;
}

export class PresentationBriefConflictError extends Error {
  constructor() {
    super("다른 변경이 먼저 저장됐습니다. 입력 내용은 유지했으니 최신 Brief와 비교해 다시 저장해 주세요.");
  }
}
