import type { PresentationCompanionSignal } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";
import {
  companionPendingIceLimit,
  createPresenterCompanionWebRtcController,
  createReceiverCompanionWebRtcController,
  type CompanionWebRtcPeerPort,
  type CompanionWebRtcStatus,
} from "./companionWebRtc";

describe("presenter companion WebRTC controller", () => {
  it("sends video only and correlates offer, answer, and ICE", async () => {
    const peer = createPeer();
    const sent: SignalInput[] = [];
    const statuses: CompanionWebRtcStatus[] = [];
    const controller =
      createPresenterCompanionWebRtcController({
        createPeer: () => peer.port,
        onStatusChange: (status) => statuses.push(status),
        sendSignal: (signal) => {
          sent.push(signal);
          return true;
        },
      });
    const firstVideo = createTrack("video", "video_1");
    const audio = createTrack("audio", "audio_1");

    await controller.setShare({
      shareEpochId: "share_1",
      stream: createStream([firstVideo], [audio]),
    });

    expect(peer.addVideoTrack).toHaveBeenCalledTimes(1);
    expect(peer.addVideoTrack).toHaveBeenCalledWith(
      firstVideo,
      expect.anything(),
    );
    expect(peer.addVideoTrack).not.toHaveBeenCalledWith(
      audio,
      expect.anything(),
    );
    const offer = sent.find((signal) => signal.kind === "offer");
    expect(offer?.signalId).toMatch(/^signal_/);

    await controller.handleSignal(
      incoming({
        kind: "answer",
        sdp: "answer-sdp",
        signalId: offer?.signalId ?? "",
      }),
    );
    await controller.handleSignal(
      incoming({
        candidate: "candidate:1",
        kind: "ice",
        sdpMid: "0",
        sdpMLineIndex: 0,
        signalId: offer?.signalId ?? "",
      }),
    );
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      sdp: "answer-sdp",
      type: "answer",
    });
    expect(peer.addIceCandidate).toHaveBeenCalledTimes(1);

    peer.emitConnectionState("connected");
    expect(statuses.at(-1)).toBe("connected");
    const replacement = createTrack("video", "video_2");
    await controller.setShare({
      shareEpochId: "share_1",
      stream: createStream([replacement], [audio]),
    });
    expect(peer.replaceTrack).toHaveBeenCalledWith(replacement);
    controller.dispose();
  });

  it("times out the companion peer without stopping capture tracks", async () => {
    const peer = createPeer();
    const video = createTrack("video", "video_1");
    const stream = createStream([video], []);
    const statuses: CompanionWebRtcStatus[] = [];
    let timeout: (() => void) | null = null;
    const sent: SignalInput[] = [];
    const controller =
      createPresenterCompanionWebRtcController({
        clearTimeout: vi.fn(),
        createPeer: () => peer.port,
        onStatusChange: (status) => statuses.push(status),
        sendSignal: (signal) => {
          sent.push(signal);
          return true;
        },
        setTimeout: (callback, delayMs) => {
          expect(delayMs).toBe(2_000);
          timeout = callback;
          return 1;
        },
      });

    await controller.setShare({
      shareEpochId: "share_1",
      stream,
    });
    expect(timeout).not.toBeNull();
    (timeout as unknown as () => void)();

    expect(statuses.at(-1)).toBe("failed");
    expect(peer.close).toHaveBeenCalled();
    expect(
      sent.some(
        (signal) =>
          signal.kind === "end" && signal.reason === "failed",
      ),
    ).toBe(true);
    expect(video.stop).not.toHaveBeenCalled();
  });
});

