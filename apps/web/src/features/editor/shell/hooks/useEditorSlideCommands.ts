import {
  createAddAnimationPatch,
  createAddAnimationWithKeywordTriggerPatch,
  createAnimationTimeline,
  createDefaultAnimation,
  createDeleteAnimationPatch,
  createKeyword,
  createReplaceKeywordsPatch,
  createUpdateAnimationPatch,
  createUpdateElementPropsPatch,
  createUpdateSlideTransitionPatch,
  createUpsertAdvanceSlideKeywordActionPatch,
  findKeywordByTerm,
  getAnimationTimelineRoot
} from "../../../../../../../packages/editor-core/src/index";
import { createKeywordOccurrenceId } from "@orbit/shared";
import type {
  Deck,
  DeckAnimation,
  DeckPatch,
  Keyword,
  Slide,
  SlideTransition
} from "@orbit/shared";
import type { MutableRefObject } from "react";

import type { EditorShellUiUpdater } from "../editorShellUiStore";
import { createThemeCascadePatch } from "../utils/themeCascadePatch";
import type { PatchProducer } from "./useEditorPersistenceState";
import {
  getAnimationMutationDisabledReason,
  getAnimationTypeMutationDisabledReason,
  getTransitionMutationDisabledReason
} from "../utils/motionEditingPolicy";

type CommitPatch = (patch: DeckPatch | PatchProducer, baseDeck?: Deck) => boolean;

