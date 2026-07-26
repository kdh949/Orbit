import type { PublishCommunityTemplateRequest } from "@orbit/shared/community-templates";
import type { FormEvent } from "react";

import {
  OrbitButton,
  OrbitDialog,
  OrbitField,
  OrbitInput,
  OrbitTextarea,
} from "../../components/ui";
import { CommunityTemplateCategoryDropdown } from "./CommunityTemplateCategoryDropdown";
import { CommunityTemplateTagCombobox } from "./CommunityTemplateTagCombobox";
import {
  CommunityTemplateSourcePicker,
  type CommunityTemplateSourceState,
} from "./CommunityTemplateSourcePicker";
import {
  createCommunityTemplatePublishRequest,
  getFirstCommunityTemplatePublishErrorField,
  type CommunityTemplatePublishDraft,
  type CommunityTemplatePublishErrors,
} from "./communityTemplatePublish";
import "./community-template-gallery.css";

const formId = "community-template-publish-form";
const fieldIds: Record<keyof CommunityTemplatePublishDraft, string> = {
  sourceProjectId: "community-template-publish-source",
  title: "community-template-publish-title",
  category: "community-template-publish-category",
  tags: "community-template-publish-tags",
  description: "community-template-publish-description",
  rightsConfirmed: "community-template-publish-rights",
};

export type PublishCommunityTemplateViewProps = {
  draft: CommunityTemplatePublishDraft;
  errors: CommunityTemplatePublishErrors;
  onChange: (draft: CommunityTemplatePublishDraft) => void;
  onClose: () => void;
  onRetrySources: () => void;
  onSubmit: (request: PublishCommunityTemplateRequest) => void;
  onValidationErrors?: (errors: CommunityTemplatePublishErrors) => void;
  open: boolean;
  publishError: string | null;
  sources: CommunityTemplateSourceState;
  submitting: boolean;
};

export function PublishCommunityTemplateView(
  props: PublishCommunityTemplateViewProps,
) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.submitting) return;
    const result = createCommunityTemplatePublishRequest(props.draft);
    if (!result.success) {
      props.onValidationErrors?.(result.errors);
      const first = getFirstCommunityTemplatePublishErrorField(result.errors);
      if (first) {
        window.requestAnimationFrame(() => {
          document.getElementById(fieldIds[first])?.focus();
        });
      }
      return;
    }
    props.onValidationErrors?.({});
    props.onSubmit(result.request);
  }

  return (
    <OrbitDialog
      className="community-template-publish-dialog"
      closeDisabled={props.submitting}
      description="공개할 프로젝트를 선택하고 간단한 소개를 남겨주세요. 프로젝트의 모든 슬라이드가 함께 공개됩니다."
      footer={
        <>
          <OrbitButton
            disabled={props.submitting}
            onClick={props.onClose}
            variant="secondary"
          >
            취소
          </OrbitButton>
          <OrbitButton
            disabled={
              props.sources.loading ||
              Boolean(props.sources.error) ||
              !props.sources.items.some((source) => source.publishable)
            }
            form={formId}
            loading={props.submitting}
            type="submit"
            variant="primary"
          >
            {props.submitting ? "등록 중" : "커뮤니티에 등록"}
          </OrbitButton>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="프로젝트 공유하기"
    >
      <form id={formId} onSubmit={submit}>
        {props.publishError ? (
          <div className="community-template-publish-error" role="alert">
            {props.publishError}
          </div>
        ) : null}

        <CommunityTemplateSourcePicker
          disabled={props.submitting}
          error={props.errors.sourceProjectId}
          onChange={(sourceProjectId) =>
            props.onChange({ ...props.draft, sourceProjectId })
          }
          onRetry={props.onRetrySources}
          selectedProjectId={props.draft.sourceProjectId}
          state={props.sources}
        />

        <OrbitField
          error={props.errors.title}
          hint="1자 이상 60자 이하로 입력해 주세요."
          id={fieldIds.title}
          label="템플릿 이름"
        >
          <OrbitInput
            disabled={props.submitting}
            maxLength={60}
            onChange={(event) =>
              props.onChange({ ...props.draft, title: event.target.value })
            }
            value={props.draft.title}
          />
        </OrbitField>

        <OrbitField
          error={props.errors.category}
          id={fieldIds.category}
          label="대표 주제"
        >
          <CommunityTemplateCategoryDropdown
            disabled={props.submitting}
            id={fieldIds.category}
            invalid={Boolean(props.errors.category)}
            onChange={(category) =>
              props.onChange({
                ...props.draft,
                category,
              })
            }
            value={props.draft.category}
          />
        </OrbitField>

        <OrbitField
          error={props.errors.tags}
          hint="기존 태그를 선택하거나 새 태그를 최대 5개까지 만들 수 있습니다."
          id={fieldIds.tags}
          label="태그"
        >
          <CommunityTemplateTagCombobox
            disabled={props.submitting}
            id={fieldIds.tags}
            onChange={(tags) => props.onChange({ ...props.draft, tags })}
            value={props.draft.tags}
          />
        </OrbitField>

        <OrbitField
          error={props.errors.description}
          hint={`${props.draft.description?.length ?? 0} / 300`}
          id={fieldIds.description}
          label="짧은 소개글"
        >
          <OrbitTextarea
            disabled={props.submitting}
            maxLength={300}
            onChange={(event) =>
              props.onChange({
                ...props.draft,
                description: event.target.value,
              })
            }
            placeholder="어떤 발표에 잘 어울리는 프로젝트인지 소개해 주세요."
            rows={4}
            value={props.draft.description ?? ""}
          />
        </OrbitField>

        <label className="community-template-rights-field">
          <input
            aria-describedby={
              props.errors.rightsConfirmed
                ? "community-template-publish-rights-error"
                : undefined
            }
            aria-invalid={props.errors.rightsConfirmed ? true : undefined}
            checked={props.draft.rightsConfirmed}
            disabled={props.submitting}
            id={fieldIds.rightsConfirmed}
            onChange={(event) =>
              props.onChange({
                ...props.draft,
                rightsConfirmed: event.target.checked,
              })
            }
            type="checkbox"
          />
          <span>
            공개 가능한 디자인이며 공유할 권리를 보유하고 있습니다.
          </span>
          {props.errors.rightsConfirmed ? (
            <small id="community-template-publish-rights-error" role="alert">
              {props.errors.rightsConfirmed}
            </small>
          ) : null}
        </label>
      </form>
    </OrbitDialog>
  );
}
