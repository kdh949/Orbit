import {
  presentationCompanionAuthorityChangedEventSchema,
  presentationCompanionAnnotationAckEventSchema,
  presentationCompanionAnnotationSnapshotEventSchema,
  presentationCompanionAnnotationCommandSchema,
  presentationCompanionErrorEventSchema,
  presentationCompanionJoinedEventSchema,
  presentationCompanionLaserSchema,
  presentationCompanionOutputStateEventSchema,
  presentationCompanionRevokedEventSchema,
  presentationCompanionSignalEventSchema,
  presentationCompanionSignalSchema,
  type PresentationCompanionOutputState,
  type PresentationCompanionAnnotationAck,
  type PresentationCompanionAnnotationSnapshot,
  type PresentationCompanionAnnotationCommand,
  type PresentationCompanionSnapshotRequest,
  type PresentationCompanionSignal,
} from "@orbit/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { AnnotationCommandQueue } from "./annotationCommandQueue";
import type { CompanionSignalInput } from "./companionWebRtc";

type CompanionSocket = Pick<
  Socket,
  "connect" | "connected" | "disconnect" | "emit" | "off" | "on"
> & {
  volatile?: Pick<Socket, "emit">;
};

type AnnotationCommandBaseFields =
  | "authorityEpochId"
  | "baseRevision"
  | "sequence"
  | "sessionId"
  | "surfaceId";

export type CompanionAnnotationCommandInput =
  PresentationCompanionAnnotationCommand extends infer Command
    ? Command extends PresentationCompanionAnnotationCommand
      ? Omit<Command, AnnotationCommandBaseFields>
      : never
    : never;

const createDefaultCompanionSocket = (): CompanionSocket =>
  io({ withCredentials: true });

export type CompanionConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "revoked"
  | "failed";

export type CompanionOutputCursor = {
  output: PresentationCompanionOutputState | null;
  snapshotPending: boolean;
};

export type CompanionOutputConsumption = {
  cursor: CompanionOutputCursor;
  requestSnapshot: boolean;
};

type DrawableCompanionOutput = Exclude<
  PresentationCompanionOutputState,
  { outputMode: "black" }
>;

export function consumeCompanionOutputState(
  cursor: CompanionOutputCursor,
  incoming: PresentationCompanionOutputState,
): CompanionOutputConsumption {
  const current = cursor.output;
  if (
    !current ||
    current.authorityEpochId !== incoming.authorityEpochId ||
    cursor.snapshotPending
  ) {
    return {
      cursor: { output: incoming, snapshotPending: false },
      requestSnapshot: false,
    };
  }
  if (incoming.outputRevision <= current.outputRevision) {
    return { cursor, requestSnapshot: false };
  }
  if (incoming.outputRevision === current.outputRevision + 1) {
    return {
      cursor: { output: incoming, snapshotPending: false },
      requestSnapshot: false,
    };
  }
  if (incoming.outputMode === "black") {
    return {
      cursor: { output: incoming, snapshotPending: false },
      requestSnapshot: false,
    };
  }
  return {
    cursor: { ...cursor, snapshotPending: true },
    requestSnapshot: true,
  };
}

