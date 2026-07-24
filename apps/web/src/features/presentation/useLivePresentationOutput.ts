import type {
  Deck,
  PresentationCompanionAnnotationSnapshot,
} from "@orbit/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  observeAudienceStreamInWindow,
  type ActiveAudienceStream,
  type AudienceStreamBridgeWindow,
} from "../rehearsal/presenter/audienceStreamBridge";
import {
  createLivePresentationHostIdentity,
  type PresenterRemoteCommand,
  type ScreenShareEndedReason,
} from "../rehearsal/presenter/presentationChannel";
import type {
  AudienceOutputMode,
  PresenterSlideshowState,
} from "../rehearsal/presenter/presenterStateStore";
import { useAudienceScreenShare } from "../rehearsal/presenter/useAudienceScreenShare";
import { usePresentationChannelPublisher } from "../rehearsal/presenter/usePresentationChannelPublisher";
import { usePresenterCompanionAuthority } from "../presenter-companion/usePresenterCompanionAuthority";
import { usePresenterCompanionWebRtc } from "../presenter-companion/usePresenterCompanionWebRtc";

export type LivePresentationDisplayRole =
  | "presenter"
  | "slide-receiver"
  | "slide-surface";

export function useLivePresentationOutput(input: {
  audienceWindowConnected: boolean;
  companionEnabled?: boolean;
  deck: Deck | null;
  displayRole: LivePresentationDisplayRole;
  enabled?: boolean;
  getAudienceWindow: () => AudienceStreamBridgeWindow | null;
  localWindowSessionId?: string;
  onCommand?: (command: PresenterRemoteCommand) => void;
  onOutputModeChange: (mode: AudienceOutputMode) => void;
  onPeerReady?: (peer: "presenter-remote" | "slide-window") => void;
  onScreenShareEnded?: (reason: ScreenShareEndedReason) => void;
  outputMode: AudienceOutputMode;
  persistedSessionId?: string | null;
  state: PresenterSlideshowState | null;
  triggerAnimationIds: string[];
}) {
  const annotationSnapshotRef =
    useRef<PresentationCompanionAnnotationSnapshot | null>(null);
  const [streamObserverRevision, setStreamObserverRevision] =
    useState(0);
  const [bridgedShare, setBridgedShare] =
    useState<ActiveAudienceStream | null>(null);
  const getAudienceWindowRef = useRef(input.getAudienceWindow);
  const peerReadyHandlerRef = useRef(input.onPeerReady);
  getAudienceWindowRef.current = input.getAudienceWindow;
  peerReadyHandlerRef.current = input.onPeerReady;
  const handlePeerReady = useCallback(
    (peer: "presenter-remote" | "slide-window") => {
      if (peer === "slide-window") {
        setStreamObserverRevision((revision) => revision + 1);
      }
      peerReadyHandlerRef.current?.(peer);
    },
    [],
  );
  const localChannel = usePresentationChannelPublisher({
    deck: input.deck,
    enabled: input.enabled ?? true,
    getAnnotationSnapshot: () => annotationSnapshotRef.current,
    onCommand: input.onCommand,
    onPeerReady: handlePeerReady,
    onScreenShareEnded: input.onScreenShareEnded,
    sessionId: input.localWindowSessionId,
    state: input.state,
    triggerAnimationIds: input.triggerAnimationIds,
  });
  const hostIdentity = useMemo(
    () =>
      createLivePresentationHostIdentity({
        deckId: input.deck?.deckId ?? "pending-deck",
        localWindowSessionId: localChannel.sessionId,
        persistedSessionId: input.persistedSessionId,
      }),
    [
      input.deck?.deckId,
      input.persistedSessionId,
      localChannel.sessionId,
    ],
  );
  const screenShare = useAudienceScreenShare({
    connected:
      input.displayRole === "presenter" &&
      input.audienceWindowConnected &&
      localChannel.status === "connected",
    getTargetWindow: input.getAudienceWindow,
    identity: hostIdentity.localChannel,
    onOutputModeChange: input.onOutputModeChange,
    outputMode: input.outputMode,
  });
  useEffect(() => {
    if (
      input.displayRole !== "presenter" ||
      !input.audienceWindowConnected
    ) {
      setBridgedShare(null);
      return;
    }
    const observation = observeAudienceStreamInWindow({
      identity: hostIdentity.localChannel,
      onChange: setBridgedShare,
      targetWindow: getAudienceWindowRef.current(),
    });
    if (!observation.ok) return;
    return () => {
      observation.unsubscribe();
      setBridgedShare(null);
    };
  }, [
    hostIdentity,
    input.audienceWindowConnected,
    input.displayRole,
    streamObserverRevision,
  ]);
  const activeShare =
    bridgedShare ??
    (screenShare.activeStream && screenShare.shareEpochId
      ? {
          shareEpochId: screenShare.shareEpochId,
          stream: screenShare.activeStream,
        }
      : null);
  const companionAuthority = usePresenterCompanionAuthority({
    enabled:
      Boolean(input.companionEnabled) &&
      (input.enabled ?? true) &&
      input.displayRole === "presenter",
    sessionId: input.persistedSessionId,
    shareEpochId: activeShare?.shareEpochId,
    state: input.state,
    onAnnotationDelta: (delta, snapshot) => {
      annotationSnapshotRef.current = snapshot;
      localChannel.publishAnnotationDelta(delta);
    },
    onAnnotationSnapshot: (snapshot) => {
      annotationSnapshotRef.current = snapshot;
      localChannel.publishAnnotationSnapshot(snapshot);
    },
    onLaser: (laser) => {
      localChannel.publishLaser(laser);
    },
  });
  const companionWebRtc = usePresenterCompanionWebRtc({
    activeShare,
    enabled:
      Boolean(input.companionEnabled) &&
      companionAuthority.status === "active" &&
      companionAuthority.pairingGeneration !== null,
    sendSignal: companionAuthority.sendSignal,
    subscribeSignal: companionAuthority.subscribeSignal,
  });
  useEffect(() => {
    if (!input.companionEnabled || !input.persistedSessionId) {
      annotationSnapshotRef.current = null;
    }
  }, [input.companionEnabled, input.persistedSessionId]);
  useEffect(() => {
    if (
      localChannel.status === "stale" ||
      localChannel.status === "closed" ||
      localChannel.status === "failed"
    ) {
      screenShare.handlePeerUnavailable();
    }
  }, [localChannel.status]);

  useEffect(() => {
    if (input.displayRole !== "presenter") {
      screenShare.handlePeerUnavailable();
    }
  }, [input.displayRole]);

  return {
    companionAuthority,
    companionWebRtc,
    hostIdentity,
    localChannel,
    screenShare,
  };
}
