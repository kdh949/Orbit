import { applyDeckPatch } from "../../../../../../../packages/editor-core/src/index";
import type { ApplyDesignAgentProposalResponse, Deck, DeckPatch } from "@orbit/shared";
import { useQueryClient } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { useEffect, useRef, useState } from "react";

import {
  appendProjectDeckPatchAck,
  buildPatchBatch,
  consumeScheduledUndoRedoPersistLabel,
  fetchProjectDeck,
  flushEditorPersistenceBeforeManualAction,
  hasPendingEditorChanges,
  isDeckRequestErrorWithCode,
  putProjectDeckWithConflictRecovery,
  resolvePatchInput,
  withSaveErrorCode
} from "../api/deckPersistenceApi";
import {
  mergeDeckIntoQueryCache,
  shouldApplyManualSaveResult,
  shouldHydrateDeckFromQuery
} from "../utils/deckState";
import {
  appendAppliedDesignProposalHistory,
  resolveHistoryNavigation,
  type HistoryEntry
} from "../utils/editorHistory";
import { resolveSelectedSlideId } from "../slideRailModel";
import { toEditorErrorMessage } from "../utils/editorFileValidation";
import { syncProjectTitleQueryCache } from "../utils/projectTitleCache";
import { normalizeDeckAssetUrls } from "../utils/slideRenderUtils";
import {
  createEditorSaveRetryCoordinator,
  type EditorSaveRetryReason
} from "../utils/editorSaveRetry";
import {
  useEditorPersistenceState,
  type PatchProducer,
  type SaveErrorCode
} from "./useEditorPersistenceState";

type HistoryCallbacks = {
  confirmDiscard: () => boolean;
  onNavigate: (deck: Deck, slideId: string | null) => void;
  refreshThumbnails: (deck: Deck) => void;
  resetNotes: (notes: string) => void;
};

