import {
  communityTemplateApiErrorSchema,
  communityTemplateCategoryListResponseSchema,
  communityTemplateIdSchema,
  communityTemplateListQuerySchema,
  communityTemplateListResponseSchema,
  communityTemplateRecentResponseSchema,
  communityTemplateSourceListResponseSchema,
  communityTemplateTagListQuerySchema,
  communityTemplateTagListResponseSchema,
  publishCommunityTemplateRequestSchema,
  publishCommunityTemplateResponseSchema,
  useCommunityTemplateRequestSchema,
  useCommunityTemplateResponseSchema,
  type CommunityTemplateApiErrorCode,
  type CommunityTemplateListQuery,
  type CommunityTemplateTagListQuery,
} from "@orbit/shared/community-templates";

export type CommunityTemplateFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const communityTemplateKeys = {
  all: ["community-templates"] as const,
  shelf: ["community-templates", "shelf"] as const,
  lists: ["community-templates", "list"] as const,
  list: (query: CommunityTemplateListQuery) =>
    ["community-templates", "list", query] as const,
  recent: ["community-templates", "recent"] as const,
  sources: (workspaceId: string) =>
    ["community-templates", "sources", workspaceId] as const,
  categories: ["community-templates", "categories"] as const,
  tags: (query: CommunityTemplateTagListQuery) =>
    ["community-templates", "tags", query] as const,
};

export class CommunityTemplateWebError extends Error {
  readonly code?: CommunityTemplateApiErrorCode;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    code?: CommunityTemplateApiErrorCode,
  ) {
    super(message);
    this.name = "CommunityTemplateWebError";
    this.code = code;
    this.status = status;
  }
}

export function buildCommunityTemplateListSearch(
  rawQuery: CommunityTemplateListQuery,
) {
  const query = communityTemplateListQuerySchema.parse(rawQuery);
  const search = new URLSearchParams();
  if (query.query) search.set("query", query.query);
  if (query.category) search.set("category", query.category);
  if (query.categoryId) search.set("categoryId", query.categoryId);
  search.set("page", String(query.page));
  search.set("limit", String(query.limit));
  return search.toString();
}

export async function fetchCommunityTemplateList(
  query: CommunityTemplateListQuery,
  fetcher: CommunityTemplateFetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/community-templates?${buildCommunityTemplateListSearch(query)}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw await readCommunityTemplateError(
      response,
      "커뮤니티 템플릿을 불러오지 못했습니다.",
    );
  }
  return communityTemplateListResponseSchema.parse(await response.json());
}

export function fetchCommunityTemplateShelf(
  fetcher: CommunityTemplateFetcher = fetch,
) {
  return fetchCommunityTemplateList({ page: 1, limit: 4 }, fetcher);
}

export async function fetchRecentCommunityTemplates(
  fetcher: CommunityTemplateFetcher = fetch,
) {
  const response = await fetcher("/api/v1/community-templates/recent", {
    credentials: "include",
  });
  if (!response.ok) {
    throw await readCommunityTemplateError(
      response,
      "최근 사용한 템플릿을 불러오지 못했습니다.",
    );
  }
  return communityTemplateRecentResponseSchema.parse(await response.json());
}

export async function fetchCommunityTemplateSources(
  rawWorkspaceId: string,
  fetcher: CommunityTemplateFetcher = fetch,
) {
  const workspaceId = parseWorkspaceId(rawWorkspaceId);
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/community-templates/sources`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw await readCommunityTemplateError(
      response,
      "공개할 프로젝트를 불러오지 못했습니다.",
    );
  }
  return communityTemplateSourceListResponseSchema.parse(
    await response.json(),
  );
}

export async function fetchCommunityCategories(
  fetcher: CommunityTemplateFetcher = fetch,
) {
  const response = await fetcher("/api/v1/community-templates/categories", {
    credentials: "include",
  });
  if (!response.ok) {
    throw await readCommunityTemplateError(
      response,
      "대표 주제를 불러오지 못했습니다.",
    );
  }
  return communityTemplateCategoryListResponseSchema.parse(
    await response.json(),
  );
}

export async function fetchCommunityTags(
  rawQuery: CommunityTemplateTagListQuery,
  fetcher: CommunityTemplateFetcher = fetch,
) {
  const query = communityTemplateTagListQuerySchema.parse(rawQuery);
  const search = new URLSearchParams({
    scope: query.scope,
    sort: query.sort,
    limit: String(query.limit),
  });
  if (query.query) search.set("query", query.query);
  const response = await fetcher(
    "/api/v1/community-templates/tags?" + search.toString(),
    { credentials: "include" },
  );
  if (!response.ok) {
    throw await readCommunityTemplateError(
      response,
      "태그를 불러오지 못했습니다.",
    );
  }
  return communityTemplateTagListResponseSchema.parse(await response.json());
}

export async function publishCommunityTemplate(
  rawInput: {
    workspaceId: string;
    sourceProjectId: string;
    title: string;
    categoryId: string;
    tags: string[];
    description?: string;
    rightsConfirmed: boolean;
  },
  fetcher: CommunityTemplateFetcher = fetch,
) {
  const workspaceId = parseWorkspaceId(rawInput.workspaceId);
  const request = publishCommunityTemplateRequestSchema.parse({
    sourceProjectId: rawInput.sourceProjectId,
    title: rawInput.title,
    categoryId: rawInput.categoryId,
    tags: rawInput.tags,
    description: rawInput.description,
    rightsConfirmed: rawInput.rightsConfirmed,
  });
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/community-templates`,
    {
      body: JSON.stringify(request),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw await readCommunityTemplateError(
      response,
      "커뮤니티 템플릿을 등록하지 못했습니다.",
    );
  }
  return publishCommunityTemplateResponseSchema.parse(await response.json());
}

export async function useCommunityTemplate(
  rawInput: {
    workspaceId: string;
    templateId: string;
    clientRequestId: string;
  },
  fetcher: CommunityTemplateFetcher = fetch,
) {
  const workspaceId = parseWorkspaceId(rawInput.workspaceId);
  const templateId = communityTemplateIdSchema.parse(rawInput.templateId);
  const request = useCommunityTemplateRequestSchema.parse({
    clientRequestId: rawInput.clientRequestId,
  });
  const response = await fetcher(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/community-templates/${encodeURIComponent(templateId)}/use`,
    {
      body: JSON.stringify(request),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw await readCommunityTemplateError(
      response,
      "템플릿을 적용하지 못했습니다. 다시 시도해 주세요.",
    );
  }
  return useCommunityTemplateResponseSchema.parse(await response.json());
}

function parseWorkspaceId(rawWorkspaceId: string) {
  const workspaceId = rawWorkspaceId.trim();
  if (!workspaceId || workspaceId.length > 200) {
    throw new CommunityTemplateWebError(
      "워크스페이스 정보를 확인할 수 없습니다.",
      400,
    );
  }
  return workspaceId;
}

async function readCommunityTemplateError(
  response: Response,
  fallback: string,
) {
  try {
    const parsed = communityTemplateApiErrorSchema.safeParse(
      await response.json(),
    );
    if (parsed.success) {
      return new CommunityTemplateWebError(
        parsed.data.message,
        response.status,
        parsed.data.code,
      );
    }
  } catch {
    // Only validated bounded API errors may reach the UI.
  }
  return new CommunityTemplateWebError(fallback, response.status);
}