export function useEditorSlideCommands(args: {
  commitPatch: CommitPatch;
  currentSlide: Slide | null;
  currentSlideKeywordUsage: Record<
    string,
    { advancesSlide: boolean; animationIds: string[] }
  >;
  deck: Deck;
  selectedKeywordId: string | null;
  selectedKeywordOccurrenceKey: string | null;
  setAnimationPanelFocusedAnimationId: (updater: EditorShellUiUpdater<string | null>) => void;
  setLastPatchLabel: (label: string) => void;
  setSelectedKeywordId: (updater: EditorShellUiUpdater<string | null>) => void;
  setSelectedKeywordOccurrenceKey: (updater: EditorShellUiUpdater<string | null>) => void;
  workingDeckRef: MutableRefObject<Deck>;
}) {
  function changeElementProps(slideId: string, elementId: string, props: Record<string, unknown>) {
    args.commitPatch((deck) => createUpdateElementPropsPatch(deck, slideId, elementId, props));
  }

  function changeSlideStyle(slideId: string, style: {
    backgroundColor?: string | null;
    textColor?: string | null;
    accentColor?: string | null;
  }) {
    args.commitPatch((deck) => ({
      deckId: deck.deckId,
      baseVersion: deck.version,
      source: "user",
      operations: [{ type: "update_slide_style", slideId, style }]
    }));
  }

  function changeTheme(theme: Record<string, unknown>) {
    args.commitPatch((deck) => createThemeCascadePatch(deck, theme));
  }

  function replaceKeywords(slideId: string, update: (keywords: Keyword[]) => Keyword[]) {
    args.commitPatch((deck) => {
      const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
      if (!slide) throw new Error(`slide not found: ${slideId}`);
      return createReplaceKeywordsPatch(deck, slideId, update(slide.keywords));
    });
  }

  function clearSelectedKeyword() {
    args.setSelectedKeywordId(null);
    args.setSelectedKeywordOccurrenceKey(null);
  }

  function selectKeyword(keywordId: string, occurrenceKey: string | null = null) {
    const shouldClear = args.selectedKeywordId === keywordId && args.selectedKeywordOccurrenceKey === occurrenceKey;
    args.setSelectedKeywordId(shouldClear ? null : keywordId);
    args.setSelectedKeywordOccurrenceKey(shouldClear ? null : occurrenceKey);
  }

  function deleteSelectedKeyword(slideId: string, keywordId: string) {
    const usage = args.currentSlideKeywordUsage[keywordId];
    const hasLinkedActions = Boolean(usage?.advancesSlide) || (usage?.animationIds.length ?? 0) > 0;
    if (hasLinkedActions && typeof window !== "undefined" && !window.confirm(
      "연결된 애니메이션 또는 다음 슬라이드 트리거가 함께 제거될 수 있습니다. 삭제할까요?"
    )) return;
    replaceKeywords(slideId, (keywords) => keywords.filter((keyword) => keyword.keywordId !== keywordId));
    clearSelectedKeyword();
  }

  function selectSpeakerNotesKeyword(rawValue: string, start: number) {
    if (!args.currentSlide) return null;
    const matchedKeyword = findKeywordByTerm(args.currentSlide, rawValue);
    if (matchedKeyword) {
      const occurrenceKey = createKeywordOccurrenceId(
        args.currentSlide.slideId,
        matchedKeyword.keywordId,
        start,
        start + rawValue.length
      );
      selectKeyword(
        matchedKeyword.keywordId,
        occurrenceKey
      );
      return {
        keywordId: matchedKeyword.keywordId,
        occurrenceKey
      };
    }
    const nextKeyword = createKeyword(args.workingDeckRef.current, rawValue, { required: false });
    const occurrenceKey = createKeywordOccurrenceId(args.currentSlide.slideId, nextKeyword.keywordId, start, start + rawValue.length);
    args.setSelectedKeywordId(nextKeyword.keywordId);
    args.setSelectedKeywordOccurrenceKey(occurrenceKey);
    replaceKeywords(args.currentSlide.slideId, (keywords) => [...keywords, nextKeyword]);
    return {
      keywordId: nextKeyword.keywordId,
      occurrenceKey
    };
  }

  function toggleKeywordRequired(slideId: string, keywordId: string, occurrenceKey: string | null = null) {
    const keyword =
      args.workingDeckRef.current.slides
        .find((candidate) => candidate.slideId === slideId)
        ?.keywords.find((candidate) => candidate.keywordId === keywordId) ??
      args.currentSlide?.keywords.find((candidate) => candidate.keywordId === keywordId);
    if (!occurrenceKey && !keyword?.required) {
      if (typeof window !== "undefined") window.alert(
        "반복되는 단어일 수 있습니다. 발표 메모에서 필수 발화로 표시할 단어 위치를 선택하세요."
      );
      return;
    }
    replaceKeywords(slideId, (keywords) => keywords.map((candidate) => {
      if (candidate.keywordId !== keywordId) return candidate;
      if (!occurrenceKey) return { ...candidate, required: false, requiredOccurrenceIds: [] };
      const ids = candidate.requiredOccurrenceIds ?? [];
      const nextIds = ids.includes(occurrenceKey)
        ? ids.filter((id) => id !== occurrenceKey)
        : [...ids, occurrenceKey];
      return { ...candidate, required: nextIds.length > 0, requiredOccurrenceIds: nextIds };
    }));
  }

  function toggleAdvanceSlideKeyword(
    slideId: string,
    keywordId: string,
    enabled: boolean,
    occurrenceKey: string | null = args.selectedKeywordOccurrenceKey
  ) {
    if (enabled && !occurrenceKey) {
      if (typeof window !== "undefined") window.alert(
        "반복되는 단어일 수 있습니다. 발표 메모에서 실제로 트리거할 단어 위치를 선택하세요."
      );
      return;
    }
    const patch = createUpsertAdvanceSlideKeywordActionPatch(
      args.workingDeckRef.current,
      slideId,
      keywordId,
      enabled,
      occurrenceKey
    );
    if (patch) args.commitPatch(patch);
  }

  function addAnimation(
    slideId: string,
    elementId: string,
    keywordId?: string | null,
    keywordOccurrenceId?: string | null,
    draft?: Partial<
      Pick<DeckAnimation, "delayMs" | "durationMs" | "startMode" | "type">
    >
  ) {
    if (!allowMotionMutation(slideId, "animation")) return;
    const typeReason = draft?.type
      ? getAnimationTypeMutationDisabledReason(draft.type)
      : null;
    if (typeReason) {
      args.setLastPatchLabel(typeReason);
      return;
    }
    let createdAnimationId: string | null = null;
    args.commitPatch((deck) => {
      const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
      if (!slide) throw new Error(`slide not found: ${slideId}`);
      const animation = { ...createDefaultAnimation(deck, slide, elementId), ...draft };
      createdAnimationId = animation.animationId;
      return keywordId
        ? createAddAnimationWithKeywordTriggerPatch(deck, slideId, animation, keywordId, keywordOccurrenceId)
        : createAddAnimationPatch(deck, slideId, animation);
    });
    if (createdAnimationId) args.setAnimationPanelFocusedAnimationId(createdAnimationId);
  }

  function updateAnimation(slideId: string, animationId: string, animation: Partial<DeckAnimation>) {
    if (!allowMotionMutation(slideId, "animation")) return;
    const slide = args.workingDeckRef.current.slides.find(
      (candidate) => candidate.slideId === slideId
    );
    if (
      animation.startMode !== undefined &&
      slide &&
      isAnimationInActionLinkedRoot(slide, animationId)
    ) {
      args.setLastPatchLabel(
        "action과 연결된 재생 체인의 시작 방식은 변경할 수 없습니다."
      );
      return;
    }
    const typeReason = animation.type
      ? getAnimationTypeMutationDisabledReason(animation.type)
      : null;
    if (typeReason) {
      args.setLastPatchLabel(typeReason);
      return;
    }
    args.commitPatch((deck) => createUpdateAnimationPatch(deck, slideId, animationId, animation));
  }

  function deleteAnimation(slideId: string, animationId: string) {
    if (!allowMotionMutation(slideId, "animation")) return;
    const slide = args.workingDeckRef.current.slides.find(
      (candidate) => candidate.slideId === slideId
    );
    if (slide && isAnimationInActionLinkedRoot(slide, animationId)) {
      args.setLastPatchLabel(
        "action과 연결된 재생 체인은 action을 먼저 제거한 뒤 삭제할 수 있습니다."
      );
      return;
    }
    args.commitPatch((deck) => createDeleteAnimationPatch(deck, slideId, animationId));
  }

  function updateSlideTransition(
    slideId: string,
    transition: SlideTransition | null
  ) {
    if (!allowMotionMutation(slideId, "transition")) return;
    args.commitPatch((deck) =>
      createUpdateSlideTransitionPatch(deck, slideId, transition)
    );
  }

  function allowMotionMutation(
    slideId: string,
    scope: "animation" | "transition"
  ) {
    const deck = args.workingDeckRef.current;
    const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
    if (!slide) return false;
    const reason =
      scope === "transition"
        ? getTransitionMutationDisabledReason(deck, slide)
        : getAnimationMutationDisabledReason(deck, slide);
    if (!reason) return true;
    args.setLastPatchLabel(reason);
    return false;
  }

  return {
    addAnimation,
    changeElementProps,
    changeSlideStyle,
    changeTheme,
    clearSelectedKeyword,
    deleteAnimation,
    deleteSelectedKeyword,
    selectKeyword,
    selectSpeakerNotesKeyword,
    toggleAdvanceSlideKeyword,
    toggleKeywordRequired,
    updateAnimation,
    updateSlideTransition
  };
}

function isAnimationInActionLinkedRoot(slide: Slide, animationId: string) {
  const actionAnimationIds = slide.actions.flatMap((action) =>
    action.effect.kind === "play-animation"
      ? [action.effect.animationId]
      : []
  );
  if (actionAnimationIds.length === 0) return false;
  const actionAnimationIdSet = new Set(actionAnimationIds);
  const timeline = createAnimationTimeline({
    animations: slide.animations,
    legacyOnClickAnimationIds: actionAnimationIds
  });
  const root = getAnimationTimelineRoot(timeline, animationId);
  return (
    root?.effects.some((animation) =>
      actionAnimationIdSet.has(animation.animationId)
    ) ?? false
  );
}