export function useEditorDocumentController(args: {
  currentSlideId: string | null;
  loadedDeck: Deck;
  onHydratedProjectChange: () => void;
  onManualSaveStart: () => void;
  persistedDeck?: Deck;
  projectId: string;
  refetchDeck: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [deck, setDeck] = useState<Deck>(args.loadedDeck);
  const [lastPatchLabel, setLastPatchLabel] = useState("편집 없음");
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const undoRedoPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRedoPersistLabelRef = useRef<string | null>(null);
  const saveRetryCoordinatorRef = useRef<
    ReturnType<typeof createEditorSaveRetryCoordinator> | null
  >(null);
  const persistence = useEditorPersistenceState(args.loadedDeck);
  const {
    applyAckedPersistedDeck,
    applyOptimisticWorkingDeck,
    hasHydratedPersistedBaseRef,
    hasUnackedLocalChangesRef,
    isSaveFlushInFlightRef,
    lastAckedDeckRef,
    markHydratedPersistedDeck,
    pendingPatchInputsRef,
    persistedBaseDeckRef,
    replaceWorkingDeck,
    saveQueueRef,
    setSaveError,
    setLastSavedAt,
    setSaveState,
    workingDeckRef
  } = persistence;

  if (!saveRetryCoordinatorRef.current) {
    saveRetryCoordinatorRef.current = createEditorSaveRetryCoordinator({
      flushNext: () => flushPendingSaveBatch(),
      hasPending: () => pendingPatchInputsRef.current.length > 0,
      onFailure: (error) => {
        isSaveFlushInFlightRef.current = false;
        setLastPatchLabel(`저장 실패 · ${toEditorErrorMessage(error)}`);
        setSaveState("error");
        setSaveError(
          (error as { saveErrorCode?: SaveErrorCode })?.saveErrorCode ?? "auto-save-failed",
          toEditorErrorMessage(error)
        );
        void args.refetchDeck();
      },
      onStart: () => {
        setSaveState("auto-saving");
        setSaveError(null, null);
      },
      onSuccess: () => {
        isSaveFlushInFlightRef.current = false;
      }
    });
  }

  useEffect(() => {
    const persistedDeck = args.persistedDeck;
    if (!persistedDeck) return;
    syncProjectTitleQueryCache(queryClient, persistedDeck);
    if (!shouldHydrateDeckFromQuery({
      currentDeck: workingDeckRef.current,
      nextDeck: persistedDeck,
      hasHydratedPersistedDeck: hasHydratedPersistedBaseRef.current,
      hasLocalOptimisticChanges: hasUnackedLocalChangesRef.current
    })) return;

    const shouldResetEditorState =
      !hasHydratedPersistedBaseRef.current ||
      workingDeckRef.current.deckId !== persistedDeck.deckId ||
      workingDeckRef.current.projectId !== persistedDeck.projectId;
    markHydratedPersistedDeck(persistedDeck, setDeck);
    if (!shouldResetEditorState) return;
    setUndoStack([]);
    setRedoStack([]);
    args.onHydratedProjectChange();
  }, [args.persistedDeck]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasPendingEditorChanges({
        hasUnackedLocalChanges: hasUnackedLocalChangesRef.current,
        pendingPatchCount: pendingPatchInputsRef.current.length,
        saveState: persistence.saveState
      })) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [persistence.saveState]);

  useEffect(() => {
    function handleOnline() {
      if (pendingPatchInputsRef.current.length === 0) return;
      void queuePendingSaveRetry("online").catch(() => undefined);
    }

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  useEffect(() => () => {
    if (undoRedoPersistTimerRef.current) clearTimeout(undoRedoPersistTimerRef.current);
  }, []);

  function hasUnsavedChanges() {
    return hasPendingEditorChanges({
      hasUnackedLocalChanges: hasUnackedLocalChangesRef.current,
      pendingPatchCount: pendingPatchInputsRef.current.length,
      saveState: persistence.saveState
    });
  }

  function applyPersistedDeck(nextDeck: Deck) {
    queryClient.setQueryData(["deck", args.projectId], nextDeck);
    applyAckedPersistedDeck(nextDeck);
    flushSync(() => setDeck(nextDeck));
  }

  function hydrateFromServer(nextDeck: Deck) {
    queryClient.setQueryData(["deck", args.projectId], nextDeck);
    markHydratedPersistedDeck(nextDeck, setDeck);
  }

  function applyDesignProposal(
    response: ApplyDesignAgentProposalResponse,
    onResetSelection: () => void
  ) {
    const previousDeck = workingDeckRef.current;
    hydrateFromServer(response.deck);
    setLastSavedAt(response.changeRecord.createdAt);
    setUndoStack((current) => appendAppliedDesignProposalHistory({
      currentDeck: previousDeck,
      currentSlideId: args.currentSlideId,
      undoStack: current
    }));
    setRedoStack([]);
    onResetSelection();
    setLastPatchLabel(`AI design · v${response.deck.version}`);
    setSaveState("auto-saved");
    setSaveError(null, null);
  }

  async function flushPendingSaveBatch() {
    if (pendingPatchInputsRef.current.length === 0) return;
    setSaveState("auto-saving");
    isSaveFlushInFlightRef.current = true;
    const activeProjectId = args.persistedDeck?.projectId ?? workingDeckRef.current.projectId;
    if (!activeProjectId) {
      throw withSaveErrorCode(new Error("저장할 프로젝트를 찾지 못했습니다."), "missing-project");
    }
    const basePersistedDeck = persistedBaseDeckRef.current ?? args.persistedDeck;
    if (!basePersistedDeck) {
      throw withSaveErrorCode(
        new Error("최신 저장 상태를 찾지 못했습니다. 다시 불러온 뒤 저장해 주세요."),
        "missing-persisted-base"
      );
    }

    const batchInputs = pendingPatchInputsRef.current.splice(0);
    let recoveredConflict = false;
    try {
      let buildResult = buildPatchBatch(basePersistedDeck, batchInputs);
      let persistedDeck: Deck;
      try {
        persistedDeck = await appendProjectDeckPatchAck(activeProjectId, basePersistedDeck, buildResult.patch);
      } catch (error) {
        if (!isDeckRequestErrorWithCode(error, "STALE_BASE_VERSION")) throw error;
        const latestDeck = await fetchProjectDeck(activeProjectId);
        if (!latestDeck) throw new Error("최신 저장 상태를 다시 불러오지 못했습니다. 다시 시도해 주세요.");
        recoveredConflict = true;
        persistedBaseDeckRef.current = latestDeck;
        buildResult = buildPatchBatch(latestDeck, batchInputs);
        persistedDeck = await appendProjectDeckPatchAck(activeProjectId, latestDeck, buildResult.patch);
      }

      persistedBaseDeckRef.current = persistedDeck;
      setLastSavedAt(new Date().toISOString());
      syncProjectTitleQueryCache(queryClient, persistedDeck);
      queryClient.setQueryData(["deck", args.projectId], (current?: Deck) =>
        mergeDeckIntoQueryCache(current, persistedDeck)
      );
      if (shouldApplyManualSaveResult({ snapshotDeck: persistedDeck, currentDeck: workingDeckRef.current })) {
        applyAckedPersistedDeck(persistedDeck);
        setSaveState(recoveredConflict ? "conflict-recovered" : "auto-saved");
        setSaveError(null, null);
      }
    } catch (error) {
      if (recoveredConflict && error instanceof Error) withSaveErrorCode(error, "conflict-recovery-failed");
      pendingPatchInputsRef.current = [...batchInputs, ...pendingPatchInputsRef.current];
      throw error;
    }
  }

  function queuePendingSaveRetry(reason: EditorSaveRetryReason) {
    const attempt = saveRetryCoordinatorRef.current!.retry(reason);
    saveQueueRef.current = attempt;
    return attempt;
  }

  async function persistUndoRedoDeckSnapshot(label: string) {
    const activeProjectId = args.persistedDeck?.projectId ?? workingDeckRef.current.projectId;
    if (!activeProjectId) {
      throw withSaveErrorCode(
        new Error("??ν븷 ?꾨줈?앺듃瑜?李얠? 紐삵뻽?듬땲??"),
        "missing-project"
      );
    }
    setSaveState("auto-saving");
    const snapshotDeck = structuredClone(normalizeDeckAssetUrls(workingDeckRef.current));
    const persistResult = await putProjectDeckWithConflictRecovery( {
      baseVersion: persistedBaseDeckRef.current?.version ?? snapshotDeck.version,
      deck: snapshotDeck,
      projectId: activeProjectId,
    });
    const persistedDeck = persistResult.deck;
    syncProjectTitleQueryCache(queryClient, persistedDeck);
    if (
      pendingPatchInputsRef.current.length > 0 ||
      !shouldApplyManualSaveResult({ snapshotDeck, currentDeck: workingDeckRef.current })
    ) {
      queryClient.setQueryData(["deck", args.projectId], (current?: Deck) =>
        mergeDeckIntoQueryCache(current, persistedDeck)
      );
      persistedBaseDeckRef.current = persistedDeck;
      lastAckedDeckRef.current = persistedDeck;
      hasHydratedPersistedBaseRef.current = true;
      setLastSavedAt(new Date().toISOString());
      setSaveState("auto-pending");
      setSaveError(null, null);
      return;
    }
    applyPersistedDeck(persistedDeck);
    setLastSavedAt(new Date().toISOString());
    setSaveState(
      persistResult.recoveredConflict ? "conflict-recovered" :"auto-saved",);
    setSaveError(null, null);
    setLastPatchLabel(`${label} · v${persistedDeck.version}`);
  }

  function queueUndoRedoPersist(label: string) {
    isSaveFlushInFlightRef.current = true;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => persistUndoRedoDeckSnapshot(label))
      .finally(() => {
        isSaveFlushInFlightRef.current = false;
        undoRedoPersistTimerRef.current = null;
      });
    return saveQueueRef.current;
  }

  async function flushScheduledUndoRedoPersist() {
    const label = consumeScheduledUndoRedoPersistLabel({
      clearTimer: clearTimeout,
      labelRef: undoRedoPersistLabelRef,
      timerRef: undoRedoPersistTimerRef
    });
    if (!label) return;
    try {
      await queueUndoRedoPersist(label);
    } catch (error) {
      undoRedoPersistLabelRef.current = label;
      throw error;
    }
  }

  function scheduleUndoRedoPersist(label: string) {
    consumeScheduledUndoRedoPersistLabel({
      clearTimer: clearTimeout,
      labelRef: undoRedoPersistLabelRef,
      timerRef: undoRedoPersistTimerRef
    });
    pendingPatchInputsRef.current = [];
    setSaveState("auto-pending");
    setSaveError(null, null);
    undoRedoPersistLabelRef.current = label;
    undoRedoPersistTimerRef.current = setTimeout(() => {
      undoRedoPersistTimerRef.current = null;
      undoRedoPersistLabelRef.current = null;
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => persistUndoRedoDeckSnapshot(label))
        .catch((error: unknown) => {
          setLastPatchLabel(`저장 실패 · ${toEditorErrorMessage(error)}`);
          setSaveState("error");
          setSaveError(
            (error as { saveErrorCode?: SaveErrorCode })?.saveErrorCode ?? "auto-save-failed",
            toEditorErrorMessage(error)
          );
          void args.refetchDeck();
        })
        .finally(() => {
          isSaveFlushInFlightRef.current = false;
          undoRedoPersistTimerRef.current = null;
        });
    }, 2000);
  }

  async function flush() {
    await flushEditorPersistenceBeforeManualAction({
      flushPendingSaveBatch,
      flushScheduledUndoRedoPersist,
      hasPendingPatchInputs: () => pendingPatchInputsRef.current.length > 0,
      waitForSaveQueue: () => saveQueueRef.current.catch(() => undefined)
    });
  }

  async function save(commitPendingNotes: () => boolean | undefined) {
    const activeProjectId = workingDeckRef.current.projectId || args.persistedDeck?.projectId;
    if (!activeProjectId) {
      setSaveState("error");
      setSaveError("missing-project", "저장할 프로젝트를 찾지 못했습니다.");
      return false;
    }
    if (!commitPendingNotes()) return;
    setSaveState("manual-saving");
    setSaveError(null, null);
    args.onManualSaveStart();
    try {
      await flush();
      const persistedDeck = persistedBaseDeckRef.current ?? args.persistedDeck;
      if (!persistedDeck) {
        throw withSaveErrorCode(
          new Error("최신 저장 상태를 찾지 못했습니다. 다시 불러온 뒤 저장해 주세요."),
          "missing-persisted-base"
        );
      }
      setLastSavedAt(new Date().toISOString());
      if (!shouldApplyManualSaveResult({ snapshotDeck: persistedDeck, currentDeck: workingDeckRef.current })) {
        setLastPatchLabel("수동 저장 · 편집 변경 감지");
        setSaveState("auto-pending");
        return false;
      }
      setLastPatchLabel(`수동 저장 · v${persistedDeck.version}`);
      setSaveState("manual-saved");
      setSaveError(null, null);
      return true;
    } catch (error) {
      setLastPatchLabel(`저장 실패 · ${toEditorErrorMessage(error)}`);
      setSaveState("error");
      setSaveError("auto-save-failed", toEditorErrorMessage(error));
      void args.refetchDeck();
      return false;
    }
  }

  function commitPatch(
    patchInput: DeckPatch | PatchProducer,
    baseDeck: Deck = workingDeckRef.current
  ) {
    const patch = resolvePatchInput(baseDeck, patchInput);
    const result = applyDeckPatch(baseDeck, patch);
    if (!result.ok) {
      setLastPatchLabel(`실패 · ${result.error.code}`);
      setSaveState("error");
      setSaveError("auto-save-failed", "편집 내용을 적용하지 못했습니다. 다시 시도해 주세요.");
      return false;
    }
    applyOptimisticWorkingDeck(result.deck);
    setSaveState("auto-pending");
    setSaveError(null, null);
    setUndoStack((current) => [
      ...current.slice(-49),
      {
        deck: baseDeck,
        slideId: resolveSelectedSlideId(baseDeck.slides, args.currentSlideId)
      }
    ]);
    setRedoStack([]);
    setDeck(result.deck);
    setLastPatchLabel(`${result.changeRecord.operations[0]?.type ?? "patch"} · v${result.metadata.nextVersion}`);
    if (!args.persistedDeck?.projectId) return true;

    queryClient.setQueryData(["deck", args.projectId], (current?: Deck) =>
      mergeDeckIntoQueryCache(current, result.deck)
    );
    pendingPatchInputsRef.current.push(patchInput);
    void queuePendingSaveRetry("auto").catch(() => undefined);
    return true;
  }

  function undo(callbacks: HistoryCallbacks) {
    if (undoStack.length === 0 || !callbacks.confirmDiscard()) return false;
    const transition = resolveHistoryNavigation({
      currentDeck: workingDeckRef.current,
      currentSlideId: args.currentSlideId,
      stack: undoStack
    });
    if (!transition) return false;
    const previous = transition.targetEntry;
    const previousSlide = previous.deck.slides.find(
      (slide) => slide.slideId === transition.targetSlideId
    );
    callbacks.resetNotes(previousSlide?.speakerNotes ?? "");
    replaceWorkingDeck(previous.deck);
    setUndoStack(transition.nextStack);
    setRedoStack((current) => [...current, transition.currentEntry]);
    setDeck(previous.deck);
    callbacks.refreshThumbnails(previous.deck);
    callbacks.onNavigate(previous.deck, transition.targetSlideId);
    queryClient.setQueryData(["deck", args.projectId], (current?: Deck) =>
      mergeDeckIntoQueryCache(current, previous.deck)
    );
    setLastPatchLabel(`undo · v${previous.deck.version}`);
    scheduleUndoRedoPersist("undo");
    return true;
  }

  function redo(callbacks: HistoryCallbacks) {
    if (redoStack.length === 0 || !callbacks.confirmDiscard()) return;
    const transition = resolveHistoryNavigation({
      currentDeck: workingDeckRef.current,
      currentSlideId: args.currentSlideId,
      stack: redoStack
    });
    if (!transition) return;
    const next = transition.targetEntry;
    const nextSlide = next.deck.slides.find(
      (slide) => slide.slideId === transition.targetSlideId
    );
    callbacks.resetNotes(nextSlide?.speakerNotes ?? "");
    setRedoStack(transition.nextStack);
    setUndoStack((current) => [...current.slice(-49), transition.currentEntry]);
    replaceWorkingDeck(next.deck);
    setDeck(next.deck);
    callbacks.refreshThumbnails(next.deck);
    callbacks.onNavigate(next.deck, transition.targetSlideId);
    queryClient.setQueryData(["deck", args.projectId], (current?: Deck) =>
      mergeDeckIntoQueryCache(current, next.deck)
    );
    setLastPatchLabel(`redo · v${next.deck.version}`);
    scheduleUndoRedoPersist("redo");
  }

  return {
    actions: {
      applyDesignProposal,
      applyPersistedDeck,
      commitPatch,
      flush,
      flushPendingSaveBatch,
      flushScheduledUndoRedoPersist,
      hasUnsavedChanges,
      hydrateFromServer,
      redo,
      save,
      setLastPatchLabel,
      setLastSavedAt,
      setRedoStack,
      setSaveError,
      setSaveState,
      setUndoStack,
      undo
    },
    refs: {
      pendingPatchInputsRef,
      persistedBaseDeckRef,
      saveQueueRef,
      workingDeckRef
    },
    state: {
      deck,
      lastPatchLabel,
      redoStack,
      saveErrorCode: persistence.saveErrorCode,
      saveErrorMessage: persistence.saveErrorMessage,
      saveState: persistence.saveState,
      lastSavedAt: persistence.lastSavedAt,
      undoStack
    }
  };
}