describe("iPad companion WebRTC controller", () => {
  it("buffers an offer and bounded early ICE until the output epoch is expected", async () => {
    const peer = createPeer();
    const controller =
      createReceiverCompanionWebRtcController({
        createPeer: () => peer.port,
        sendSignal: () => true,
      });

    for (let index = 0; index < companionPendingIceLimit + 1; index += 1) {
      await controller.handleSignal(
        incoming({
          candidate: `candidate:${index}`,
          kind: "ice",
          sdpMid: "0",
          sdpMLineIndex: 0,
          signalId: "signal_early",
        }),
      );
    }
    await controller.handleSignal(
      incoming({
        kind: "offer",
        sdp: "early-offer",
        signalId: "signal_early",
      }),
    );

    expect(peer.setRemoteDescription).not.toHaveBeenCalled();

    await controller.setExpectedShareEpoch("share_1");

    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      sdp: "early-offer",
      type: "offer",
    });
    expect(peer.addIceCandidate).toHaveBeenCalledTimes(
      companionPendingIceLimit,
    );
  });

  it("discards a buffered negotiation when another output epoch becomes current", async () => {
    const peer = createPeer();
    const controller =
      createReceiverCompanionWebRtcController({
        createPeer: () => peer.port,
        sendSignal: () => true,
      });

    await controller.handleSignal(
      incoming({
        kind: "offer",
        sdp: "stale-offer",
        shareEpochId: "share_stale",
        signalId: "signal_stale",
      }),
    );
    await controller.setExpectedShareEpoch("share_current");
    await controller.setExpectedShareEpoch("share_stale");

    expect(peer.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("answers one expected epoch and exposes a video receiver", async () => {
    const peer = createPeer();
    const sent: SignalInput[] = [];
    const streams: Array<MediaStream | null> = [];
    const controller =
      createReceiverCompanionWebRtcController({
        createPeer: () => peer.port,
        onStreamChange: (stream) => streams.push(stream),
        sendSignal: (signal) => {
          sent.push(signal);
          return true;
        },
      });
    await controller.setExpectedShareEpoch("share_1");

    await controller.handleSignal(
      incoming({
        kind: "offer",
        sdp: "offer-sdp",
        signalId: "signal_1",
      }),
    );
    expect(peer.receiveVideo).toHaveBeenCalledTimes(1);
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      sdp: "offer-sdp",
      type: "offer",
    });
    expect(sent).toContainEqual(
      expect.objectContaining({
        kind: "answer",
        shareEpochId: "share_1",
        signalId: "signal_1",
      }),
    );

    const streamCountBeforeAudio = streams.length;
    peer.emitVideo(
      createStream([], [createTrack("audio", "audio_1")]),
      createTrack("audio", "audio_1"),
    );
    expect(streams).toHaveLength(streamCountBeforeAudio);
    const received = createStream(
      [createTrack("video", "video_1")],
      [],
    );
    peer.emitVideo(received, received.getVideoTracks()[0]);
    expect(streams.at(-1)).toBe(received);
    controller.dispose();
  });

  it("ignores stale epochs and mismatched negotiation ids", async () => {
    const peer = createPeer();
    const controller =
      createReceiverCompanionWebRtcController({
        createPeer: () => peer.port,
        sendSignal: () => true,
      });
    await controller.setExpectedShareEpoch("share_current");
    await controller.handleSignal(
      incoming({
        kind: "offer",
        sdp: "stale-offer",
        shareEpochId: "share_stale",
        signalId: "signal_stale",
      }),
    );
    expect(peer.setRemoteDescription).not.toHaveBeenCalled();

    await controller.handleSignal(
      incoming({
        kind: "offer",
        sdp: "current-offer",
        shareEpochId: "share_current",
        signalId: "signal_current",
      }),
    );
    await controller.handleSignal(
      incoming({
        candidate: "candidate:stale",
        kind: "ice",
        sdpMid: "0",
        sdpMLineIndex: 0,
        shareEpochId: "share_current",
        signalId: "signal_other",
      }),
    );
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
  });
});

type SignalInput = Parameters<
  Parameters<typeof createPresenterCompanionWebRtcController>[0]["sendSignal"]
>[0];

function createPeer() {
  let connectionListener:
    | ((state: RTCPeerConnectionState) => void)
    | null = null;
  let videoListener:
    | ((stream: MediaStream, track: MediaStreamTrack) => void)
    | null = null;
  let remoteDescription = false;
  const replaceTrack = vi.fn(async () => undefined);
  const addIceCandidate = vi.fn(async () => undefined);
  const addVideoTrack = vi.fn(() => ({ replaceTrack }));
  const close = vi.fn();
  const receiveVideo = vi.fn();
  const setRemoteDescription = vi.fn(async () => {
    remoteDescription = true;
  });
  const port: CompanionWebRtcPeerPort = {
    addIceCandidate,
    addVideoTrack,
    close,
    createAnswer: async () => ({
      sdp: "answer-sdp",
      type: "answer",
    }),
    createOffer: async () => ({ sdp: "offer-sdp", type: "offer" }),
    hasRemoteDescription: () => remoteDescription,
    onConnectionStateChange: (listener) => {
      connectionListener = listener;
    },
    onIceCandidate: () => undefined,
    onVideoTrack: (listener) => {
      videoListener = listener;
    },
    receiveVideo,
    setLocalDescription: async () => undefined,
    setRemoteDescription,
  };
  return {
    addIceCandidate,
    addVideoTrack,
    close,
    emitConnectionState: (state: RTCPeerConnectionState) =>
      connectionListener?.(state),
    emitVideo: (stream: MediaStream, track: MediaStreamTrack) =>
      videoListener?.(stream, track),
    port,
    receiveVideo,
    replaceTrack,
    setRemoteDescription,
  };
}

function incoming(
  signal:
    | {
        kind: "offer" | "answer";
        sdp: string;
        shareEpochId?: string;
        signalId: string;
      }
    | {
        candidate: string;
        kind: "ice";
        sdpMid: string | null;
        sdpMLineIndex: number | null;
        shareEpochId?: string;
        signalId: string;
      },
): PresentationCompanionSignal {
  return {
    ...signal,
    authorityEpochId: "epoch_1",
    sessionId: "session_1",
    shareEpochId: signal.shareEpochId ?? "share_1",
    targetGeneration: 1,
  };
}

function createStream(
  video: MediaStreamTrack[],
  audio: MediaStreamTrack[],
): MediaStream {
  return {
    getAudioTracks: () => audio,
    getVideoTracks: () => video,
  } as unknown as MediaStream;
}

function createTrack(
  kind: "audio" | "video",
  id: string,
): MediaStreamTrack {
  return {
    id,
    kind,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}
