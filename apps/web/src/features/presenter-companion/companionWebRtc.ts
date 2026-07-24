import type { PresentationCompanionSignal } from "@orbit/shared";

export type CompanionWebRtcStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "failed";

export type CompanionSignalInput =
  | {
      kind: "offer" | "answer";
      sdp: string;
      shareEpochId: string;
      signalId: string;
    }
  | {
      candidate: string;
      kind: "ice";
      sdpMid: string | null;
      sdpMLineIndex: number | null;
      shareEpochId: string;
      signalId: string;
      usernameFragment?: string;
    }
  | {
      kind: "end";
      reason:
        | "capture-ended"
        | "replaced"
        | "revoked"
        | "closed"
        | "failed";
      shareEpochId: string;
      signalId: string;
    };

export type CompanionWebRtcSenderPort = {
  replaceTrack: (track: MediaStreamTrack | null) => Promise<void>;
};

export type CompanionWebRtcPeerPort = {
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  addVideoTrack: (
    track: MediaStreamTrack,
    stream: MediaStream,
  ) => CompanionWebRtcSenderPort;
  close: () => void;
  createAnswer: () => Promise<RTCSessionDescriptionInit>;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  hasRemoteDescription: () => boolean;
  onConnectionStateChange: (
    listener: (state: RTCPeerConnectionState) => void,
  ) => void;
  onIceCandidate: (
    listener: (candidate: RTCIceCandidateInit | null) => void,
  ) => void;
  onVideoTrack: (
    listener: (stream: MediaStream, track: MediaStreamTrack) => void,
  ) => void;
  receiveVideo: () => void;
  setLocalDescription: (
    description: RTCSessionDescriptionInit,
  ) => Promise<void>;
  setRemoteDescription: (
    description: RTCSessionDescriptionInit,
  ) => Promise<void>;
};

export type CompanionWebRtcPeerFactory = () => CompanionWebRtcPeerPort;

type ControllerOptions = {
  createPeer?: CompanionWebRtcPeerFactory;
  onStatusChange?: (status: CompanionWebRtcStatus) => void;
  sendSignal: (signal: CompanionSignalInput) => boolean;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (timerId: number) => void;
};

const connectionTimeoutMs = 2_000;
export const companionPendingIceLimit = 64;

