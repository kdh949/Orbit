import { describe, expect, it, vi } from "vitest";
import type { LiveSttAudioLevelEvent } from "../liveStt";
import type { LiveSttResult } from "./liveSttPort";
import { OpenAiRealtimeLiveSttPort } from "./openAiRealtimeLiveSttPort";

describe("OpenAiRealtimeLiveSttPort", () => {
  it("connects with a project-scoped client secret and maps delta/completed events", async () => {
    const peerConnection = new FakePeerConnection();
    const fetcher = createOpenAiRealtimeFetcher();
    const port = new OpenAiRealtimeLiveSttPort({
      projectId: "project_real_1",
      createAudioLevelMeter: () => noopMeter(),
      createPeerConnection: () => peerConnection,
      fetcher,
      now: () => 1000
    });
    const results: LiveSttResult[] = [];
    port.onResult((result) => results.push(result));

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream()
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project_real_1/realtime-transcription/client-secret",
      {
        credentials: "include",
        method: "POST"
      }
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/calls",
      expect.objectContaining({
        body: "offer-sdp",
        headers: {
          Authorization: "Bearer ek_test",
          "Content-Type": "application/sdp"
        },
        method: "POST"
      })
    );
    expect(peerConnection.remoteDescription).toEqual({
      type: "answer",
      sdp: "answer-sdp"
    });

    peerConnection.dataChannel.emitMessage({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_1",
      content_index: 0,
      delta: "오르"
    });
    peerConnection.dataChannel.emitMessage({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_1",
      content_index: 0,
      delta: "빗"
    });
    peerConnection.dataChannel.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_1",
      content_index: 0,
      transcript: "오르빗"
    });

    expect(results).toEqual([
      { text: "오르", isFinal: false, timestampMs: [0, 0] },
      { text: "오르빗", isFinal: false, timestampMs: [0, 0] },
      { text: "오르빗", isFinal: true, timestampMs: [0, 0] }
    ]);
  });

  it("wraps the default browser fetch so native receivers stay valid", async () => {
    const originalFetch = globalThis.fetch;
    const nativeLikeFetch = vi.fn(function (
      this: unknown,
      input: RequestInfo | URL
    ) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }

      const value = String(input);
      if (value.includes("/realtime-transcription/client-secret")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              clientSecret: "ek_test",
              expiresAt: 1790000000,
              model: "gpt-realtime-whisper",
              delay: "minimal"
            })
          )
        );
      }

      return Promise.resolve(new Response("answer-sdp"));
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", nativeLikeFetch);

    try {
      const port = new OpenAiRealtimeLiveSttPort({
        projectId: "project_real_1",
        createAudioLevelMeter: () => noopMeter(),
        createPeerConnection: () => new FakePeerConnection(),
        now: () => 1000
      });

      await port.start({
        language: "ko",
        audioSource: fakeMediaStream()
      });

      expect(nativeLikeFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("uses item_id/content_index to finalize the matching accumulated partial", async () => {
    const peerConnection = new FakePeerConnection();
    const port = new OpenAiRealtimeLiveSttPort({
      projectId: "project_real_1",
      createAudioLevelMeter: () => noopMeter(),
      createPeerConnection: () => peerConnection,
      fetcher: createOpenAiRealtimeFetcher(),
      now: () => 1000
    });
    const results: LiveSttResult[] = [];
    port.onResult((result) => results.push(result));

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream()
    });

    peerConnection.dataChannel.emitMessage({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_a",
      content_index: 0,
      delta: "첫 번째"
    });
    peerConnection.dataChannel.emitMessage({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_b",
      content_index: 0,
      delta: "두 번째"
    });
    peerConnection.dataChannel.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_a",
      content_index: 0
    });

    expect(results.at(-1)).toEqual({
      text: "첫 번째",
      isFinal: true,
      timestampMs: [0, 0]
    });
  });

  it("stores bias phrases locally because gpt-realtime-whisper does not accept prompt steering", async () => {
    const port = new OpenAiRealtimeLiveSttPort({
      projectId: "project_real_1",
      createAudioLevelMeter: () => noopMeter(),
      createPeerConnection: () => new FakePeerConnection(),
      fetcher: createOpenAiRealtimeFetcher(),
      now: () => 1000
    });

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream(),
      biasPhrases: [{ text: "  오르빗  ", weight: 1, source: "keyword" }]
    });
    port.updateBiasPhrases([{ text: "다음  슬라이드", weight: 0.7 }]);

    expect(port.readBiasPhrasesForTest()).toEqual([
      { text: "다음 슬라이드", weight: 0.7 }
    ]);
  });

  it("emits audio levels through the supplied meter and cleans up on stop", async () => {
    const audioLevel: LiveSttAudioLevelEvent = {
      type: "audio-level",
      rms: 0.1,
      peak: 0.2,
      rmsDb: -20,
      peakDb: -10,
      isLikelySilence: false
    };
    const stopMeter = vi.fn();
    const onAudioLevel = vi.fn();
    const port = new OpenAiRealtimeLiveSttPort({
      projectId: "project_real_1",
      createAudioLevelMeter: (_stream, callback) => {
        callback?.(audioLevel);
        return { stop: stopMeter };
      },
      createPeerConnection: () => new FakePeerConnection(),
      fetcher: createOpenAiRealtimeFetcher(),
      now: () => 1000,
      onAudioLevel
    });

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream()
    });
    await port.stop();

    expect(onAudioLevel).toHaveBeenCalledWith(audioLevel);
    expect(stopMeter).toHaveBeenCalledTimes(1);
  });

  it("commits pending audio buffers after the data channel opens", async () => {
    vi.useFakeTimers();
    try {
      const peerConnection = new FakePeerConnection();
      let meterCallback:
        | ((event: LiveSttAudioLevelEvent) => void)
        | undefined;
      const port = new OpenAiRealtimeLiveSttPort({
        projectId: "project_real_1",
        commitIntervalMs: 1000,
        createAudioLevelMeter: (_stream, callback) => {
          meterCallback = callback;
          return noopMeter();
        },
        createPeerConnection: () => peerConnection,
        fetcher: createOpenAiRealtimeFetcher(),
        now: () => 1000,
        pendingAudioRmsDbThreshold: -75
      });

      await port.start({
        language: "ko",
        audioSource: fakeMediaStream()
      });

      meterCallback?.({
        type: "audio-level",
        rms: 0.001,
        peak: 0.002,
        rmsDb: -70,
        peakDb: -60,
        isLikelySilence: true
      });
      vi.advanceTimersByTime(1000);
      expect(peerConnection.dataChannel.sentPayloads).toEqual([]);

      peerConnection.dataChannel.emitOpen();
      vi.advanceTimersByTime(1000);

      expect(peerConnection.dataChannel.sentPayloads).toEqual([
        { type: "input_audio_buffer.commit" }
      ]);

      vi.advanceTimersByTime(1000);
      expect(peerConnection.dataChannel.sentPayloads).toHaveLength(1);

      await port.stop();
      meterCallback?.({
        type: "audio-level",
        rms: 0.001,
        peak: 0.002,
        rmsDb: -70,
        peakDb: -60,
        isLikelySilence: true
      });
      vi.advanceTimersByTime(1000);
      expect(peerConnection.dataChannel.sentPayloads).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails without falling back when the stream has no audio track", async () => {
    const fetcher = createOpenAiRealtimeFetcher();
    const port = new OpenAiRealtimeLiveSttPort({
      projectId: "project_real_1",
      createAudioLevelMeter: () => noopMeter(),
      createPeerConnection: () => new FakePeerConnection(),
      fetcher,
      now: () => 1000
    });

    await expect(
      port.start({
        language: "ko",
        audioSource: { getAudioTracks: () => [] } as unknown as MediaStream
      })
    ).rejects.toMatchObject({ code: "start_failed" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

class FakeDataChannel {
  private readonly listeners = new Map<string, EventListener[]>();
  readonly sentPayloads: unknown[] = [];
  closeCount = 0;
  readyState: RTCDataChannelState = "connecting";

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closeCount += 1;
    this.readyState = "closed";
  }

  send(data: string) {
    this.sentPayloads.push(JSON.parse(data));
  }

  emitOpen() {
    this.readyState = "open";
    for (const listener of this.listeners.get("open") ?? []) {
      listener({ type: "open" } as Event);
    }
  }

  emitMessage(payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }
}

class FakePeerConnection {
  readonly dataChannel = new FakeDataChannel();
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  closeCount = 0;

  addTrack(_track: MediaStreamTrack, _stream: MediaStream) {
    return {} as RTCRtpSender;
  }

  createDataChannel(_label: string) {
    return this.dataChannel as unknown as RTCDataChannel;
  }

  async createOffer() {
    return {
      type: "offer" as const,
      sdp: "offer-sdp"
    };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
  }

  close() {
    this.closeCount += 1;
  }
}

function createOpenAiRealtimeFetcher() {
  return vi.fn(async (url: string | URL | Request) => {
    const value = String(url);
    if (value.includes("/realtime-transcription/client-secret")) {
      return new Response(
        JSON.stringify({
          clientSecret: "ek_test",
          expiresAt: 1790000000,
          model: "gpt-realtime-whisper",
          delay: "minimal"
        })
      );
    }

    return new Response("answer-sdp");
  }) as unknown as typeof fetch;
}

function fakeMediaStream() {
  return {
    getAudioTracks: () => [{} as MediaStreamTrack]
  } as unknown as MediaStream;
}

function noopMeter() {
  return { stop() {} };
}
