import {
  practicePlanResponseSchema,
  type PracticePlanResponse,
} from "@orbit/shared/coaching";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchPracticePlan(
  projectId: string,
  sourceFullRunId: string,
  fetcher: Fetcher = fetch,
): Promise<PracticePlanResponse> {
  const query = new URLSearchParams({ sourceFullRunId });
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/practice-plan?${query}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("연습 계획을 불러오지 못했습니다.");
  return practicePlanResponseSchema.parse(await response.json());
}