export function createPresenterCompanionWebRtcController(
  options: ControllerOptions,
) {
  const createPeer = options.createPeer ?? createBrowserPeer;
  const schedule =
    options.setTimeout ??
    ((callback, delayMs) =>
      globalThis.setTimeout(callback, delayMs) as unknown as number);
  const cancel =
    options.clearTimeout ??
    ((timerId) => globalThis.clearTimeout(timerId));
  let active:
    | {
        peer: CompanionWebRtcPeerPort;
        pendingIce: RTCIceCandidateInit[];
        sender: CompanionWebRtcSenderPort;
        shareEpochId: string;
        signalId: string;
        stream: MediaStream;
        timerId: number;
      }
    | null = null;
  let operationId = 0;
  let disposed = false;

  const setStatus = (status: CompanionWebRtcStatus) => {
    if (!disposed) options.onStatusChange?.(status);
  };
  const sendEnd = (
    current: NonNullable<typeof active>,
    reason: Extract<
      CompanionSignalInput,
      { kind: "end" }
    >["reason"],
  ) => {
    options.sendSignal({
      kind: "end",
      reason,
      shareEpochId: current.shareEpochId,
      signalId: current.signalId,
    });
  };
  const closeActive = (
    reason?: Extract<
      CompanionSignalInput,
      { kind: "end" }
    >["reason"],
  ) => {
    const current = active;
    active = null;
    operationId += 1;
    if (!current) return;
    cancel(current.timerId);
    if (reason) sendEnd(current, reason);
    current.peer.close();
  };
  const fail = (current: NonNullable<typeof active>) => {
    if (active !== current) return;
    sendEnd(current, "failed");
    closeActive();
    setStatus("failed");
  };

  const start = async (next: {
    shareEpochId: string;
    stream: MediaStream;
  }) => {
    const videoTrack = next.stream.getVideoTracks()[0];
    if (!videoTrack) {
      closeActive(active ? "replaced" : undefined);
      setStatus("failed");
      return false;
    }
    if (active?.shareEpochId === next.shareEpochId) {
      if (active.stream === next.stream) return true;
      try {
        await active.sender.replaceTrack(videoTrack);
        if (active) active.stream = next.stream;
        return true;
      } catch {
        if (active) fail(active);
        return false;
      }
    }

    closeActive(active ? "replaced" : undefined);
    const currentOperationId = ++operationId;
    let peer: CompanionWebRtcPeerPort;
    try {
      peer = createPeer();
    } catch {
      setStatus("failed");
      return false;
    }
    const current = {
      peer,
      pendingIce: [] as RTCIceCandidateInit[],
      sender: peer.addVideoTrack(videoTrack, next.stream),
      shareEpochId: next.shareEpochId,
      signalId: createSignalId(),
      stream: next.stream,
      timerId: 0,
    };
    active = current;
    setStatus("connecting");
    peer.onIceCandidate((candidate) => {
      if (!candidate?.candidate || active !== current) return;
      options.sendSignal({
        candidate: candidate.candidate ?? "",
        kind: "ice",
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        shareEpochId: current.shareEpochId,
        signalId: current.signalId,
        ...(candidate.usernameFragment
          ? { usernameFragment: candidate.usernameFragment }
          : {}),
      });
    });
    peer.onConnectionStateChange((state) => {
      if (active !== current) return;
      if (state === "connected") {
        cancel(current.timerId);
        setStatus("connected");
      } else if (
        state === "failed" ||
        state === "closed" ||
        state === "disconnected"
      ) {
        fail(current);
      }
    });
    current.timerId = schedule(() => fail(current), connectionTimeoutMs);

    try {
      const offer = await peer.createOffer();
      if (
        disposed ||
        active !== current ||
        currentOperationId !== operationId
      ) {
        return false;
      }
      await peer.setLocalDescription(offer);
      const sent = options.sendSignal({
        kind: "offer",
        sdp: offer.sdp ?? "",
        shareEpochId: current.shareEpochId,
        signalId: current.signalId,
      });
      if (!sent) {
        fail(current);
        return false;
      }
      return true;
    } catch {
      fail(current);
      return false;
    }
  };

  const handleSignal = async (signal: PresentationCompanionSignal) => {
    const current = active;
    if (
      !current ||
      signal.shareEpochId !== current.shareEpochId ||
      signal.signalId !== current.signalId
    ) {
      return;
    }
    try {
      if (signal.kind === "answer") {
        await current.peer.setRemoteDescription({
          sdp: signal.sdp,
          type: "answer",
        });
        for (const candidate of current.pendingIce.splice(0)) {
          await current.peer.addIceCandidate(candidate);
        }
      } else if (signal.kind === "ice") {
        const candidate = toIceCandidate(signal);
        if (!current.peer.hasRemoteDescription()) {
          current.pendingIce.push(candidate);
        } else {
          await current.peer.addIceCandidate(candidate);
        }
      } else if (signal.kind === "end") {
        closeActive();
        setStatus("failed");
      }
    } catch {
      fail(current);
    }
  };

  return {
    dispose: () => {
      if (disposed) return;
      closeActive(active ? "closed" : undefined);
      disposed = true;
    },
    handleSignal,
    setShare: (next: {
      shareEpochId: string;
      stream: MediaStream;
    } | null) => {
      disposed = false;
      if (!next) {
        closeActive(active ? "capture-ended" : undefined);
        setStatus("idle");
        return Promise.resolve(true);
      }
      return start(next);
    },
  };
}

