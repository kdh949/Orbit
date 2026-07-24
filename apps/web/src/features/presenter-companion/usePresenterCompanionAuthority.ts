import {
  presentationCompanionAuthorityChangedEventSchema,
  presentationCompanionAnnotationCommandEventSchema,
  presentationCompanionPresenceEventSchema,
  presentationCompanionLaserEventSchema,
  presentationCompanionSnapshotRequestEventSchema,
  presentationCompanionOutputStateSchema,
  presentationCompanionSignalEventSchema,
  presentationCompanionSignalSchema,
  type PresentationCompanionOutputState,
  type PresentationCompanionAnnotationSnapshot,
  type PresentationCompanionLaser,
  type PresentationCompanionSignal,
} from "@orbit/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PresenterSlideshowState } from "../rehearsal/presenter/presenterStateStore";
import {
  AnnotationAuthority,
  type AcceptedAnnotationDelta,
} from "./annotationAuthority";
import type { CompanionSignalInput } from "./companionWebRtc";

type PresenterCompanionSocket = Pick<
  Socket,
  "connected" | "disconnect" | "emit" | "off" | "on"
>;

type AuthorityStatus = "disabled" | "claiming" | "active" | "standby";

export const presenterAuthorityHeartbeatIntervalMs = 3_000;

export function usePresenterCompanionAuthority(input: {
  enabled: boolean;
  sessionId: string | null | undefined;
  shareEpochId?: string | null;
  state: PresenterSlideshowState | null;
  createSocket?: () => PresenterCompanionSocket;
  onAnnotationDelta?: (
    delta: AcceptedAnnotationDelta,
    snapshot: PresentationCompanionAnnotationSnapshot,
  ) => void;
  onAnnotationSnapshot?: (
    snapshot: PresentationCompanionAnnotationSnapshot,
  ) => void;
  onLaser?: (laser: PresentationCompanionLaser) => void;
}) {
  const [status, setStatus] = useState<AuthorityStatus>("disabled");
  const [pairingGeneration, setPairingGeneration] = useState<
    number | null
  >(null);
  const pairingGenerationRef = useRef<number | null>(null);
  const authorityEpochIdRef = useRef("");
  const outputRevisionRef = useRef(-1);
  const socketRef = useRef<PresenterCompanionSocket | null>(null);
  const stateRef = useRef(input.state);
  const shareEpochIdRef = useRef(input.shareEpochId);
  const latestOutputRef =
    useRef<PresentationCompanionOutputState | null>(null);
  const annotationAuthorityRef = useRef<AnnotationAuthority | null>(null);
  const currentSurfaceIdRef = useRef<string | null>(null);
  const retainedShareSurfaceIdRef = useRef<string | null>(null);
  const annotationDeltaHandlerRef = useRef(input.onAnnotationDelta);
  const annotationSnapshotHandlerRef = useRef(
    input.onAnnotationSnapshot,
  );
  const laserHandlerRef = useRef(input.onLaser);
  const signalListenersRef = useRef(
    new Set<(signal: PresentationCompanionSignal) => void>(),
  );
  stateRef.current = input.state;
  shareEpochIdRef.current = input.shareEpochId;
  annotationDeltaHandlerRef.current = input.onAnnotationDelta;
  annotationSnapshotHandlerRef.current = input.onAnnotationSnapshot;
  laserHandlerRef.current = input.onLaser;

  const publishCurrentOutput = useCallback(() => {
    const socket = socketRef.current;
    const state = stateRef.current;
    const sessionId = input.sessionId;
    if (
      !socket ||
      !state ||
      !sessionId ||
      !authorityEpochIdRef.current
    ) {
      return;
    }
    const surface = resolveCompanionSurface(
      state,
      shareEpochIdRef.current,
    );
    const output = presentationCompanionOutputStateSchema.parse({
      sessionId,
      authorityEpochId: authorityEpochIdRef.current,
      outputRevision: Math.max(0, outputRevisionRef.current),
      outputMode: state.audienceOutputMode,
      slideId: state.slideId,
      slideIndex: state.slideIndex,
      animationStep: state.stepIndex,
      ...(surface
        ? {
            surfaceRevision:
              annotationAuthorityRef.current?.getSnapshot(
                surface.surfaceId,
              ).surfaceRevision ?? 0,
            surfaceId: surface.surfaceId,
            ...(surface.shareEpochId
              ? { shareEpochId: surface.shareEpochId }
              : {}),
          }
        : {}),
    });
    latestOutputRef.current = output;
    currentSurfaceIdRef.current = surface?.surfaceId ?? null;
    socket.emit("presentation:companion:output-state", output);
  }, [input.sessionId]);

  const publishAnnotationSnapshot = useCallback(() => {
    const socket = socketRef.current;
    const authority = annotationAuthorityRef.current;
    const surfaceId = currentSurfaceIdRef.current;
    if (!socket || !authority || !surfaceId) return null;
    const snapshot = authority.getSnapshot(surfaceId);
    socket.emit("presentation:companion:annotation-snapshot", snapshot);
    annotationSnapshotHandlerRef.current?.(snapshot);
    return snapshot;
  }, []);

  useEffect(() => {
    if (!input.enabled || !input.sessionId || !input.state) {
      setStatus("disabled");
      return;
    }
    const sessionId = input.sessionId;
    const socket =
      input.createSocket?.() ?? io({ withCredentials: true });
    socketRef.current = socket;
    authorityEpochIdRef.current = createAuthorityEpochId();
    pairingGenerationRef.current = null;
    setPairingGeneration(null);
    outputRevisionRef.current = -1;
    latestOutputRef.current = null;
    currentSurfaceIdRef.current =
      resolveCompanionSurface(input.state, input.shareEpochId)?.surfaceId ??
      null;
    retainedShareSurfaceIdRef.current = input.shareEpochId
      ? createCompanionShareSurfaceId(input.shareEpochId)
      : null;
    annotationAuthorityRef.current = new AnnotationAuthority(
      sessionId,
      authorityEpochIdRef.current,
    );

    const lease = createPresenterAuthorityLeaseController({
      claim: (callback) => {
        socket.emit(
          "presentation:companion:authority-claim",
          {
            sessionId,
            authorityEpochId: authorityEpochIdRef.current,
          },
          callback,
        );
      },
      heartbeat: (callback) => {
        socket.emit(
          "presentation:companion:authority-heartbeat",
          {
            sessionId,
            authorityEpochId: authorityEpochIdRef.current,
          },
          callback,
        );
      },
      isConnected: () => socket.connected,
      onStatusChange: setStatus,
      ownAuthorityEpochId: authorityEpochIdRef.current,
    });
    const claim = () => lease.claim();
    const handleDisconnect = () => {
      lease.handleDisconnect();
      pairingGenerationRef.current = null;
      setPairingGeneration(null);
    };
    const handleAuthorityChanged = (value: unknown) => {
      const parsed =
        presentationCompanionAuthorityChangedEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.sessionId !== sessionId) return;
      const ownsAuthority = lease.handleAuthorityChanged(
        parsed.data.payload.authorityEpochId,
      );
      if (!ownsAuthority) {
        pairingGenerationRef.current = null;
        setPairingGeneration(null);
      }
    };
    const handlePresence = (value: unknown) => {
      const parsed =
        presentationCompanionPresenceEventSchema.safeParse(value);
      if (
        parsed.success &&
        parsed.data.sessionId === sessionId &&
        parsed.data.payload.connected
      ) {
        pairingGenerationRef.current =
          parsed.data.payload.pairingGeneration;
        setPairingGeneration(parsed.data.payload.pairingGeneration);
        publishCurrentOutput();
        publishAnnotationSnapshot();
      } else if (
        parsed.success &&
        parsed.data.sessionId === sessionId
      ) {
        pairingGenerationRef.current = null;
        setPairingGeneration(null);
      }
    };
    const handleSignal = (value: unknown) => {
      const parsed =
        presentationCompanionSignalEventSchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.sessionId !== sessionId ||
        parsed.data.payload.authorityEpochId !==
          authorityEpochIdRef.current ||
        parsed.data.payload.targetGeneration !==
          pairingGenerationRef.current
      ) {
        return;
      }
      for (const listener of signalListenersRef.current) {
        listener(parsed.data.payload);
      }
    };
    const handleAnnotationCommand = (value: unknown) => {
      const parsed =
        presentationCompanionAnnotationCommandEventSchema.safeParse(
          value,
        );
      const authority = annotationAuthorityRef.current;
      const activeSurfaceId = currentSurfaceIdRef.current;
      if (
        !parsed.success ||
        parsed.data.sessionId !== sessionId ||
        !authority ||
        !activeSurfaceId ||
        !isCompanionAnnotationSurfaceActive({
          output: latestOutputRef.current,
          state: stateRef.current,
          surfaceId: activeSurfaceId,
        })
      ) {
        return;
      }
      const result = authority.consume(
        parsed.data.payload,
        activeSurfaceId,
      );
      socket.emit(
        "presentation:companion:annotation-ack",
        result.acknowledgement,
      );
      if (result.delta) {
        annotationDeltaHandlerRef.current?.(
          result.delta,
          result.snapshot,
        );
      } else if (!result.acknowledgement.accepted) {
        socket.emit(
          "presentation:companion:annotation-snapshot",
          result.snapshot,
        );
        annotationSnapshotHandlerRef.current?.(result.snapshot);
      }
    };
    const handleLaser = (value: unknown) => {
      const parsed =
        presentationCompanionLaserEventSchema.safeParse(value);
      const activeSurfaceId = currentSurfaceIdRef.current;
      if (
        parsed.success &&
        parsed.data.sessionId === sessionId &&
        Boolean(activeSurfaceId) &&
        isCompanionAnnotationSurfaceActive({
          output: latestOutputRef.current,
          state: stateRef.current,
          surfaceId: activeSurfaceId,
        }) &&
        parsed.data.payload.authorityEpochId ===
          authorityEpochIdRef.current &&
        parsed.data.payload.surfaceId === activeSurfaceId
      ) {
        laserHandlerRef.current?.(parsed.data.payload);
      }
    };
    const handleSnapshotRequest = (value: unknown) => {
      const parsed =
        presentationCompanionSnapshotRequestEventSchema.safeParse(value);
      if (
        parsed.success &&
        parsed.data.sessionId === sessionId &&
        stateRef.current?.audienceOutputMode !== "black" &&
        parsed.data.payload.authorityEpochId ===
          authorityEpochIdRef.current
      ) {
        publishCurrentOutput();
        publishAnnotationSnapshot();
      }
    };

    socket.on("connect", claim);
    socket.on("disconnect", handleDisconnect);
    socket.on(
      "presentation:companion:authority-changed",
      handleAuthorityChanged,
    );
    socket.on("presentation:companion:presence", handlePresence);
    socket.on("presentation:companion:signal", handleSignal);
    socket.on(
      "presentation:companion:annotation-command",
      handleAnnotationCommand,
    );
    socket.on("presentation:companion:laser", handleLaser);
    socket.on(
      "presentation:companion:snapshot-request",
      handleSnapshotRequest,
    );
    if (socket.connected) claim();
    const heartbeatId = window.setInterval(() => {
      lease.tick();
    }, presenterAuthorityHeartbeatIntervalMs);

    return () => {
      window.clearInterval(heartbeatId);
      lease.dispose();
      socket.off("connect", claim);
      socket.off("disconnect", handleDisconnect);
      socket.off(
        "presentation:companion:authority-changed",
        handleAuthorityChanged,
      );
      socket.off("presentation:companion:presence", handlePresence);
      socket.off("presentation:companion:signal", handleSignal);
      socket.off(
        "presentation:companion:annotation-command",
        handleAnnotationCommand,
      );
      socket.off("presentation:companion:laser", handleLaser);
      socket.off(
        "presentation:companion:snapshot-request",
        handleSnapshotRequest,
      );
      socket.disconnect();
      socketRef.current = null;
      latestOutputRef.current = null;
      annotationAuthorityRef.current = null;
      retainedShareSurfaceIdRef.current = null;
      pairingGenerationRef.current = null;
      setPairingGeneration(null);
    };
  }, [
    input.createSocket,
    input.enabled,
    input.sessionId,
    Boolean(input.state),
    publishCurrentOutput,
    publishAnnotationSnapshot,
  ]);

  useEffect(() => {
    const nextSurfaceId = input.shareEpochId
      ? createCompanionShareSurfaceId(input.shareEpochId)
      : null;
    const previousSurfaceId = retainedShareSurfaceIdRef.current;
    if (previousSurfaceId && previousSurfaceId !== nextSurfaceId) {
      annotationAuthorityRef.current?.releaseSurface(previousSurfaceId);
    }
    retainedShareSurfaceIdRef.current = nextSurfaceId;
  }, [input.shareEpochId]);

  useEffect(() => {
    if (!input.enabled || !input.state || status !== "active") return;
    outputRevisionRef.current += 1;
    publishCurrentOutput();
    publishAnnotationSnapshot();
  }, [
    input.enabled,
    input.state?.audienceOutputMode,
    input.state?.slideId,
    input.state?.slideIndex,
    input.state?.stepIndex,
    input.shareEpochId,
    publishCurrentOutput,
    publishAnnotationSnapshot,
    status,
  ]);

  const sendSignal = useCallback(
    (signal: CompanionSignalInput): boolean => {
      const socket = socketRef.current;
      if (
        !socket ||
        !input.sessionId ||
        status !== "active" ||
        pairingGeneration === null ||
        !authorityEpochIdRef.current
      ) {
        return false;
      }
      const parsed = presentationCompanionSignalSchema.safeParse({
        ...signal,
        sessionId: input.sessionId,
        authorityEpochId: authorityEpochIdRef.current,
        targetGeneration: pairingGeneration,
      });
      if (!parsed.success) return false;
      socket.emit("presentation:companion:signal", parsed.data);
      return true;
    },
    [input.sessionId, pairingGeneration, status],
  );
  const subscribeSignal = useCallback(
    (listener: (signal: PresentationCompanionSignal) => void) => {
      signalListenersRef.current.add(listener);
      return () => {
        signalListenersRef.current.delete(listener);
      };
    },
    [],
  );

  return {
    authorityEpochId: authorityEpochIdRef.current || null,
    getAnnotationSnapshot: () => {
      const authority = annotationAuthorityRef.current;
      const surfaceId = currentSurfaceIdRef.current;
      return authority && surfaceId
        ? authority.getSnapshot(surfaceId)
        : null;
    },
    pairingGeneration,
    publishCurrentOutput,
    sendSignal,
    status,
    subscribeSignal,
  };
}

