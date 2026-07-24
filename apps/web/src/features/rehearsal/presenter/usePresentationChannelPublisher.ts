import type {
  Deck,
  PresentationCompanionAnnotationCommand,
  PresentationCompanionAnnotationSnapshot,
  PresentationCompanionLaser,
} from "@orbit/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PresenterSlideshowState } from "./presenterStateStore";
import {
  createPresentationSessionId,
  createPresenterAnnotationDeltaMessage,
  createPresenterAnnotationSnapshotMessage,
  createPresenterHeartbeatMessage,
  createPresenterLaserMessage,
  createPresenterSnapshotMessage,
  createPresenterStateMessage,
  createPresenterRemoteSnapshotMessage,
  createPresenterRemoteStateMessage,
  getPresentationChannelName,
  getPresenterRemoteChannelName,
  matchesPresentationChannelIdentity,
  parsePresentationChannelMessage,
  type PresentationChannelIdentity,
  type PresentationChannelMessage,
  type PresenterRemoteCommand,
  type PresenterSnapshotMessage,
  type PresenterStateMessage,
  type PresenterRemoteSnapshotMessage,
  type PresenterRemoteStateMessage,
  type ScreenShareEndedReason,
} from "./presentationChannel";

export type PresentationChannelStatus =
  | "idle"
  | "opening"
  | "connected"
  | "stale"
  | "closed"
  | "unsupported"
  | "failed";

export type PresentationChannelLike = Pick<
  BroadcastChannel,
  "close" | "postMessage"
> & {
  onmessage: ((event: MessageEvent) => void) | null;
};

export type PresentationChannelFactory = (
  channelName: string,
) => PresentationChannelLike;

export type PresentationPublisherController = {
  close: () => void;
  handleIncoming: (data: unknown) => void;
  publishAnnotationSnapshot: () => void;
  publishSnapshot: () => void;
  publishState: () => void;
};

