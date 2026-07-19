import { AnimationCreateEditor } from "./AnimationCreateEditor";
import { AnimationCreatePicker } from "./AnimationCreatePicker";
import { AnimationKeywordPicker } from "./AnimationKeywordPicker";
import type { AnimationKeywordTriggerOption } from "../models";
import type {
  AnimationDraftInput,
  AnimationTimingDraft,
  SupportedAnimationType
} from "../types";

export function AnimationCreateFlow(props: {
  canCreateAnimation: boolean;
  creationType: SupportedAnimationType | null;
  draft: AnimationTimingDraft | null;
  keywordOptions: AnimationKeywordTriggerOption[];
  keywordTriggerRestrictionMessage?: string | null;
  keywordTriggerWarningMessage?: string | null;
  linkedTypes: SupportedAnimationType[];
  mutationDisabledReason?: string | null;
  selectedKeywordId: string | null;
  selectedKeywordLabel: string | null;
  selectedKeywordOccurrenceId?: string | null;
  onAddAnimation: (
    draft: AnimationDraftInput,
    keywordId?: string | null,
    keywordOccurrenceId?: string | null
  ) => void;
  onDraftChange: (patch: Partial<AnimationTimingDraft>) => void;
  onSelectKeyword: (keywordId: string) => void;
  onStartCreating: (type: SupportedAnimationType) => void;
}) {
  const {
    canCreateAnimation,
    creationType,
    draft,
    keywordOptions,
    keywordTriggerRestrictionMessage = null,
    keywordTriggerWarningMessage = null,
    linkedTypes,
    mutationDisabledReason = null,
    selectedKeywordId,
    selectedKeywordLabel,
    selectedKeywordOccurrenceId = null,
    onAddAnimation,
    onDraftChange,
    onSelectKeyword,
    onStartCreating
  } = props;

  return (
    <>
      <AnimationCreatePicker
        creationType={creationType}
        linkedTypes={linkedTypes}
        mutationDisabledReason={mutationDisabledReason}
        onStartCreating={onStartCreating}
      />

      <AnimationKeywordPicker
        keywordOptions={keywordOptions}
        keywordTriggerRestrictionMessage={keywordTriggerRestrictionMessage}
        keywordTriggerWarningMessage={keywordTriggerWarningMessage}
        selectedKeywordId={selectedKeywordId}
        onSelectKeyword={onSelectKeyword}
      />

      {creationType && draft ? (
        <AnimationCreateEditor
          canCreateAnimation={canCreateAnimation}
          draft={draft}
          keywordTriggerRestrictionMessage={keywordTriggerRestrictionMessage}
          keywordTriggerWarningMessage={keywordTriggerWarningMessage}
          selectedKeywordId={selectedKeywordId}
          selectedKeywordLabel={selectedKeywordLabel}
          selectedKeywordOccurrenceId={selectedKeywordOccurrenceId}
          type={creationType}
          onAddAnimation={onAddAnimation}
          onDraftChange={onDraftChange}
        />
      ) : null}
    </>
  );
}