export function createPresenterAuthorityLeaseController(input: {
  claim: (callback: (response: unknown) => void) => void;
  heartbeat: (callback: (response: unknown) => void) => void;
  isConnected: () => boolean;
  onStatusChange: (status: AuthorityStatus) => void;
  ownAuthorityEpochId: string;
}) {
  let claimPending = false;
  let disposed = false;
  let heartbeatPending = false;
  let lifecycleRevision = 0;
  let ownsAuthority = false;

  const claim = () => {
    if (disposed || claimPending || ownsAuthority || !input.isConnected()) {
      return;
    }
    claimPending = true;
    const revision = lifecycleRevision;
    input.onStatusChange("claiming");
    input.claim((response) => {
      if (disposed || revision !== lifecycleRevision) return;
      claimPending = false;
      ownsAuthority = hasBooleanResult(response, "claimed");
      input.onStatusChange(ownsAuthority ? "active" : "standby");
    });
  };

  const heartbeat = () => {
    if (
      disposed ||
      heartbeatPending ||
      !ownsAuthority ||
      !input.isConnected()
    ) {
      return;
    }
    heartbeatPending = true;
    const revision = lifecycleRevision;
    input.heartbeat((response) => {
      if (disposed || revision !== lifecycleRevision) return;
      heartbeatPending = false;
      if (hasBooleanResult(response, "renewed")) return;
      ownsAuthority = false;
      input.onStatusChange("standby");
      claim();
    });
  };

  return {
    claim,
    dispose: () => {
      disposed = true;
      lifecycleRevision += 1;
      claimPending = false;
      heartbeatPending = false;
      ownsAuthority = false;
    },
    handleAuthorityChanged: (authorityEpochId: string | null) => {
      if (disposed) return false;
      ownsAuthority = authorityEpochId === input.ownAuthorityEpochId;
      input.onStatusChange(ownsAuthority ? "active" : "standby");
      if (authorityEpochId === null) claim();
      return ownsAuthority;
    },
    handleDisconnect: () => {
      if (disposed) return;
      lifecycleRevision += 1;
      claimPending = false;
      heartbeatPending = false;
      ownsAuthority = false;
      input.onStatusChange("standby");
    },
    tick: () => {
      if (ownsAuthority) heartbeat();
      else claim();
    },
  };
}

