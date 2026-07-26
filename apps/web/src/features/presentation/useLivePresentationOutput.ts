import type {
  Deck,
  PresentationCompanionAnnotationSnapshot,
} from "@orbit/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  observeAudienceStreamInWindow,
  type ActiveAudienceStream,
  type AudienceStreamBridgeWindow,
} from "../../runtime/presentation/audienceStreamBridge";
import {
  createLivePresentationHostIdentity,
  type PresenterRemoteCommand,
  type ScreenShareEndedReason,
} from "../../runtime/presentation/channel/presentationChannel";
import type {
  AudienceOutputMode,
  PresenterSlideshowState,
} from "../../runtime/presentation/channel/presenterStateStore";
import { useAudienceScreenShare } from "../rehearsal/presenter/useAudienceScreenShare";
import { usePresentationChannelPublisher } from "../../runtime/presentation/channel/usePresentationChannelPublisher";
import { usePresenterCompanionAuthority } from "../presenter-companion/usePresenterCompanionAuthority";
import { usePresenterCompanionWebRtc } from "../presenter-companion/usePresenterCompanionWebRtc";
import type { CompanionPrompterProjection } from "../presenter-companion/companionPrompterProjection";
import type { ActivityElementRuntime } from "../activity-slides/rendering/ActivityElementRuntimeContext";

export type LivePresentationDisplayRole =
  | "presenter"
  | "slide-receiver"
  | "slide-surface";

/**
 * Picks the window whose audience stream bridge holds the active share.
 *
 * A presenter window bridges through the child audience window it opened. Once
 * this window becomes the audience surface there is no child window: the
 * presenter remote window attaches its capture to `window.opener`, which is
 * this window, and `PresentWindowReceiver` registers the bridge here.
 */
export function resolveAudienceStreamObservationTarget(input: {
  audienceWindowConnected: boolean;
  displayRole: LivePresentationDisplayRole;
  getAudienceWindow: () => AudienceStreamBridgeWindow | null;
  getSelfWindow: () => AudienceStreamBridgeWindow | null;
}): AudienceStreamBridgeWindow | null {
  if (input.displayRole === "presenter") {
    return input.audienceWindowConnected ? input.getAudienceWindow() : null;
  }
  return input.getSelfWindow();
}

function readSelfBridgeWindow(): AudienceStreamBridgeWindow | null {
  return typeof window === "undefined"
    ? null
    : (window as unknown as AudienceStreamBridgeWindow);
}

export function useLivePresentationOutput(input: {
  activityElementRuntime?: ActivityElementRuntime | null;
  audienceWindowConnected: boolean;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
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
  prompterState?: CompanionPrompterProjection | null;
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
    activityElementRuntime: input.activityElementRuntime,
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
    const targetWindow = resolveAudienceStreamObservationTarget({
      audienceWindowConnected: input.audienceWindowConnected,
      displayRole: input.displayRole,
      getAudienceWindow: () => getAudienceWindowRef.current(),
      getSelfWindow: readSelfBridgeWindow,
    });
    if (!targetWindow) {
      setBridgedShare(null);
      return;
    }
    const observation = observeAudienceStreamInWindow({
      identity: hostIdentity.localChannel,
      onChange: setBridgedShare,
      targetWindow,
    });
    if (!observation.ok) {
      setBridgedShare(null);
      return;
    }
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
    // Authority follows the window that owns the deck state, not the display
    // role: swapping this window into the audience surface must not drop the
    // companion lease.
    enabled: Boolean(input.companionEnabled) && (input.enabled ?? true),
    sessionId: input.persistedSessionId,
    canGoNext: input.canGoNext,
    canGoPrevious: input.canGoPrevious,
    prompterState: input.prompterState,
    shareEpochId: activeShare?.shareEpochId,
    state: input.state,
    onNavigation: (action) => {
      input.onCommand?.({
        action: action === "previous-slide" ? "prev" : "next-step",
      });
    },
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