export function usePresentationChannelPublisher(args: {
  channelFactory?: PresentationChannelFactory;
  deck: Deck | null;
  enabled?: boolean;
  getAnnotationSnapshot?: () =>
    | PresentationCompanionAnnotationSnapshot
    | null;
  sessionId?: string;
  state: PresenterSlideshowState | null;
  triggerAnimationIds: string[];
  onCommand?: (command: PresenterRemoteCommand) => void;
  onPeerReady?: (peer: "presenter-remote" | "slide-window") => void;
  onScreenShareEnded?: (reason: ScreenShareEndedReason) => void;
}) {
  const {
    channelFactory = createBroadcastChannel,
    deck,
    enabled = true,
    getAnnotationSnapshot,
    onCommand,
    onPeerReady,
    onScreenShareEnded,
    sessionId: sessionIdOverride,
    state,
    triggerAnimationIds,
  } = args;
  const [generatedSessionId] = useState(() => createPresentationSessionId());
  const sessionId = sessionIdOverride ?? generatedSessionId;
  const [status, setStatus] = useState<PresentationChannelStatus>("idle");
  const channelRef = useRef<PresentationChannelLike | null>(null);
  const presenterRemoteChannelRef = useRef<PresentationChannelLike | null>(null);
  const controllerRef = useRef<PresentationPublisherController | null>(null);
  const presenterRemoteControllerRef =
    useRef<PresentationPublisherController | null>(null);
  const lastPeerSeenAtRef = useRef<number | null>(null);
  const peerWaitStartedAtRef = useRef<number | null>(null);
  const latestCommandHandlerRef = useRef<typeof onCommand>(onCommand);
  const latestPeerReadyHandlerRef = useRef<typeof onPeerReady>(onPeerReady);
  const latestScreenShareEndedHandlerRef =
    useRef<typeof onScreenShareEnded>(onScreenShareEnded);
  const latestRef = useRef({ deck, state, triggerAnimationIds });
  const latestAnnotationSnapshotRef = useRef(getAnnotationSnapshot);
  latestCommandHandlerRef.current = onCommand;
  latestPeerReadyHandlerRef.current = onPeerReady;
  latestScreenShareEndedHandlerRef.current = onScreenShareEnded;
  latestRef.current = { deck, state, triggerAnimationIds };
  latestAnnotationSnapshotRef.current = getAnnotationSnapshot;

  const identity = useMemo<PresentationChannelIdentity | null>(
    () => (deck ? { deckId: deck.deckId, sessionId } : null),
    [deck?.deckId, sessionId],
  );

  useEffect(() => {
    if (!enabled || !identity || !deck || !state) {
      return;
    }

    let channel: PresentationChannelLike | null = null;
    let presenterRemoteChannel: PresentationChannelLike | null = null;
    try {
      channel = channelFactory(getPresentationChannelName(identity));
      presenterRemoteChannel = channelFactory(
        getPresenterRemoteChannelName(identity),
      );
    } catch {
      channel?.close();
      presenterRemoteChannel?.close();
      setStatus("unsupported");
      return;
    }

    const controller = createPresentationPublisherController({
      channel,
      getSnapshot: () => {
        const latest = latestRef.current;
        if (!latest.deck || !latest.state) {
          return null;
        }

        return createPresenterSnapshotMessage({
          deck: latest.deck,
          identity,
          state: latest.state,
          triggerAnimationIds: latest.triggerAnimationIds,
        });
      },
      getAnnotationSnapshot: () =>
        latestAnnotationSnapshotRef.current?.() ?? null,
      getState: () => {
        const latest = latestRef.current;
        if (!latest.state) {
          return null;
        }

        return createPresenterStateMessage({
          identity,
          state: latest.state,
          triggerAnimationIds: latest.triggerAnimationIds,
        });
      },
      identity,
      onCommand: (command) => latestCommandHandlerRef.current?.(command),
      onPeerReady: () => latestPeerReadyHandlerRef.current?.("slide-window"),
      onScreenShareEnded: (reason) =>
        latestScreenShareEndedHandlerRef.current?.(reason),
      onPeerSeen: () => {
        lastPeerSeenAtRef.current = Date.now();
        peerWaitStartedAtRef.current = null;
      },
      onStatusChange: setStatus,
    });
    channel.onmessage = (event) => controller.handleIncoming(event.data);
    const presenterRemoteController = createPresentationPublisherController({
      channel: presenterRemoteChannel,
      getSnapshot: () => {
        const latest = latestRef.current;
        if (!latest.deck || !latest.state) {
          return null;
        }
        return createPresenterRemoteSnapshotMessage({
          deck: latest.deck,
          identity,
          state: latest.state,
          triggerAnimationIds: latest.triggerAnimationIds,
        });
      },
      getState: () => {
        const latest = latestRef.current;
        if (!latest.state) {
          return null;
        }
        return createPresenterRemoteStateMessage({
          identity,
          state: latest.state,
          triggerAnimationIds: latest.triggerAnimationIds,
        });
      },
      identity,
      onCommand: (command) => latestCommandHandlerRef.current?.(command),
      onPeerReady: () =>
        latestPeerReadyHandlerRef.current?.("presenter-remote"),
      onScreenShareEnded: (reason) =>
        latestScreenShareEndedHandlerRef.current?.(reason),
      onPeerSeen: () => {
        lastPeerSeenAtRef.current = Date.now();
        peerWaitStartedAtRef.current = null;
      },
      onStatusChange: setStatus,
    });
    presenterRemoteChannel.onmessage = (event) =>
      presenterRemoteController.handleIncoming(event.data);
    channelRef.current = channel;
    presenterRemoteChannelRef.current = presenterRemoteChannel;
    controllerRef.current = controller;
    presenterRemoteControllerRef.current = presenterRemoteController;

    return () => {
      controller.close();
      presenterRemoteController.close();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
      if (presenterRemoteControllerRef.current === presenterRemoteController) {
        presenterRemoteControllerRef.current = null;
      }
      if (presenterRemoteChannelRef.current === presenterRemoteChannel) {
        presenterRemoteChannelRef.current = null;
      }
    };
  }, [channelFactory, enabled, identity]);

  useEffect(() => {
    if (!enabled || !identity || !channelRef.current) {
      return;
    }

    const heartbeatTimer = window.setInterval(() => {
      publishPresenterHeartbeat({
        identity,
        presenterRemoteChannel: presenterRemoteChannelRef.current,
        slideWindowChannel: channelRef.current,
      });
    }, 1000);
    const staleTimer = window.setInterval(() => {
      const lastPeerSeenAt = lastPeerSeenAtRef.current;
      if (
        isPresentationPeerStale(
          lastPeerSeenAt,
          Date.now(),
          5000,
          peerWaitStartedAtRef.current,
        )
      ) {
        setStatus("stale");
      }
    }, 1000);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(staleTimer);
    };
  }, [enabled, identity]);

  useEffect(() => {
    if (!enabled || !deck || !state) {
      return;
    }

    controllerRef.current?.publishState();
    presenterRemoteControllerRef.current?.publishState();
  }, [deck, enabled, state, triggerAnimationIds]);

  return {
    publishAnnotationDelta: (input: {
      command: PresentationCompanionAnnotationCommand;
      surfaceRevision: number;
    }) => {
      if (!identity || !channelRef.current) return;
      channelRef.current.postMessage(
        createPresenterAnnotationDeltaMessage({
          ...input,
          identity,
        }),
      );
    },
    publishAnnotationSnapshot: (
      annotation: PresentationCompanionAnnotationSnapshot,
    ) => {
      if (!identity || !channelRef.current) return;
      channelRef.current.postMessage(
        createPresenterAnnotationSnapshotMessage({
          annotation,
          identity,
        }),
      );
    },
    publishLaser: (laser: PresentationCompanionLaser) => {
      if (!identity || !channelRef.current) return;
      channelRef.current.postMessage(
        createPresenterLaserMessage({ identity, laser }),
      );
    },
    publishSnapshot: () => {
      if (!controllerRef.current) {
        return;
      }

      peerWaitStartedAtRef.current = Date.now();
      setStatus((current) => (current === "connected" ? current : "opening"));
      controllerRef.current.publishSnapshot();
    },
    sessionId,
    status,
  };
}

