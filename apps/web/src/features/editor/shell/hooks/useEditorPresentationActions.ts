import type { Deck } from "@orbit/shared";
import type { MutableRefObject } from "react";
import { useState } from "react";

import { storePreparedRehearsalSlideSnapshots } from "../../../rehearsal/rehearsalSlideSnapshots";
import { withSaveErrorCode } from "../api/deckPersistenceApi";
import { shouldApplyManualSaveResult } from "../utils/deckState";
import { toEditorErrorMessage } from "../utils/editorFileValidation";
import type { SaveErrorCode, SaveState } from "./useEditorPersistenceState";

type StartAction = "presentation" | "rehearsal";

export function useEditorPresentationActions(args: {
  applyPersistedDeck: (deck: Deck) => void;
  commitSpeakerNotesDraftIfDirty: () => boolean | undefined;
  flushPendingSaves: () => Promise<void>;
  isDeckLoading: boolean;
  persistedBaseDeckRef: MutableRefObject<Deck | null>;
  persistedDeck?: Deck;
  projectId: string;
  setActiveTopMenuClosed: () => void;
  setLastPatchLabel: (label: string) => void;
  setLastSavedAt: (value: string) => void;
  setSaveError: (code: SaveErrorCode | null, message: string | null) => void;
  setSaveState: (state: SaveState) => void;
  uploadRehearsalSlideSnapshots: (
    projectId: string,
    deck: Deck
  ) => Promise<Array<{ fileId: string; slideId: string }>>;
  workingDeckRef: MutableRefObject<Deck>;
}) {
  const [activeStartAction, setActiveStartAction] = useState<StartAction | null>(null);

  async function start(destination: StartAction) {
    const activeProjectId = args.persistedDeck?.projectId ?? args.projectId;
    if (args.isDeckLoading || !args.persistedDeck) {
      args.setSaveState("auto-pending");
      args.setSaveError(
        "rehearsal-blocked",
        destination === "presentation"
          ? "발표 자료를 불러온 뒤 발표를 시작할 수 있습니다."
          : "발표 자료를 불러온 뒤 리허설을 시작할 수 있습니다."
      );
      return;
    }
    if (activeStartAction) return;
    if (!activeProjectId) {
      args.setSaveState("error");
      args.setSaveError("missing-project", "저장할 프로젝트를 찾지 못했습니다.");
      return;
    }
    if (!args.commitSpeakerNotesDraftIfDirty()) return;

    setActiveStartAction(destination);
    args.setSaveState("manual-saving");
    args.setSaveError(null, null);
    args.setActiveTopMenuClosed();
    try {
      await args.flushPendingSaves();
      const persistedDeck = args.persistedBaseDeckRef.current ?? args.persistedDeck;
      if (!persistedDeck) {
        throw withSaveErrorCode(
          new Error("최신 저장 상태를 찾지 못했습니다. 다시 불러온 뒤 저장해 주세요."),
          "missing-persisted-base"
        );
      }
      if (!shouldApplyManualSaveResult({
        snapshotDeck: persistedDeck,
        currentDeck: args.workingDeckRef.current
      })) {
        throw new Error("리허설 준비 전에 편집 내용이 변경되었습니다. 저장 후 다시 시작해 주세요.");
      }

      let snapshotPreparationId: string | undefined;
      if (destination === "rehearsal") {
        const snapshots = await args.uploadRehearsalSlideSnapshots(activeProjectId, persistedDeck);
        snapshotPreparationId = storePreparedRehearsalSlideSnapshots({
          deckId: persistedDeck.deckId,
          deckVersion: persistedDeck.version,
          projectId: activeProjectId,
          snapshots
        });
      }
      args.applyPersistedDeck(persistedDeck);
      args.setLastSavedAt(new Date().toISOString());
      args.setLastPatchLabel(
        `${destination === "presentation" ? "발표 화면 준비 완료" : "리허설 준비 완료"} · v${persistedDeck.version}`
      );
      args.setSaveState("manual-saved");
      args.setSaveError(null, null);
      if (destination === "presentation") navigateToPresentation(activeProjectId);
      else navigateToRehearsal(activeProjectId, snapshotPreparationId);
    } catch (error) {
      const message = toEditorErrorMessage(error);
      args.setLastPatchLabel(
        `${destination === "presentation" ? "발표 준비 실패" : "리허설 준비 실패"} · ${message}`
      );
      args.setSaveState("error");
      args.setSaveError("rehearsal-save-failed", message);
    } finally {
      setActiveStartAction(null);
    }
  }

  return {
    activeStartAction,
    startPresentation: () => start("presentation"),
    startRehearsal: () => start("rehearsal")
  };
}

function navigateToRehearsal(projectId: string, snapshotPreparationId?: string) {
  const search = snapshotPreparationId
    ? `?snapshotPreparationId=${encodeURIComponent(snapshotPreparationId)}`
    : "";
  const path = `/rehearsal/${encodeURIComponent(projectId)}${search}`;
  window.dispatchEvent(new CustomEvent("orbit:rehearsal-navigation-request", { detail: path }));
}

function navigateToPresentation(projectId: string) {
  window.history.pushState({}, "", `/presentation/${encodeURIComponent(projectId)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