export function createReceiverCompanionWebRtcController(
  options: ControllerOptions & {
    onStreamChange?: (stream: MediaStream | null) => void;
  },
) {
  const createPeer = options.createPeer ?? createBrowserPeer;
  const schedule =
    options.setTimeout ??
    ((callback, delayMs) =>
      globalThis.setTimeout(callback, delayMs) as unknown as number);
  const cancel =
    options.clearTimeout ??
    ((timerId) => globalThis.clearTimeout(timerId));
  let expectedShareEpochId: string | null = null;
  type OfferSignal = Extract<
    PresentationCompanionSignal,
    { kind: "offer" }
  >;
  type IceSignal = Extract<
    PresentationCompanionSignal,
    { kind: "ice" }
  >;
  let active:
    | {
        peer: CompanionWebRtcPeerPort;
        pendingIce: RTCIceCandidateInit[];
        shareEpochId: string;
        signalId: string;
        timerId: number;
      }
    | null = null;
  let pending:
    | {
        ice: IceSignal[];
        offer: OfferSignal | null;
        shareEpochId: string;
        signalId: string;
      }
    | null = null;
  let disposed = false;

  const setStatus = (status: CompanionWebRtcStatus) => {
    if (!disposed) options.onStatusChange?.(status);
  };
  const closeActive = () => {
    const current = active;
    active = null;
    if (current) {
      cancel(current.timerId);
      current.peer.close();
      options.onStreamChange?.(null);
    }
  };
  const fail = (current: NonNullable<typeof active>) => {
    if (active !== current) return;
    closeActive();
    setStatus("failed");
  };

  const acceptOffer = async (
    signal: OfferSignal,
    initialIce: IceSignal[] = [],
  ) => {
    closeActive();
    let peer: CompanionWebRtcPeerPort;
    try {
      peer = createPeer();
    } catch {
      setStatus("failed");
      return;
    }
    const current = {
      peer,
      pendingIce: initialIce.map(toIceCandidate),
      shareEpochId: signal.shareEpochId,
      signalId: signal.signalId,
      timerId: 0,
    };
    active = current;
    setStatus("connecting");
    peer.receiveVideo();
    peer.onIceCandidate((candidate) => {
      if (!candidate?.candidate || active !== current) return;
      options.sendSignal({
        candidate: candidate.candidate ?? "",
        kind: "ice",
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        shareEpochId: current.shareEpochId,
        signalId: current.signalId,
        ...(candidate.usernameFragment
          ? { usernameFragment: candidate.usernameFragment }
          : {}),
      });
    });
    peer.onVideoTrack((stream, track) => {
      if (active !== current || track.kind !== "video") return;
      options.onStreamChange?.(stream);
    });
    peer.onConnectionStateChange((state) => {
      if (active !== current) return;
      if (state === "connected") {
        cancel(current.timerId);
        setStatus("connected");
      } else if (
        state === "failed" ||
        state === "closed" ||
        state === "disconnected"
      ) {
        fail(current);
      }
    });
    current.timerId = schedule(() => fail(current), connectionTimeoutMs);

    try {
      await peer.setRemoteDescription({
        sdp: signal.sdp,
        type: "offer",
      });
      const answer = await peer.createAnswer();
      if (active !== current) return;
      await peer.setLocalDescription(answer);
      const sent = options.sendSignal({
        kind: "answer",
        sdp: answer.sdp ?? "",
        shareEpochId: current.shareEpochId,
        signalId: current.signalId,
      });
      if (!sent) {
        fail(current);
        return;
      }
      for (const candidate of current.pendingIce.splice(0)) {
        await peer.addIceCandidate(candidate);
      }
    } catch {
      fail(current);
    }
  };

  const bufferOffer = (signal: OfferSignal) => {
    const currentPending = pending;
    const ice =
      currentPending?.shareEpochId === signal.shareEpochId &&
      currentPending.signalId === signal.signalId
        ? currentPending.ice
        : [];
    pending = {
      ice,
      offer: signal,
      shareEpochId: signal.shareEpochId,
      signalId: signal.signalId,
    };
  };
  const bufferIce = (signal: IceSignal) => {
    const currentPending = pending;
    if (
      !currentPending ||
      currentPending.shareEpochId !== signal.shareEpochId ||
      currentPending.signalId !== signal.signalId
    ) {
      pending = {
        ice: [signal],
        offer: null,
        shareEpochId: signal.shareEpochId,
        signalId: signal.signalId,
      };
      return;
    }
    if (currentPending.ice.length < companionPendingIceLimit) {
      currentPending.ice.push(signal);
    }
  };
  const takePendingOffer = (
    shareEpochId: string,
  ): { ice: IceSignal[]; offer: OfferSignal } | null => {
    if (!pending || pending.shareEpochId !== shareEpochId) {
      pending = null;
      return null;
    }
    if (!pending.offer) return null;
    const buffered = { ice: pending.ice, offer: pending.offer };
    pending = null;
    return buffered;
  };

  const handleSignal = async (signal: PresentationCompanionSignal) => {
    if (
      !expectedShareEpochId ||
      signal.shareEpochId !== expectedShareEpochId
    ) {
      if (signal.kind === "offer") bufferOffer(signal);
      else if (signal.kind === "ice") bufferIce(signal);
      else if (
        pending?.shareEpochId === signal.shareEpochId &&
        pending.signalId === signal.signalId
      ) {
        pending = null;
      }
      return;
    }
    if (signal.kind === "offer") {
      const bufferedIce =
        pending?.shareEpochId === signal.shareEpochId &&
        pending.signalId === signal.signalId
          ? pending.ice
          : [];
      pending = null;
      await acceptOffer(signal, bufferedIce);
      return;
    }
    const current = active;
    if (!current && signal.kind === "ice") {
      bufferIce(signal);
      return;
    }
    if (
      !current ||
      signal.shareEpochId !== current.shareEpochId ||
      signal.signalId !== current.signalId
    ) {
      return;
    }
    try {
      if (signal.kind === "ice") {
        const candidate = toIceCandidate(signal);
        if (!current.peer.hasRemoteDescription()) {
          if (current.pendingIce.length < companionPendingIceLimit) {
            current.pendingIce.push(candidate);
          }
        } else {
          await current.peer.addIceCandidate(candidate);
        }
      } else if (signal.kind === "end") {
        closeActive();
        setStatus("failed");
      }
    } catch {
      fail(current);
    }
  };

  return {
    dispose: () => {
      if (disposed) return;
      closeActive();
      pending = null;
      disposed = true;
    },
    handleSignal,
    setExpectedShareEpoch: (shareEpochId: string | null) => {
      disposed = false;
      if (expectedShareEpochId === shareEpochId) {
        return Promise.resolve();
      }
      expectedShareEpochId = shareEpochId;
      closeActive();
      setStatus(shareEpochId ? "connecting" : "idle");
      if (!shareEpochId) {
        pending = null;
        return Promise.resolve();
      }
      const buffered = takePendingOffer(shareEpochId);
      return buffered
        ? acceptOffer(buffered.offer, buffered.ice)
        : Promise.resolve();
    },
  };
}

