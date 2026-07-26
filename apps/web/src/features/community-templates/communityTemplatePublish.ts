import {
  publishCommunityTemplateRequestSchema,
  type CommunityTemplateCategory,
  type PublishCommunityTemplateRequest,
} from "@orbit/shared/community-templates";

export type CommunityTemplatePublishDraft = {
  sourceProjectId: string;
  title: string;
  category: "" | CommunityTemplateCategory;
  tags: string[];
  description?: string;
  rightsConfirmed: boolean;
};

export type CommunityTemplatePublishField = keyof CommunityTemplatePublishDraft;
export type CommunityTemplatePublishErrors = Partial<
  Record<CommunityTemplatePublishField, string>
>;

const fieldOrder: CommunityTemplatePublishField[] = [
  "sourceProjectId",
  "title",
  "category",
  "tags",
  "description",
  "rightsConfirmed",
];

export function createCommunityTemplatePublishRequest(
  draft: CommunityTemplatePublishDraft,
):
  | { success: true; request: PublishCommunityTemplateRequest }
  | { success: false; errors: CommunityTemplatePublishErrors } {
  const { category, ...values } = draft;
  const parsed = publishCommunityTemplateRequestSchema.safeParse({
    ...values,
    categoryId: category || undefined,
  });
  if (parsed.success) return { success: true, request: parsed.data };

  const errors: CommunityTemplatePublishErrors = {};
  if (!draft.sourceProjectId.trim()) {
    errors.sourceProjectId = "공개할 프로젝트를 선택해 주세요.";
  }
  if (!draft.title.trim() || draft.title.trim().length > 60) {
    errors.title = "템플릿 이름은 1자 이상 60자 이하로 입력해 주세요.";
  }
  if (!draft.category) {
    errors.category = "대표 주제를 선택해 주세요.";
  }
  if (draft.tags.length > 5) {
    errors.tags = "태그는 최대 5개까지 입력할 수 있습니다.";
  }
  if ((draft.description?.trim().length ?? 0) > 300) {
    errors.description = "소개글은 300자 이하로 입력해 주세요.";
  }
  if (!draft.rightsConfirmed) {
    errors.rightsConfirmed = "공개 권리를 확인해 주세요.";
  }
  return { success: false, errors };
}

export function getFirstCommunityTemplatePublishErrorField(
  errors: CommunityTemplatePublishErrors,
) {
  return fieldOrder.find((field) => Boolean(errors[field]));
}

export async function executeCommunityTemplatePublish(
  input: {
    workspaceId: string;
    request: PublishCommunityTemplateRequest;
  },
  dependencies: {
    announceSuccess: (title: string) => void;
    closeDialog: () => void;
    invalidateLists: () => Promise<unknown> | unknown;
    invalidateShelf: () => Promise<unknown> | unknown;
    publish: (input: {
      workspaceId: string;
      sourceProjectId: string;
      title: string;
      categoryId: NonNullable<PublishCommunityTemplateRequest["categoryId"]>;
      tags: string[];
      description?: string;
      rightsConfirmed: boolean;
    }) => Promise<{ template: { title: string } }>;
  },
) {
  const response = await dependencies.publish({
    workspaceId: input.workspaceId,
    sourceProjectId: input.request.sourceProjectId,
    title: input.request.title,
    categoryId: input.request.categoryId ?? input.request.category!,
    tags: input.request.tags,
    description: input.request.description,
    rightsConfirmed: input.request.rightsConfirmed,
  });
  await Promise.all([
    dependencies.invalidateShelf(),
    dependencies.invalidateLists(),
  ]);
  dependencies.closeDialog();
  dependencies.announceSuccess(response.template.title);
  return response;
}
