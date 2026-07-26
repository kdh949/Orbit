import {
  communityTemplateCommentListResponseSchema,
  communityTemplateCommentResponseSchema,
  communityTemplateDetailSchema,
  communityTemplateDiscoverResponseSchema,
  communityTemplateEngagementResponseSchema,
  createCommunityTemplateReportRequestSchema,
  createCommunityTemplateReportResponseSchema,
  unpublishCommunityTemplateResponseSchema,
  updateCommunityTemplateRequestSchema,
  updateCommunityTemplateResponseSchema,
  type CommunityTemplateCommentListQuery,
  type CommunityTemplateDiscoverQuery,
  type CreateCommunityTemplateReportRequest,
  type UpdateCommunityTemplateRequest,
} from "@orbit/shared/community-templates";

const basePath = "/api/v1/community-templates";

export async function fetchCommunityDiscover(
  input: CommunityTemplateDiscoverQuery,
) {
  const params = new URLSearchParams({
    page: String(input.page),
    limit: String(input.limit),
    sort: input.sort,
  });
  if (input.query) params.set("query", input.query);
  if (input.categoryId) params.set("categoryId", input.categoryId);
  if (input.tagIds?.length) params.set("tagIds", input.tagIds.join(","));
  return communityTemplateDiscoverResponseSchema.parse(
    await request(`${basePath}/discover?${params.toString()}`),
  );
}

export async function fetchCommunityDetail(templateId: string) {
  return communityTemplateDetailSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}`),
  );
}

export async function setCommunityLike(templateId: string, liked: boolean) {
  return communityTemplateEngagementResponseSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}/like`, {
      method: liked ? "PUT" : "DELETE",
    }),
  );
}

export async function recordCommunityView(templateId: string) {
  return communityTemplateEngagementResponseSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}/view`, {
      method: "POST",
    }),
  );
}

export async function recordCommunityShare(templateId: string) {
  return communityTemplateEngagementResponseSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}/share`, {
      method: "POST",
    }),
  );
}

export async function fetchCommunityComments(
  templateId: string,
  input: CommunityTemplateCommentListQuery,
) {
  const params = new URLSearchParams({
    page: String(input.page),
    limit: String(input.limit),
  });
  return communityTemplateCommentListResponseSchema.parse(
    await request(
      `${basePath}/${encodeURIComponent(templateId)}/comments?${params.toString()}`,
    ),
  );
}

export async function createCommunityComment(templateId: string, body: string) {
  return communityTemplateCommentResponseSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  );
}

export async function updateCommunityComment(
  templateId: string,
  commentId: string,
  body: string,
) {
  return communityTemplateCommentResponseSchema.parse(
    await request(
      `${basePath}/${encodeURIComponent(templateId)}/comments/${encodeURIComponent(commentId)}`,
      { method: "PATCH", body: JSON.stringify({ body }) },
    ),
  );
}

export async function deleteCommunityComment(
  templateId: string,
  commentId: string,
) {
  await request(
    `${basePath}/${encodeURIComponent(templateId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  );
}

export async function updateCommunityTemplate(
  templateId: string,
  input: UpdateCommunityTemplateRequest,
) {
  const body = updateCommunityTemplateRequestSchema.parse(input);
  return updateCommunityTemplateResponseSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

export async function unpublishCommunityTemplate(templateId: string) {
  return unpublishCommunityTemplateResponseSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}`, {
      method: "DELETE",
    }),
  );
}

export async function reportCommunityTemplate(
  templateId: string,
  input: CreateCommunityTemplateReportRequest,
) {
  const body = createCommunityTemplateReportRequestSchema.parse(input);
  return createCommunityTemplateReportResponseSchema.parse(
    await request(`${basePath}/${encodeURIComponent(templateId)}/reports`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(body?.message ?? "커뮤니티 요청을 처리하지 못했습니다.");
  }
  return response.json() as Promise<unknown>;
}
