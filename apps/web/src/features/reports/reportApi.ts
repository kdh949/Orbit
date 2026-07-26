import {
  demoIds,
  getRehearsalProjectSummaryResponseSchema,
  listPresentationRunsResponseSchema,
  rehearsalRunComparisonSchema,
} from "@orbit/shared";
import type {
  Project,
  PresentationRun,
  RehearsalProjectSummary,
  RehearsalRun,
  RehearsalRunComparison,
} from "@orbit/shared";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ReportRunList<T> = { runs: T[]; total: number };

type ReportRunSource = "rehearsal" | "presentation";

export type ProjectReportRunSources = {
  failedSources: ReportRunSource[];
  presentation: ReportRunList<PresentationRun>;
  rehearsal: ReportRunList<RehearsalRun>;
  succeededSourceCount: number;
};

export async function fetchReportProjects(
  fetcher: Fetcher = fetch,
): Promise<Project[]> {
  const response = await fetcher(
    `/api/v1/workspaces/${demoIds.workspaceId}/projects`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`프로젝트 목록을 불러오지 못했습니다. (${response.status})`);
  }
  return (await response.json()) as Project[];
}

export async function fetchProjectRehearsalSummary(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<RehearsalProjectSummary | null> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rehearsal-summary`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`리허설 요약을 불러오지 못했습니다. (${response.status})`);
  }
  const data = getRehearsalProjectSummaryResponseSchema.parse(
    await response.json(),
  );
  return data.summary;
}

export async function fetchProjectRehearsalReportRuns(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<{ runs: RehearsalRun[]; total: number }> {
  const params = new URLSearchParams({ status: "succeeded", pageSize: "100" });
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rehearsals?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`리허설 기록을 불러오지 못했습니다. (${response.status})`);
  }
  const data = (await response.json()) as { runs: RehearsalRun[]; total: number };
  return { runs: data.runs ?? [], total: data.total ?? 0 };
}

export async function fetchProjectPresentationReportRuns(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<{ runs: PresentationRun[]; total: number }> {
  const params = new URLSearchParams({ page: "1", pageSize: "100" });
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-runs?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(`실전 발표 기록을 불러오지 못했습니다. (${response.status})`);
  }
  const data = listPresentationRunsResponseSchema.parse(await response.json());
  return { runs: data.runs, total: data.total };
}

export async function loadProjectReportRunSources(
  projectId: string,
  rehearsalLoader: (
    projectId: string,
  ) => Promise<ReportRunList<RehearsalRun>> =
    fetchProjectRehearsalReportRuns,
  presentationLoader: (
    projectId: string,
  ) => Promise<ReportRunList<PresentationRun>> =
    fetchProjectPresentationReportRuns,
): Promise<ProjectReportRunSources> {
  const [rehearsalResult, presentationResult] = await Promise.allSettled([
    rehearsalLoader(projectId),
    presentationLoader(projectId),
  ]);
  const failedSources: ReportRunSource[] = [];

  if (rehearsalResult.status === "rejected") failedSources.push("rehearsal");
  if (presentationResult.status === "rejected") {
    failedSources.push("presentation");
  }

  return {
    failedSources,
    presentation:
      presentationResult.status === "fulfilled"
        ? presentationResult.value
        : { runs: [], total: 0 },
    rehearsal:
      rehearsalResult.status === "fulfilled"
        ? rehearsalResult.value
        : { runs: [], total: 0 },
    succeededSourceCount: 2 - failedSources.length,
  };
}

export async function fetchRehearsalRunComparison(
  projectId: string,
  runId: string,
  fetcher: Fetcher = fetch,
): Promise<RehearsalRunComparison | null> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rehearsals/${encodeURIComponent(runId)}/comparison`,
    { credentials: "include" },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`리허설 비교를 불러오지 못했습니다. (${response.status})`);
  }

  try {
    const result = rehearsalRunComparisonSchema.safeParse(await response.json());
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
