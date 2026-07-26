import { demoIds } from "@orbit/shared/common";
import { type PublishCommunityTemplateRequest } from "@orbit/shared/community-templates";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  PublishCommunityTemplateView,
  type PublishCommunityTemplateViewProps,
} from "./PublishCommunityTemplateView";
import {
  executeCommunityTemplatePublish,
  type CommunityTemplatePublishDraft,
  type CommunityTemplatePublishErrors,
} from "./communityTemplatePublish";
import {
  CommunityTemplateWebError,
  communityTemplateKeys,
  fetchCommunityTemplateSources,
  publishCommunityTemplate,
} from "./communityTemplateApi";

export { PublishCommunityTemplateView } from "./PublishCommunityTemplateView";
export type { PublishCommunityTemplateViewProps } from "./PublishCommunityTemplateView";

const initialDraft: CommunityTemplatePublishDraft = {
  sourceProjectId: "",
  title: "",
  category: "",
  tags: [],
  description: "",
  rightsConfirmed: false,
};

function createInitialDraft(projectId?: string): CommunityTemplatePublishDraft {
  return {
    ...initialDraft,
    sourceProjectId: projectId ?? "",
  };
}

export function PublishCommunityTemplateDialog(props: {
  initialProjectId?: string;
  onClose: () => void;
  onPublished: (title: string) => void;
  open: boolean;
  workspaceId?: string;
}) {
  const workspaceId = props.workspaceId ?? demoIds.workspaceId;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createInitialDraft(props.initialProjectId));
  const [errors, setErrors] = useState<CommunityTemplatePublishErrors>({});
  const [publishError, setPublishError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const sourcesQuery = useQuery({
    enabled: props.open,
    queryKey: communityTemplateKeys.sources(workspaceId),
    queryFn: () => fetchCommunityTemplateSources(workspaceId),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!props.open) return;
    setDraft(createInitialDraft(props.initialProjectId));
    setErrors({});
    setPublishError(null);
    setSubmitting(false);
    submitLockRef.current = false;
  }, [props.initialProjectId, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [props.open]);

  async function submit(request: PublishCommunityTemplateRequest) {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setPublishError(null);
    try {
      await executeCommunityTemplatePublish(
        { request, workspaceId },
        {
          announceSuccess: props.onPublished,
          closeDialog: props.onClose,
          invalidateLists: () =>
            queryClient.invalidateQueries({
              queryKey: communityTemplateKeys.lists,
            }),
          invalidateShelf: () =>
            queryClient.invalidateQueries({
              queryKey: communityTemplateKeys.shelf,
            }),
          publish: publishCommunityTemplate,
        },
      );
    } catch (cause) {
      setPublishError(
        cause instanceof CommunityTemplateWebError
          ? cause.message
          : "커뮤니티 템플릿을 등록하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  const viewProps: PublishCommunityTemplateViewProps = {
    draft,
    errors,
    onChange: (nextDraft) => {
      if (submitting) return;
      setDraft(nextDraft);
    },
    onClose: () => {
      if (!submitting) props.onClose();
    },
    onRetrySources: () => void sourcesQuery.refetch(),
    onSubmit: (request) => void submit(request),
    onValidationErrors: setErrors,
    open: props.open,
    publishError,
    sources: {
      items: sourcesQuery.data?.items ?? [],
      loading: sourcesQuery.isLoading,
      error: getSourceError(sourcesQuery.error, sourcesQuery.isError),
    },
    submitting,
  };

  return <PublishCommunityTemplateView {...viewProps} />;
}

function getSourceError(error: unknown, isError: boolean) {
  if (error instanceof CommunityTemplateWebError) return error.message;
  return isError ? "공개할 프로젝트를 불러오지 못했습니다." : null;
}
