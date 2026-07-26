import type {
  Deck,
  Slide,
  SpeakerNotesSuggestionMode,
  SpeakerNotesSuggestionResult,
} from "@orbit/shared/deck";
import type { MutableRefObject } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  createSpeakerNotesSuggestionJob,
  getSpeakerNotesLengthGuidance,
  waitForSpeakerNotesSuggestionJob
} from "../speakerNotesAssistant";
import type { PatchProducer } from "./useEditorPersistenceState";
import type { SpeakerNotesAssistantStatus } from "../components/SpeakerNotesAssistantDialog";
import { toEditorErrorMessage } from "../utils/editorFileValidation";
import {
  getSpeakerNotesDanglingOccurrenceSaveBlock,
  shouldPromptSpeakerNotesDraftDiscard,
  shouldPromptSpeakerNotesOverwrite
} from "../utils/speakerNotesDraft";

type CommitPatch = (patch: PatchProducer) => boolean;

export function useSpeakerNotesEditor(args: {
  commitPatch: CommitPatch;
  currentSlide: Slide | null;
  deck: Deck;
  flushPendingSaves: () => Promise<void>;
  onClearSelectedKeyword: () => void;
  onExpandPanel: () => void;
  persistedProjectId?: string;
  projectId: string;
  workingDeckRef: MutableRefObject<Deck>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftBase, setDraftBase] = useState("");
  const [editSlideId, setEditSlideId] = useState<string | null>(null);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] =
    useState<SpeakerNotesSuggestionMode>("naturalize");
  const [assistantStatus, setAssistantStatus] =
    useState<SpeakerNotesAssistantStatus>("idle");
  const [assistantResult, setAssistantResult] =
    useState<SpeakerNotesSuggestionResult | null>(null);
  const [assistantError, setAssistantError] = useState("");
  const [assistantSource, setAssistantSource] = useState<{
    baseVersion: number;
    notes: string;
    slideId: string;
  } | null>(null);

  const guidance = useMemo(
    () =>
      getSpeakerNotesLengthGuidance(
        isEditing ? draft : (args.currentSlide?.speakerNotes ?? ""),
        args.currentSlide?.aiNotes?.timingPlan
      ),
    [args.currentSlide?.aiNotes?.timingPlan, args.currentSlide?.speakerNotes, draft, isEditing]
  );
  const assistantSlide = assistantSource
    ? args.deck.slides.find((slide) => slide.slideId === assistantSource.slideId) ?? null
    : null;
  const assistantOccurrenceWarning = assistantSlide && assistantResult
    ? getSpeakerNotesDanglingOccurrenceSaveBlock(
        assistantSlide,
        assistantResult.suggestedNotes
      )?.message
    : undefined;

  function resetEditState(notes: string) {
    setIsEditing(false);
    setDraft(notes);
    setDraftBase(notes);
    setEditSlideId(null);
  }

  function confirmDiscardDraft() {
    if (!shouldPromptSpeakerNotesDraftDiscard({ draft, isEditing, savedDraftBase: draftBase })) {
      return true;
    }
    return typeof window === "undefined" || window.confirm(
      "저장하지 않은 발표 메모 수정 내용이 있습니다. 이동하면 초안이 사라집니다. 계속할까요?"
    );
  }

  function startEdit() {
    const currentNotes = args.currentSlide?.speakerNotes ?? "";
    args.onClearSelectedKeyword();
    args.onExpandPanel();
    setDraft(currentNotes);
    setDraftBase(currentNotes);
    setEditSlideId(args.currentSlide?.slideId ?? null);
    setIsEditing(true);
  }

  function openAssistant() {
    if (!args.currentSlide) return;
    const isSameSource =
      assistantSource?.slideId === args.currentSlide.slideId &&
      assistantSource.baseVersion === args.deck.version &&
      assistantSource.notes === args.currentSlide.speakerNotes;
    if (!isSameSource) {
      setAssistantSource({
        slideId: args.currentSlide.slideId,
        baseVersion: args.deck.version,
        notes: args.currentSlide.speakerNotes
      });
      setAssistantMode(args.currentSlide.speakerNotes.trim() ? "naturalize" : "draft");
      setAssistantStatus("idle");
      setAssistantResult(null);
      setAssistantError("");
    }
    setIsAssistantOpen(true);
  }

  async function generateSuggestion(options?: {
    mode?: SpeakerNotesSuggestionMode;
    slideId?: string;
  }) {
    const requestedSlideId = options?.slideId ?? assistantSource?.slideId;
    if (!requestedSlideId || assistantStatus === "running") return;

    setAssistantStatus("running");
    setAssistantResult(null);
    setAssistantError("");
    try {
      await args.flushPendingSaves();
      const requestDeck = args.workingDeckRef.current;
      const requestSlide = requestDeck.slides.find((slide) => slide.slideId === requestedSlideId);
      if (!requestSlide) throw new Error("현재 슬라이드를 찾을 수 없습니다.");

      const preferredMode = options?.mode ?? assistantMode;
      const requestMode = preferredMode === "icebreaker"
        ? "icebreaker"
        : requestSlide.speakerNotes.trim()
          ? preferredMode === "draft" ? "naturalize" : preferredMode
          : "draft";
      const source = {
        slideId: requestSlide.slideId,
        baseVersion: requestDeck.version,
        notes: requestSlide.speakerNotes
      };
      setAssistantSource(source);
      setAssistantMode(requestMode);

      const job = await createSpeakerNotesSuggestionJob(
        args.persistedProjectId ?? args.projectId,
        {
          deckId: requestDeck.deckId,
          slideId: requestSlide.slideId,
          baseVersion: requestDeck.version,
          mode: requestMode
        }
      );
      const result = await waitForSpeakerNotesSuggestionJob(job.jobId);
      if (result.slideId !== source.slideId || result.baseVersion !== source.baseVersion) {
        throw new Error("슬라이드가 변경되어 이 AI 제안을 사용할 수 없습니다.");
      }
      setAssistantResult(result);
      setAssistantStatus("succeeded");
    } catch (error) {
      setAssistantStatus("failed");
      setAssistantError(toEditorErrorMessage(error));
    }
  }

  function openAssistantAndGenerate(mode: SpeakerNotesSuggestionMode) {
    if (!args.currentSlide || assistantStatus === "running") return;
    const source = {
      slideId: args.currentSlide.slideId,
      baseVersion: args.deck.version,
      notes: args.currentSlide.speakerNotes
    };
    const requestMode = mode === "icebreaker"
      ? "icebreaker"
      : source.notes.trim() ? (mode === "draft" ? "naturalize" : mode) : "draft";
    setAssistantSource(source);
    setAssistantMode(requestMode);
    setAssistantStatus("idle");
    setAssistantResult(null);
    setAssistantError("");
    setIsAssistantOpen(true);
    void generateSuggestion({ mode: requestMode, slideId: source.slideId });
  }

  function applySuggestion() {
    if (!assistantResult || !assistantSource) return;
    const currentDeck = args.workingDeckRef.current;
    const targetSlide = currentDeck.slides.find(
      (slide) => slide.slideId === assistantSource.slideId
    );
    if (
      !targetSlide ||
      currentDeck.version !== assistantResult.baseVersion ||
      targetSlide.speakerNotes !== assistantSource.notes
    ) {
      setAssistantStatus("failed");
      setAssistantResult(null);
      if (targetSlide) {
        setAssistantSource({
          slideId: targetSlide.slideId,
          baseVersion: currentDeck.version,
          notes: targetSlide.speakerNotes
        });
        setAssistantMode(targetSlide.speakerNotes.trim() ? "naturalize" : "draft");
      }
      setAssistantError(
        "메모가 변경되어 이 제안을 적용할 수 없습니다. 새 제안을 만들어 주세요."
      );
      return;
    }

    args.onClearSelectedKeyword();
    setDraft(assistantResult.suggestedNotes);
    setDraftBase(assistantSource.notes);
    setEditSlideId(assistantSource.slideId);
    setIsEditing(true);
    setIsAssistantOpen(false);
  }

  function commitDraftIfDirty() {
    if (!shouldPromptSpeakerNotesDraftDiscard({ draft, isEditing, savedDraftBase: draftBase })) {
      return true;
    }

    const slideId = editSlideId;
    const targetSlide = args.workingDeckRef.current.slides.find((slide) => slide.slideId === slideId);
    if (!slideId || !targetSlide) {
      resetEditState(args.currentSlide?.speakerNotes ?? "");
      return false;
    }
    if (
      shouldPromptSpeakerNotesOverwrite({
        currentNotes: targetSlide.speakerNotes,
        draft,
        savedDraftBase: draftBase
      }) &&
      typeof window !== "undefined" &&
      !window.confirm("편집 중 발표 메모가 다른 작업으로 변경되었습니다. 현재 초안으로 덮어쓸까요?")
    ) {
      return false;
    }

    if (draft !== targetSlide.speakerNotes) {
      const danglingOccurrenceBlock = getSpeakerNotesDanglingOccurrenceSaveBlock(targetSlide, draft);
      if (danglingOccurrenceBlock) {
        if (typeof window !== "undefined") window.alert(danglingOccurrenceBlock.message);
        return false;
      }
      args.commitPatch((currentDeck) => ({
        deckId: currentDeck.deckId,
        baseVersion: currentDeck.version,
        source: "user",
        operations: [{ type: "update_speaker_notes", slideId, speakerNotes: draft }]
      }));
    }

    resetEditState(draft);
    return true;
  }

  function saveEdit() {
    if (!args.currentSlide) {
      resetEditState("");
      return;
    }
    const hasDirtyDraft = shouldPromptSpeakerNotesDraftDiscard({
      draft,
      isEditing,
      savedDraftBase: draftBase
    });
    if (!commitDraftIfDirty()) return;
    if (!hasDirtyDraft) resetEditState(args.currentSlide.speakerNotes);
  }

  useEffect(() => {
    setIsAssistantOpen(false);
    setAssistantStatus("idle");
    setAssistantResult(null);
    setAssistantError("");
    setAssistantSource(null);
  }, [args.projectId]);

  useEffect(() => {
    const currentNotes = args.currentSlide?.speakerNotes ?? "";
    if (!isEditing) {
      setDraft(currentNotes);
      setDraftBase(currentNotes);
      setEditSlideId(null);
      return;
    }
    if (!args.currentSlide || args.currentSlide.slideId !== editSlideId) {
      resetEditState(currentNotes);
      return;
    }
    if (currentNotes === draftBase) return;
    if (draft === draftBase) {
      setDraft(currentNotes);
      setDraftBase(currentNotes);
    }
  }, [args.currentSlide?.slideId, args.currentSlide?.speakerNotes, draft, draftBase, editSlideId, isEditing]);

  return {
    actions: {
      applySuggestion,
      cancelEdit: () => resetEditState(args.currentSlide?.speakerNotes ?? ""),
      closeAssistant: () => setIsAssistantOpen(false),
      commitDraftIfDirty,
      confirmDiscardDraft,
      generateSuggestion,
      openAssistant,
      openAssistantAndGenerate,
      resetEditState,
      saveEdit,
      setAssistantMode,
      setDraft,
      startEdit
    },
    state: {
      assistantError,
      assistantMode,
      assistantOccurrenceWarning,
      assistantResult,
      assistantSource,
      assistantStatus,
      draft,
      guidance,
      isAssistantOpen,
      isEditing
    }
  };
}
