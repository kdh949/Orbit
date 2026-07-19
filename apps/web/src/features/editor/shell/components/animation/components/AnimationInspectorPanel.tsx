import { AnimationCreateFlow } from "./AnimationCreateFlow";
import { AnimationExistingEditor } from "./AnimationExistingEditor";
import { AnimationExistingList } from "./AnimationExistingList";
import { AnimationInspectorEmptyState } from "./AnimationInspectorEmptyState";
import { AnimationPanelComposerEmpty } from "./AnimationPanelComposerEmpty";
import { AnimationSelectionSummary } from "./AnimationSelectionSummary";
import { AnimationSlideOverview } from "./AnimationSlideOverview";
import type { AnimationEditorPanelProps } from "../types";
import { useAnimationInspectorModel } from "../hooks/useAnimationInspectorModel";
import {
  buildSlideAnimationOrdinalLabelMap,
  formatPreviousAnimationSummary,
  getPreviousSlideAnimation
} from "../utils/animationUi";

export function AnimationInspectorPanel(props: AnimationEditorPanelProps) {
  const {
    actionAnimationIds = [],
    animations,
    canCreateAnimation,
    element,
    keywordOptions,
    keywordTriggerRestrictionMessage,
    keywordTriggerWarningMessage,
    mutationDisabledReason = null,
    preferredAnimationId,
    selectedKeywordId,
    selectedKeywordLabel,
    selectedKeywordOccurrenceId,
    slideAnimations,
    slideElements,
    onAddAnimation,
    onDeleteAnimation,
    onSelectKeyword,
    onSelectSlideAnimation,
    showIds,
    onUpdateAnimation
  } = props;
  const {
    creationType,
    draftByType,
    linkedTypes,
    mode,
    selectAnimation,
    selectedAnimation,
    selectedAnimationId,
    startCreating,
    summary,
    updateDraft
  } = useAnimationInspectorModel(animations, preferredAnimationId);
  const ordinalLabelByAnimationId =
    buildSlideAnimationOrdinalLabelMap(slideAnimations);
  const previousSelectedAnimation = selectedAnimation
    ? getPreviousSlideAnimation(slideAnimations, selectedAnimation.animationId)
    : null;
  const actionAnimationIdSet = new Set(actionAnimationIds);
  const selectedTimelineRoot = selectedAnimation
    ? getAnimationTimelineRoot(
        createAnimationTimeline({
          animations: slideAnimations,
          legacyOnClickAnimationIds: actionAnimationIdSet
        }),
        selectedAnimation.animationId
      )
    : null;
  const isSelectedRootActionLinked = Boolean(
    selectedTimelineRoot?.effects.some((animation) =>
      actionAnimationIdSet.has(animation.animationId)
    )
  );
  const actionLinkedStartModeReason = isSelectedRootActionLinked
    ? "action과 연결된 재생 체인의 시작 방식은 변경할 수 없습니다."
    : null;
  const actionLinkedDeleteReason = isSelectedRootActionLinked
    ? "action을 먼저 제거한 뒤 재생 체인을 삭제할 수 있습니다."
    : null;

  if (!element) {
    return slideAnimations.length > 0 ? (
      <section className="property-panel animation-inspector-panel">
        <AnimationSlideOverview
          animations={slideAnimations}
          elements={slideElements}
          focusedAnimationId={preferredAnimationId}
          ordinalLabelByAnimationId={ordinalLabelByAnimationId}
          showIds={showIds}
          onSelectAnimation={onSelectSlideAnimation}
        />
      </section>
    ) : (
      <AnimationInspectorEmptyState />
    );
  }

  return (
    <section className="property-panel animation-inspector-panel">
      {mutationDisabledReason ? (
        <div className="animation-editor-warning" role="status">
          {mutationDisabledReason}
        </div>
      ) : null}
      <AnimationSelectionSummary
        element={element}
        showIds={showIds}
        summaryLabel={summary.label}
        summaryTone={summary.tone}
      />

      <AnimationExistingList
        animations={animations}
        ordinalLabelByAnimationId={ordinalLabelByAnimationId}
        selectedAnimationId={selectedAnimationId}
        onSelectAnimation={selectAnimation}
      />

      <AnimationCreateFlow
        canCreateAnimation={canCreateAnimation && !mutationDisabledReason}
        creationType={creationType}
        draft={creationType ? draftByType[creationType] : null}
        keywordOptions={keywordOptions}
        keywordTriggerRestrictionMessage={keywordTriggerRestrictionMessage}
        keywordTriggerWarningMessage={keywordTriggerWarningMessage}
        linkedTypes={linkedTypes}
        mutationDisabledReason={mutationDisabledReason}
        selectedKeywordId={selectedKeywordId}
        selectedKeywordLabel={selectedKeywordLabel}
        selectedKeywordOccurrenceId={selectedKeywordOccurrenceId}
        onAddAnimation={onAddAnimation}
        onDraftChange={(patch) => {
          if (!creationType) {
            return;
          }

          updateDraft(creationType, patch);
        }}
        onSelectKeyword={onSelectKeyword}
        onStartCreating={startCreating}
      />

      {mode === "editing-existing" && selectedAnimation ? (
        <fieldset
          disabled={Boolean(mutationDisabledReason)}
          style={{ display: "contents" }}
        >
          <AnimationExistingEditor
            animation={selectedAnimation}
            deleteDisabledReason={actionLinkedDeleteReason}
            previousEffectSummary={
              previousSelectedAnimation
                ? formatPreviousAnimationSummary(
                    previousSelectedAnimation,
                    ordinalLabelByAnimationId
                  )
                : null
            }
            startModeChangeDisabledReason={actionLinkedStartModeReason}
            onDeleteAnimation={onDeleteAnimation}
            onUpdateAnimation={onUpdateAnimation}
          />
        </fieldset>
      ) : null}

      {mode === "idle" ? (
        <AnimationPanelComposerEmpty hasAnimations={animations.length > 0} />
      ) : null}
    </section>
  );
}
import {
  createAnimationTimeline,
  getAnimationTimelineRoot
} from "@orbit/editor-core";