function hasBooleanResult(
  response: unknown,
  field: "claimed" | "renewed",
): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    field in response &&
    (response as Record<string, unknown>)[field] === true
  );
}

export function createCompanionSurfaceId(slideId: string): string {
  const safePrefix = slideId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
  return `surface_${safePrefix}_${fnv1a(slideId)}`;
}

export function createCompanionShareSurfaceId(
  shareEpochId: string,
): string {
  const safePrefix = shareEpochId
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 32);
  return `surface_${safePrefix}_${fnv1a(shareEpochId)}`;
}

export function resolveCompanionSurface(
  state: PresenterSlideshowState,
  shareEpochId: string | null | undefined,
):
  | { shareEpochId?: string; surfaceId: string }
  | null {
  if (state.audienceOutputMode === "screen-share") {
    return shareEpochId
      ? {
          shareEpochId,
          surfaceId: createCompanionShareSurfaceId(shareEpochId),
        }
      : null;
  }
  if (state.audienceOutputMode === "black") return null;
  return { surfaceId: createCompanionSurfaceId(state.slideId) };
}

export function isCompanionAnnotationSurfaceActive(input: {
  output: PresentationCompanionOutputState | null;
  state: PresenterSlideshowState | null;
  surfaceId: string | null;
}): boolean {
  return Boolean(
    input.surfaceId &&
      input.state?.audienceOutputMode !== "black" &&
      input.output?.outputMode !== "black",
  );
}

function createAuthorityEpochId(): string {
  return `epoch_${crypto.randomUUID().replace(/-/g, "")}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