export function useCompanionSocket(
  sessionId: string,
  createSocket: () => CompanionSocket = createDefaultCompanionSocket,
) {
  const [status, setStatus] =
    useState<CompanionConnectionStatus>("connecting");
  const [error, setError] = useState("");
  const [authorityEpochId, setAuthorityEpochId] = useState<string | null>(
    null,
  );
  const [pairingGeneration, setPairingGeneration] = useState<
    number | null
  >(null);
  const [output, setOutput] =
    useState<PresentationCompanionOutputState | null>(null);
  const [annotation, setAnnotation] =
    useState<PresentationCompanionAnnotationSnapshot | null>(null);
  const [lastAnnotationAck, setLastAnnotationAck] =
    useState<PresentationCompanionAnnotationAck | null>(null);
  const [annotationRecovering, setAnnotationRecovering] =
    useState(false);
  const cursorRef = useRef<CompanionOutputCursor>({
    output: null,
    snapshotPending: false,
  });
  const authorityEpochRef = useRef<string | null>(null);
  const socketRef = useRef<CompanionSocket | null>(null);
  const commandQueueRef = useRef<AnnotationCommandQueue | null>(null);
  const laserSequenceRef = useRef(0);
  const pairingGenerationRef = useRef<number | null>(null);
  const signalListenersRef = useRef(
    new Set<(signal: PresentationCompanionSignal) => void>(),
  );

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    let heartbeatStartedAt = 0;

    const requestSnapshot = (
      current: DrawableCompanionOutput,
    ) => {
      const request: PresentationCompanionSnapshotRequest = {
        sessionId,
        authorityEpochId: current.authorityEpochId,
        surfaceId: current.surfaceId,
        lastOutputRevision: current.outputRevision,
        lastSurfaceRevision: current.surfaceRevision,
      };
      socket.emit("presentation:companion:snapshot-request", request);
    };
    const queue = new AnnotationCommandQueue({
      createCommand: (input, revision, sequence) => {
        const current = cursorRef.current.output;
        const authorityEpochId = authorityEpochRef.current;
        if (
          !current ||
          current.outputMode === "black" ||
          !authorityEpochId
        ) {
          return null;
        }
        return createCompanionAnnotationCommand(input, {
          sessionId,
          authorityEpochId,
          surfaceId: current.surfaceId,
          baseRevision: revision,
          sequence,
        });
      },
      emit: (command) => {
        socket.emit(
          "presentation:companion:annotation-command",
          command,
        );
      },
      onReconcile: () => {
        setAnnotationRecovering(true);
        const current = cursorRef.current.output;
        if (
          current &&
          current.outputMode !== "black" &&
          socket.connected
        ) {
          requestSnapshot(current);
        }
      },
    });
    commandQueueRef.current = queue;
    const join = () => {
      setStatus("connecting");
      socket.emit("presentation:companion:join", { sessionId });
    };
    const handleDisconnect = () => {
      queue.pause();
      setAnnotationRecovering(true);
      pairingGenerationRef.current = null;
      setPairingGeneration(null);
      setStatus((current) =>
        current === "revoked" ? current : "reconnecting",
      );
    };
    const handleJoined = (value: unknown) => {
      const parsed =
        presentationCompanionJoinedEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.sessionId !== sessionId) return;
      setStatus("connected");
      setError("");
      pairingGenerationRef.current =
        parsed.data.payload.pairingGeneration;
      setPairingGeneration(parsed.data.payload.pairingGeneration);
    };
    const handleAuthorityChanged = (value: unknown) => {
      const parsed =
        presentationCompanionAuthorityChangedEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.sessionId !== sessionId) return;
      const nextAuthority = parsed.data.payload.authorityEpochId;
      if (authorityEpochRef.current !== nextAuthority) {
        authorityEpochRef.current = nextAuthority;
        setAuthorityEpochId(nextAuthority);
        queue.pause();
        laserSequenceRef.current = 0;
        setAnnotationRecovering(true);
        if (nextAuthority === null) {
          return;
        }
        cursorRef.current = {
          output: null,
          snapshotPending: false,
        };
        setOutput(null);
        setAnnotation(null);
        setLastAnnotationAck(null);
        return;
      }
      const currentOutput = cursorRef.current.output;
      if (currentOutput && currentOutput.outputMode !== "black") {
        cursorRef.current = {
          ...cursorRef.current,
          snapshotPending: true,
        };
        requestSnapshot(currentOutput);
      }
    };
    const handleOutput = (value: unknown) => {
      const parsed =
        presentationCompanionOutputStateEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.sessionId !== sessionId) return;
      const incoming = parsed.data.payload;
      if (
        authorityEpochRef.current &&
        incoming.authorityEpochId !== authorityEpochRef.current
      ) {
        return;
      }
      if (!authorityEpochRef.current) {
        authorityEpochRef.current = incoming.authorityEpochId;
        setAuthorityEpochId(incoming.authorityEpochId);
      }
      const consumed = consumeCompanionOutputState(
        cursorRef.current,
        incoming,
      );
      const previousOutput = cursorRef.current.output;
      const outputChanged =
        consumed.cursor.output !== cursorRef.current.output;
      cursorRef.current = consumed.cursor;
      if (incoming.outputMode === "black") {
        queue.pause();
        setAnnotationRecovering(false);
        setAnnotation(null);
      }
      if (outputChanged) {
        setOutput(consumed.cursor.output);
        const nextSurfaceId =
          consumed.cursor.output?.outputMode === "black"
            ? null
            : consumed.cursor.output?.surfaceId;
        if (
          !previousOutput ||
          previousOutput.authorityEpochId !==
            consumed.cursor.output?.authorityEpochId ||
          getCompanionOutputSurfaceId(previousOutput) !== nextSurfaceId
        ) {
          if (consumed.cursor.output?.outputMode !== "black") {
            queue.reset(consumed.cursor.output?.surfaceRevision ?? 0);
          }
          laserSequenceRef.current = 0;
        }
        setAnnotation((current) =>
          current && current.surfaceId !== nextSurfaceId ? null : current,
        );
      }
      if (consumed.requestSnapshot) {
        if (incoming.outputMode !== "black") requestSnapshot(incoming);
      }
    };
    const handleAnnotationAck = (value: unknown) => {
      const parsed =
        presentationCompanionAnnotationAckEventSchema.safeParse(value);
      if (
        parsed.success &&
        parsed.data.sessionId === sessionId &&
        parsed.data.payload.authorityEpochId ===
          authorityEpochRef.current
      ) {
        setLastAnnotationAck(parsed.data.payload);
        queue.acknowledge(parsed.data.payload);
      }
    };
    const handleAnnotationSnapshot = (value: unknown) => {
      const parsed =
        presentationCompanionAnnotationSnapshotEventSchema.safeParse(
          value,
        );
      if (!parsed.success || parsed.data.sessionId !== sessionId) return;
      setAnnotation((current) => {
        const next = consumeCompanionAnnotationSnapshot({
          authorityEpochId: authorityEpochRef.current,
          current,
          incoming: parsed.data.payload,
          surfaceId:
            cursorRef.current.output?.outputMode === "black"
              ? null
              : cursorRef.current.output?.surfaceId ?? null,
        });
        if (next !== current) {
          queue.reset(next?.surfaceRevision ?? 0);
          setAnnotationRecovering(false);
        }
        return next;
      });
    };
    const handleRevoked = (value: unknown) => {
      const parsed =
        presentationCompanionRevokedEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.sessionId !== sessionId) return;
      pairingGenerationRef.current = null;
      setPairingGeneration(null);
      setStatus("revoked");
      setError("발표자가 iPad 연결을 종료했습니다.");
    };
    const handleSignal = (value: unknown) => {
      const parsed =
        presentationCompanionSignalEventSchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.sessionId !== sessionId ||
        parsed.data.payload.targetGeneration !==
          pairingGenerationRef.current ||
        parsed.data.payload.authorityEpochId !==
          authorityEpochRef.current
      ) {
        return;
      }
      for (const listener of signalListenersRef.current) {
        listener(parsed.data.payload);
      }
    };
    const handleError = (value: unknown) => {
      const parsed =
        presentationCompanionErrorEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.sessionId !== sessionId) return;
      if (
        parsed.data.payload.code === "AUTH_REQUIRED" ||
        parsed.data.payload.code === "STALE_GENERATION" ||
        parsed.data.payload.code === "SESSION_UNAVAILABLE"
      ) {
        setStatus("failed");
        setError("iPad 발표 도우미 연결을 다시 확인해주세요.");
      }
    };

    socket.on("connect", join);
    socket.on("disconnect", handleDisconnect);
    socket.on("presentation:companion:joined", handleJoined);
    socket.on(
      "presentation:companion:authority-changed",
      handleAuthorityChanged,
    );
    socket.on("presentation:companion:output-state", handleOutput);
    socket.on(
      "presentation:companion:annotation-ack",
      handleAnnotationAck,
    );
    socket.on(
      "presentation:companion:annotation-snapshot",
      handleAnnotationSnapshot,
    );
    socket.on("presentation:companion:revoked", handleRevoked);
    socket.on("presentation:companion:signal", handleSignal);
    socket.on("presentation:error", handleError);
    if (socket.connected) join();

    const recover = (event: Event) => {
      if (
        document.visibilityState !== "visible" &&
        event.type === "visibilitychange"
      ) {
        return;
      }
      queue.pause();
      setAnnotationRecovering(true);
      if (!socket.connected) {
        socket.connect();
        return;
      }
      join();
      const current = cursorRef.current.output;
      if (current?.outputMode === "black") {
        setAnnotationRecovering(false);
      } else if (current) {
        requestSnapshot(current);
      }
    };
    window.addEventListener("online", recover);
    window.addEventListener("pageshow", recover);
    document.addEventListener("visibilitychange", recover);

    const heartbeatId = window.setInterval(() => {
      heartbeatStartedAt = performance.now();
      socket.emit(
        "presentation:companion:heartbeat",
        { sessionId },
        () => {
          const rttMs = Math.max(0, performance.now() - heartbeatStartedAt);
          socket.emit("presentation:companion:heartbeat", {
            sessionId,
            rttMs,
          });
        },
      );
    }, 5_000);

    return () => {
      window.clearInterval(heartbeatId);
      window.removeEventListener("online", recover);
      window.removeEventListener("pageshow", recover);
      document.removeEventListener("visibilitychange", recover);
      socket.off("connect", join);
      socket.off("disconnect", handleDisconnect);
      socket.off("presentation:companion:joined", handleJoined);
      socket.off(
        "presentation:companion:authority-changed",
        handleAuthorityChanged,
      );
      socket.off("presentation:companion:output-state", handleOutput);
      socket.off(
        "presentation:companion:annotation-ack",
        handleAnnotationAck,
      );
      socket.off(
        "presentation:companion:annotation-snapshot",
        handleAnnotationSnapshot,
      );
      socket.off("presentation:companion:revoked", handleRevoked);
      socket.off("presentation:companion:signal", handleSignal);
      socket.off("presentation:error", handleError);
      socket.disconnect();
      queue.dispose();
      if (commandQueueRef.current === queue) {
        commandQueueRef.current = null;
      }
      if (socketRef.current === socket) socketRef.current = null;
      pairingGenerationRef.current = null;
    };
  }, [createSocket, sessionId]);

  const sendAnnotationCommand = (
    input: CompanionAnnotationCommandInput,
  ): boolean => {
    const queue = commandQueueRef.current;
    if (
      !queue ||
      status !== "connected" ||
      annotationRecovering ||
      !authorityEpochId ||
      !output ||
      output.outputMode === "black"
    ) {
      return false;
    }
    return queue.enqueue(input);
  };

  const sendLaser = (
    input:
      | { kind: "hide" }
      | { kind: "move"; x: number; y: number },
  ): boolean => {
    const socket = socketRef.current;
    if (
      !socket ||
      status !== "connected" ||
      !authorityEpochId ||
      !output ||
      output.outputMode === "black"
    ) {
      return false;
    }
    const parsed = presentationCompanionLaserSchema.safeParse({
      ...input,
      sessionId,
      authorityEpochId,
      surfaceId: output.surfaceId,
      sequence: laserSequenceRef.current,
    });
    if (!parsed.success) return false;
    (socket.volatile ?? socket).emit(
      "presentation:companion:laser",
      parsed.data,
    );
    laserSequenceRef.current += 1;
    return true;
  };

  const sendSignal = useCallback(
    (signal: CompanionSignalInput): boolean => {
      const socket = socketRef.current;
      if (
        !socket ||
        status !== "connected" ||
        !authorityEpochId ||
        pairingGeneration === null
      ) {
        return false;
      }
      const parsed = presentationCompanionSignalSchema.safeParse({
        ...signal,
        sessionId,
        authorityEpochId,
        targetGeneration: pairingGeneration,
      });
      if (!parsed.success) return false;
      socket.emit("presentation:companion:signal", parsed.data);
      return true;
    },
    [authorityEpochId, pairingGeneration, sessionId, status],
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
    annotation,
    annotationRecovering,
    authorityEpochId,
    error,
    lastAnnotationAck,
    output,
    pairingGeneration,
    sendAnnotationCommand,
    sendLaser,
    sendSignal,
    status,
    subscribeSignal,
  };
}

