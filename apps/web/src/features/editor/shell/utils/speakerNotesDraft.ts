import { findDanglingKeywordOccurrenceActions } from "@orbit/editor-core/keywords";
import type { Slide } from "@orbit/shared";

export function shouldPromptSpeakerNotesDraftDiscard(input: {
  draft: string;
  isEditing: boolean;
  savedDraftBase: string;
}) {
  return input.isEditing && input.draft !== input.savedDraftBase;
}

export function shouldPromptSpeakerNotesOverwrite(input: {
  currentNotes: string;
  draft: string;
  savedDraftBase: string;
}) {
  return (
    input.currentNotes !== input.savedDraftBase &&
    input.draft !== input.currentNotes
  );
}

export const danglingKeywordOccurrenceSaveMessage =
  "발표 메모 수정으로 기존 키워드 트리거 위치를 찾을 수 없습니다. 연결된 애니메이션 또는 다음 슬라이드 트리거를 새 위치에 다시 연결한 뒤 저장하세요.";

export function getSpeakerNotesDanglingOccurrenceSaveBlock(
  slide: Pick<Slide, "slideId" | "speakerNotes" | "keywords" | "actions">,
  nextSpeakerNotes: string
) {
  const danglingActions = findDanglingKeywordOccurrenceActions(
    slide,
    nextSpeakerNotes
  );

  return danglingActions.length > 0
    ? {
        danglingActions,
        message: danglingKeywordOccurrenceSaveMessage
      }
    : null;
}