function createBrowserPeer(): CompanionWebRtcPeerPort {
  const peer = new RTCPeerConnection({ iceServers: [] });
  return {
    addIceCandidate: async (candidate) => {
      await peer.addIceCandidate(candidate);
    },
    addVideoTrack: (track, stream) => {
      const sender = peer.addTrack(track, stream);
      return {
        replaceTrack: async (nextTrack) => {
          await sender.replaceTrack(nextTrack);
        },
      };
    },
    close: () => peer.close(),
    createAnswer: () => peer.createAnswer(),
    createOffer: () => peer.createOffer(),
    hasRemoteDescription: () => Boolean(peer.remoteDescription),
    onConnectionStateChange: (listener) => {
      peer.onconnectionstatechange = () => listener(peer.connectionState);
    },
    onIceCandidate: (listener) => {
      peer.onicecandidate = (event) =>
        listener(event.candidate?.toJSON() ?? null);
    },
    onVideoTrack: (listener) => {
      peer.ontrack = (event) => {
        const stream =
          event.streams[0] ?? new MediaStream([event.track]);
        listener(stream, event.track);
      };
    },
    receiveVideo: () => {
      peer.addTransceiver("video", { direction: "recvonly" });
    },
    setLocalDescription: async (description) => {
      await peer.setLocalDescription(description);
    },
    setRemoteDescription: async (description) => {
      await peer.setRemoteDescription(description);
    },
  };
}

function toIceCandidate(
  signal: Extract<PresentationCompanionSignal, { kind: "ice" }>,
): RTCIceCandidateInit {
  return {
    candidate: signal.candidate,
    sdpMid: signal.sdpMid,
    sdpMLineIndex: signal.sdpMLineIndex,
    ...(signal.usernameFragment
      ? { usernameFragment: signal.usernameFragment }
      : {}),
  };
}

function createSignalId() {
  return `signal_${crypto.randomUUID().replace(/-/g, "")}`;
}