export function createCompanionAnnotationCommand(
  input: CompanionAnnotationCommandInput,
  metadata: {
    authorityEpochId: string;
    baseRevision: number;
    sequence: number;
    sessionId: string;
    surfaceId: string;
  },
): PresentationCompanionAnnotationCommand | null {
  const parsed = presentationCompanionAnnotationCommandSchema.safeParse({
    ...input,
    ...metadata,
  });
  return parsed.success ? parsed.data : null;
}

export function consumeCompanionAnnotationSnapshot(input: {
  authorityEpochId: string | null;
  current: PresentationCompanionAnnotationSnapshot | null;
  incoming: PresentationCompanionAnnotationSnapshot;
  surfaceId: string | null;
}): PresentationCompanionAnnotationSnapshot | null {
  if (
    !input.authorityEpochId ||
    input.incoming.authorityEpochId !== input.authorityEpochId ||
    (input.surfaceId && input.incoming.surfaceId !== input.surfaceId)
  ) {
    return input.current;
  }
  if (
    input.current?.surfaceId === input.incoming.surfaceId &&
    input.current.surfaceRevision > input.incoming.surfaceRevision
  ) {
    return input.current;
  }
  return input.incoming;
}

function getCompanionOutputSurfaceId(
  output: PresentationCompanionOutputState | null,
): string | null {
  return output?.outputMode === "black" ? null : output?.surfaceId ?? null;
}
