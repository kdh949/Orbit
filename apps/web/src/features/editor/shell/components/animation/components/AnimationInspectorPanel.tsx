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
    animationTriggerSummaryByAnimationId = {},
    legacyKeywordAnimationIds = [],
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
    onRequestKeywordOccurrence,
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
  const legacyKeywordAnimationIdSet = new Set(legacyKeywordAnimationIds);
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
    ? "대본 키워드 action과 연결되어 시작 방식이 고정됩니다."
    : null;
  const deleteNoticeByAnimationId = Object.fromEntries(
    slideAnimations.flatMap((animation) => {
      const timelineRoot = getAnimationTimelineRoot(
        createAnimationTimeline({
          animations: slideAnimations,
          legacyOnClickAnimationIds: actionAnimationIdSet
        }),
        animation.animationId
      );
      const actionLinked = timelineRoot?.effects.some((candidate) =>
        actionAnimationIdSet.has(candidate.animationId)
      );
      const notices = [
        actionLinked ? "연결된 action과 재생 체인이 함께 삭제됩니다." : null,
        legacyKeywordAnimationIdSet.has(animation.animationId)
          ? "기존 키워드 트리거입니다. 대본 위치를 다시 선택해 연결하세요."
          : null
      ].filter((notice): notice is string => Boolean(notice));
      return notices.length > 0 ? [[animation.animationId, notices.join(" ")]] : [];
    })
  );

  if (!element) {
    return slideAnimations.length > 0 ? (
      <section className="property-panel animation-inspector-panel">
        <AnimationSlideOverview
          animations={slideAnimations}
          deleteDisabledReason={mutationDisabledReason}
          elements={slideElements}
          focusedAnimationId={preferredAnimationId}
          ordinalLabelByAnimationId={ordinalLabelByAnimationId}
          deleteNoticeByAnimationId={deleteNoticeByAnimationId}
          showIds={showIds}
          onDeleteAnimation={onDeleteAnimation}
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
        deleteDisabledReason={mutationDisabledReason}
        deleteNoticeByAnimationId={deleteNoticeByAnimationId}
        ordinalLabelByAnimationId={ordinalLabelByAnimationId}
        selectedAnimationId={selectedAnimationId}
        onDeleteAnimation={onDeleteAnimation}
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
        onRequestKeywordOccurrence={onRequestKeywordOccurrence}
        onStartCreating={startCreating}
      />

      {mode === "editing-existing" && selectedAnimation ? (
        <fieldset
          disabled={Boolean(mutationDisabledReason)}
          style={{ display: "contents" }}
        >
          <AnimationExistingEditor
            animation={selectedAnimation}
            deleteNotice={deleteNoticeByAnimationId[selectedAnimation.animationId]}
            previousEffectSummary={
              previousSelectedAnimation
                ? formatPreviousAnimationSummary(
                    previousSelectedAnimation,
                    ordinalLabelByAnimationId
                  )
                : null
            }
            startModeChangeDisabledReason={actionLinkedStartModeReason}
            triggerSummary={
              animationTriggerSummaryByAnimationId[selectedAnimation.animationId]
            }
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
} from "@orbit/editor-core/playback";