export function publishPresenterHeartbeat(args: {
  identity: PresentationChannelIdentity;
  presenterRemoteChannel: Pick<PresentationChannelLike, "postMessage"> | null;
  slideWindowChannel: Pick<PresentationChannelLike, "postMessage"> | null;
}) {
  const message = createPresenterHeartbeatMessage(args.identity);
  args.slideWindowChannel?.postMessage(message);
  args.presenterRemoteChannel?.postMessage(message);
}

export function createPresentationPublisherController(args: {
  channel: Pick<PresentationChannelLike, "close" | "postMessage">;
  getAnnotationSnapshot?: () =>
    | PresentationCompanionAnnotationSnapshot
    | null;
  getSnapshot: () =>
    | PresenterSnapshotMessage
    | PresenterRemoteSnapshotMessage
    | null;
  getState: () => PresenterStateMessage | PresenterRemoteStateMessage | null;
  identity: PresentationChannelIdentity;
  onCommand?: (command: PresenterRemoteCommand) => void;
  onPeerReady?: () => void;
  onScreenShareEnded?: (reason: ScreenShareEndedReason) => void;
  onPeerSeen?: () => void;
  onStatusChange?: (status: PresentationChannelStatus) => void;
}): PresentationPublisherController {
  const {
    channel,
    getSnapshot,
    getAnnotationSnapshot,
    getState,
    identity,
    onCommand,
    onPeerReady,
    onScreenShareEnded,
    onPeerSeen,
    onStatusChange,
  } = args;

  return {
    close: () => {
      channel.close();
      onStatusChange?.("closed");
    },
    handleIncoming: (data: unknown) => {
      const message = parsePresentationChannelMessage(data);
      if (!message) {
        return;
      }
      if (!matchesPresentationChannelIdentity(message, identity)) {
        return;
      }

      onPeerSeen?.();
      handlePublisherMessage(message, {
        handleCommand: onCommand,
        handlePeerReady: onPeerReady,
        handleScreenShareEnded: onScreenShareEnded,
        publishSnapshot: () => {
          const snapshot = getSnapshot();
          if (snapshot) {
            channel.postMessage(snapshot);
          }
          const annotation = getAnnotationSnapshot?.();
          if (annotation) {
            channel.postMessage(
              createPresenterAnnotationSnapshotMessage({
                annotation,
                identity,
              }),
            );
          }
        },
        setConnected: () => onStatusChange?.("connected"),
      });
    },
    publishSnapshot: () => {
      const snapshot = getSnapshot();
      if (snapshot) {
        channel.postMessage(snapshot);
      }
    },
    publishAnnotationSnapshot: () => {
      const annotation = getAnnotationSnapshot?.();
      if (annotation) {
        channel.postMessage(
          createPresenterAnnotationSnapshotMessage({
            annotation,
            identity,
          }),
        );
      }
    },
    publishState: () => {
      const state = getState();
      if (state) {
        channel.postMessage(state);
      }
    },
  };
}

export function isPresentationPeerStale(
  lastPeerSeenAt: number | null,
  now: number,
  staleAfterMs = 5000,
  peerWaitStartedAt: number | null = lastPeerSeenAt,
) {
  const staleAnchor = lastPeerSeenAt ?? peerWaitStartedAt;
  return staleAnchor !== null && now - staleAnchor > staleAfterMs;
}

function handlePublisherMessage(
  message: PresentationChannelMessage,
  handlers: {
    handleCommand?: (command: PresenterRemoteCommand) => void;
    handlePeerReady?: () => void;
    handleScreenShareEnded?: (reason: ScreenShareEndedReason) => void;
    publishSnapshot: () => void;
    setConnected: () => void;
  },
) {
  if (
    message.type === "slide-window-ready" ||
    message.type === "presenter-remote-ready"
  ) {
    handlers.publishSnapshot();
    handlers.setConnected();
    handlers.handlePeerReady?.();
    return;
  }

  if (
    message.type === "slide-window-heartbeat" ||
    message.type === "presenter-remote-heartbeat"
  ) {
    handlers.setConnected();
    return;
  }

  if (message.type === "presenter-command") {
    handlers.handleCommand?.(message.command);
    handlers.setConnected();
    return;
  }

  if (message.type === "screen-share-ended") {
    handlers.handleScreenShareEnded?.(message.reason);
    handlers.setConnected();
  }
}

function createBroadcastChannel(channelName: string): PresentationChannelLike {
  return new BroadcastChannel(channelName);
}
