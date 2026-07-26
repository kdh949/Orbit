import type {
  CommunityTemplateCard,
  UseCommunityTemplateResponse,
} from "@orbit/shared/community-templates";

export type CommunityTemplateApplyAttempt = {
  card: CommunityTemplateCard;
  clientRequestId: string;
  instanceKey: string;
};

export type FailedCommunityTemplateApply = CommunityTemplateApplyAttempt & {
  message: string;
};

export function createCommunityTemplateApplyAttempt(
  instanceKey: string,
  card: CommunityTemplateCard,
  previousFailure: FailedCommunityTemplateApply | null,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
): CommunityTemplateApplyAttempt {
  const canRetry =
    previousFailure?.instanceKey === instanceKey &&
    previousFailure.card.templateId === card.templateId;
  return {
    card,
    clientRequestId: canRetry
      ? previousFailure.clientRequestId
      : createRequestId(),
    instanceKey,
  };
}

export async function executeCommunityTemplateApply(
  input: {
    attempt: CommunityTemplateApplyAttempt;
    workspaceId: string;
  },
  dependencies: {
    closeGallery: () => void;
    invalidateProjects: () => Promise<unknown> | unknown;
    invalidateRecent: () => Promise<unknown> | unknown;
    navigate: (path: string) => void;
    useTemplate: (input: {
      workspaceId: string;
      templateId: string;
      clientRequestId: string;
    }) => Promise<UseCommunityTemplateResponse>;
  },
) {
  const response = await dependencies.useTemplate({
    workspaceId: input.workspaceId,
    templateId: input.attempt.card.templateId,
    clientRequestId: input.attempt.clientRequestId,
  });
  await Promise.all([
    dependencies.invalidateProjects(),
    dependencies.invalidateRecent(),
  ]);
  dependencies.closeGallery();
  dependencies.navigate(
    `/project/${encodeURIComponent(response.project.projectId)}`,
  );
  return response;
}
