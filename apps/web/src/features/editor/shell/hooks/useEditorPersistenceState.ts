import type { Deck, DeckPatch } from "@orbit/shared/deck";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useRef, useState } from "react";

export type SaveState =
  | "idle"
  | "auto-pending"
  | "auto-saving"
  | "auto-saved"
  | "manual-saving"
  | "manual-saved"
  | "conflict-recovered"
  | "error";
export type SaveErrorCode =
  | "missing-project"
  | "missing-persisted-base"
  | "manual-render-failed"
  | "auto-save-failed"
  | "conflict-recovery-failed"
  | "rehearsal-blocked"
  | "rehearsal-save-failed";
export type PatchProducer = (deck: Deck) => DeckPatch;

type EditorPersistenceState = {
  workingDeckRef: MutableRefObject<Deck>;
  persistedBaseDeckRef: MutableRefObject<Deck | null>;
  lastAckedDeckRef: MutableRefObject<Deck | null>;
  saveQueueRef: MutableRefObject<Promise<void>>;
  pendingPatchInputsRef: MutableRefObject<(DeckPatch | PatchProducer)[]>;
  isSaveFlushInFlightRef: MutableRefObject<boolean>;
  hasHydratedPersistedBaseRef: MutableRefObject<boolean>;
  hasUnackedLocalChangesRef: MutableRefObject<boolean>;
  lastSavedAt: string | null;
  saveErrorCode: SaveErrorCode | null;
  saveErrorMessage: string | null;
  saveState: SaveState;
  setSaveError: (code: SaveErrorCode | null, message: string | null) => void;
  setLastSavedAt: Dispatch<SetStateAction<string | null>>;
  setSaveState: Dispatch<SetStateAction<SaveState>>;
  markHydratedPersistedDeck: (
    nextDeck: Deck,
    setDeck: Dispatch<SetStateAction<Deck>>
  ) => void;
  applyAckedPersistedDeck: (nextDeck: Deck) => void;
  applyOptimisticWorkingDeck: (nextDeck: Deck) => void;
  replaceWorkingDeck: (nextDeck: Deck) => void;
  resetSaveState: () => void;
};

export function useEditorPersistenceState(initialDeck: Deck): EditorPersistenceState {
  const workingDeckRef = useRef(initialDeck);
  const persistedBaseDeckRef = useRef<Deck | null>(initialDeck);
  const lastAckedDeckRef = useRef<Deck | null>(initialDeck);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingPatchInputsRef = useRef<(DeckPatch | PatchProducer)[]>([]);
  const isSaveFlushInFlightRef = useRef(false);
  const hasHydratedPersistedBaseRef = useRef(false);
  const hasUnackedLocalChangesRef = useRef(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveErrorCode, setSaveErrorCode] = useState<SaveErrorCode | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  function markHydratedPersistedDeck(
    nextDeck: Deck,
    setDeck: Dispatch<SetStateAction<Deck>>
  ) {
    hasHydratedPersistedBaseRef.current = true;
    hasUnackedLocalChangesRef.current = false;
    workingDeckRef.current = nextDeck;
    persistedBaseDeckRef.current = nextDeck;
    lastAckedDeckRef.current = nextDeck;
    setDeck(nextDeck);
  }

  function applyAckedPersistedDeck(nextDeck: Deck) {
    workingDeckRef.current = nextDeck;
    persistedBaseDeckRef.current = nextDeck;
    lastAckedDeckRef.current = nextDeck;
    hasHydratedPersistedBaseRef.current = true;
    hasUnackedLocalChangesRef.current = false;
    pendingPatchInputsRef.current = [];
  }

  function applyOptimisticWorkingDeck(nextDeck: Deck) {
    workingDeckRef.current = nextDeck;
    hasUnackedLocalChangesRef.current = true;
  }

  function replaceWorkingDeck(nextDeck: Deck) {
    workingDeckRef.current = nextDeck;
  }

  function resetSaveState() {
    setSaveState("idle");
    setSaveErrorCode(null);
    setSaveErrorMessage(null);
  }

  function setSaveError(code: SaveErrorCode | null, message: string | null) {
    setSaveErrorCode(code);
    setSaveErrorMessage(message);
  }

  return {
    workingDeckRef,
    persistedBaseDeckRef,
    lastAckedDeckRef,
    saveQueueRef,
    pendingPatchInputsRef,
    isSaveFlushInFlightRef,
    hasHydratedPersistedBaseRef,
    hasUnackedLocalChangesRef,
    lastSavedAt,
    saveErrorCode,
    saveErrorMessage,
    saveState,
    setSaveError,
    setLastSavedAt,
    setSaveState,
    markHydratedPersistedDeck,
    applyAckedPersistedDeck,
    applyOptimisticWorkingDeck,
    replaceWorkingDeck,
    resetSaveState
  };
}
