import type { DeckAnimation } from "@orbit/shared/deck";

import {
  buildAnimationSummary,
  getLinkedSupportedAnimationTypes
} from "../utils/animationUi";
import { useAnimationDrafts } from "./useAnimationDrafts";
import { useAnimationPanelState } from "./useAnimationPanelState";

export function useAnimationInspectorModel(
  animations: DeckAnimation[],
  preferredAnimationId?: string | null
) {
  const { draftByType, updateDraft } = useAnimationDrafts();
  const panelState = useAnimationPanelState(animations, preferredAnimationId);
  const summary = buildAnimationSummary(animations, {
    emptyLabel: "미설정",
    multiDetail: (primaryLabel, count) =>
      `${primaryLabel} 포함 ${count}개의 애니메이션이 연결되어 있습니다.`,
    multiLabel: (count) => `${count}개 연결`
  });

  return {
    ...panelState,
    draftByType,
    linkedTypes: getLinkedSupportedAnimationTypes(animations),
    summary,
    updateDraft
  };
}
