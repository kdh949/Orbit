import { realtimeTranscriptionClientSecretResponseSchema } from "@orbit/shared";
import type { LiveSttAudioLevelEvent } from "../liveStt";
import { calculatePcmAudioLevel } from "../liveSttAudioLevel";
import {
  LiveSttError,
  normalizeLiveSttBiasPhrases,
  type LiveSttBiasPhrase,
  type LiveSttCapabilities,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "./liveSttPort";

type OpenAiRealtimeDataChannel = {
  addEventListener: (
    type: "error" | "message" | "open",
    listener: (event: Event) => void
  ) => void;
  close: () => void;
  readyState?: RTCDataChannelState;
  send: (data: string) => void;
};

type OpenAiRealtimePeerConnection = {
  addTrack: (track: MediaStreamTrack, ...streams: MediaStream[]) => RTCRtpSender;
  close: () => void;
  createDataChannel: (label: string) => OpenAiRealtimeDataChannel;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  setLocalDescription: (description: RTCSessionDescriptionInit) => Promise<void>;
  setRemoteDescription: (description: RTCSessionDescriptionInit) => Promise<void>;
};

type AudioLevelMeter = {
  stop: () => void;
};

type OpenAiRealtimeLiveSttPortOptions = {
  projectId: string;
  createAudioLevelMeter?: (
    stream: MediaStream,
    onAudioLevel?: (event: LiveSttAudioLevelEvent) => void
  ) => AudioLevelMeter;
  createPeerConnection?: () => OpenAiRealtimePeerConnection;
  commitIntervalMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
  onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
  pendingAudioRmsDbThreshold?: number;
};

type RealtimeTranscriptEventKey = string;

export class OpenAiRealtimeLiveSttPort implements LiveSttPort {
  readonly engineId = "openai-realtime";
  readonly capabilities: LiveSttCapabilities = {
    onDevice: false,
    streaming: true,
    keywordBiasing: false,
    languages: ["ko"]
  };

  readonly projectId: string;

  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
  private readonly commitIntervalMs: number;
  private readonly pendingAudioRmsDbThreshold: number;
  private readonly createPeerConnection: () => OpenAiRealtimePeerConnection;
  private readonly createAudioLevelMeter: (
    stream: MediaStream,
    onAudioLevel?: (event: LiveSttAudioLevelEvent) => void
  ) => AudioLevelMeter;
  private readonly resultSubscribers = new Set<(result: LiveSttResult) => void>();
  private readonly errorSubscribers = new Set<(error: LiveSttError) => void>();
  private readonly partialTextByEventKey = new Map<
    RealtimeTranscriptEventKey,
    string
  >();
  private peerConnection: OpenAiRealtimePeerConnection | null = null;
  private dataChannel: OpenAiRealtimeDataChannel | null = null;
  private audioLevelMeter: AudioLevelMeter | null = null;
  private commitIntervalId: ReturnType<typeof setInterval> | null = null;
  private hasPendingAudioForCommit = false;
  private startedAtMs: number | null = null;
  private biasPhrases: LiveSttBiasPhrase[] = [];

  constructor(options: OpenAiRealtimeLiveSttPortOptions) {
    this.projectId = options.projectId;
    this.fetcher = options.fetcher ?? defaultFetch;
    this.now = options.now ?? (() => Date.now());
    this.onAudioLevel = options.onAudioLevel;
    this.commitIntervalMs =
      options.commitIntervalMs ?? OPENAI_REALTIME_AUDIO_COMMIT_INTERVAL_MS;
    this.pendingAudioRmsDbThreshold =
      options.pendingAudioRmsDbThreshold ?? OPENAI_REALTIME_PENDING_AUDIO_RMS_DB;
    this.createPeerConnection =
      options.createPeerConnection ?? createDefaultPeerConnection;
    this.createAudioLevelMeter =
      options.createAudioLevelMeter ?? createAnalyserAudioLevelMeter;
  }

  async start(config: LiveSttSessionConfig) {
    const audioTrack = config.audioSource.getAudioTracks()[0];
    if (!audioTrack) {
      throw new LiveSttError(
        "start_failed",
        "OpenAI Realtime STT를 시작할 마이크 오디오 트랙을 찾지 못했습니다."
      );
    }

    this.startedAtMs = this.now();
    this.biasPhrases = normalizeLiveSttBiasPhrases(config.biasPhrases);
    this.partialTextByEventKey.clear();

    try {
      const token = await this.fetchClientSecret();
      const peerConnection = this.createPeerConnection();
      this.peerConnection = peerConnection;
      this.audioLevelMeter = this.createAudioLevelMeter(
        config.audioSource,
        this.handleAudioLevel
      );

      peerConnection.addTrack(audioTrack, config.audioSource);
      const dataChannel = peerConnection.createDataChannel("oai-events");
      this.dataChannel = dataChannel;
      dataChannel.addEventListener("open", this.handleDataChannelOpen);
      dataChannel.addEventListener("message", this.handleDataChannelMessage);
      dataChannel.addEventListener("error", this.handleDataChannelError);

      const offer = await peerConnection.createOffer();
      if (!offer.sdp) {
        throw new LiveSttError(
          "start_failed",
          "OpenAI Realtime SDP offer를 만들지 못했습니다."
        );
      }

      await peerConnection.setLocalDescription(offer);
      const sdpResponse = await this.fetcher(
        "https://api.openai.com/v1/realtime/calls",
        {
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token.clientSecret}`,
            "Content-Type": "application/sdp"
          },
          method: "POST"
        }
      );

      if (!sdpResponse.ok) {
        throw new LiveSttError(
          "start_failed",
          `OpenAI Realtime SDP handshake failed: ${sdpResponse.status}`
        );
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text()
      });
    } catch (error) {
      await this.stop();
      throw toLiveSttError(error, "OpenAI Realtime STT를 시작하지 못했습니다.");
    }
  }

  async stop() {
    this.startedAtMs = null;
    this.stopCommitLoop();
    this.hasPendingAudioForCommit = false;
    this.partialTextByEventKey.clear();
    this.audioLevelMeter?.stop();
    this.audioLevelMeter = null;
    this.dataChannel?.close();
    this.dataChannel = null;
    this.peerConnection?.close();
    this.peerConnection = null;
  }

  updateBiasPhrases(phrases: readonly LiveSttBiasPhrase[]) {
    this.biasPhrases = normalizeLiveSttBiasPhrases(phrases);
  }

  onResult(cb: (result: LiveSttResult) => void): LiveSttUnsubscribe {
    this.resultSubscribers.add(cb);
    return () => {
      this.resultSubscribers.delete(cb);
    };
  }

  onError(cb: (error: LiveSttError) => void): LiveSttUnsubscribe {
    this.errorSubscribers.add(cb);
    return () => {
      this.errorSubscribers.delete(cb);
    };
  }

  async dispose() {
    await this.stop();
    this.resultSubscribers.clear();
    this.errorSubscribers.clear();
  }

  readBiasPhrasesForTest() {
    return this.biasPhrases;
  }

  private async fetchClientSecret() {
    const response = await this.fetcher(
      `/api/v1/projects/${encodeURIComponent(
        this.projectId
      )}/realtime-transcription/client-secret`,
      {
        credentials: "include",
        method: "POST"
      }
    );

    if (!response.ok) {
      throw new LiveSttError(
        "start_failed",
        await readResponseError(
          response,
          `OpenAI Realtime client secret request failed: ${response.status}`
        )
      );
    }

    return realtimeTranscriptionClientSecretResponseSchema.parse(
      await response.json()
    );
  }

  private readonly handleDataChannelMessage = (event: Event) => {
    try {
      this.handleRealtimeEvent(JSON.parse(String((event as MessageEvent).data)));
    } catch {
      this.emitError(
        new LiveSttError(
          "runtime_error",
          "OpenAI Realtime 이벤트를 해석하지 못했습니다."
        )
      );
    }
  };

  private readonly handleDataChannelOpen = () => {
    this.startCommitLoop();
  };

  private readonly handleDataChannelError = () => {
    this.emitError(
      new LiveSttError("runtime_error", "OpenAI Realtime data channel 오류입니다.")
    );
  };

  private readonly handleAudioLevel = (event: LiveSttAudioLevelEvent) => {
    if (event.rmsDb >= this.pendingAudioRmsDbThreshold) {
      this.hasPendingAudioForCommit = true;
    }

    this.onAudioLevel?.(event);
  };

  private startCommitLoop() {
    if (this.commitIntervalId !== null || this.commitIntervalMs <= 0) {
      return;
    }

    this.commitIntervalId = setInterval(() => {
      this.commitPendingAudioBuffer();
    }, this.commitIntervalMs);
  }

  private stopCommitLoop() {
    if (this.commitIntervalId === null) {
      return;
    }

    clearInterval(this.commitIntervalId);
    this.commitIntervalId = null;
  }

  private commitPendingAudioBuffer() {
    const dataChannel = this.dataChannel;
    if (
      !dataChannel ||
      !this.hasPendingAudioForCommit ||
      !isDataChannelOpen(dataChannel)
    ) {
      return;
    }

    try {
      dataChannel.send(
        JSON.stringify({
          type: "input_audio_buffer.commit"
        })
      );
      this.hasPendingAudioForCommit = false;
    } catch {
      this.emitError(
        new LiveSttError(
          "runtime_error",
          "OpenAI Realtime audio buffer commit에 실패했습니다."
        )
      );
    }
  }

  private handleRealtimeEvent(event: unknown) {
    if (!isRecord(event) || this.startedAtMs === null) {
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta") {
      this.handleTranscriptDelta(event);
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      this.handleTranscriptCompleted(event);
    }
  }

  private handleTranscriptDelta(event: Record<string, unknown>) {
    const delta = typeof event.delta === "string" ? event.delta : "";
    if (!delta) {
      return;
    }

    const key = getRealtimeTranscriptEventKey(event);
    const next = `${this.partialTextByEventKey.get(key) ?? ""}${delta}`;
    this.partialTextByEventKey.set(key, next);
    this.emitTranscript(next, false);
  }

  private handleTranscriptCompleted(event: Record<string, unknown>) {
    const key = getRealtimeTranscriptEventKey(event);
    const transcript =
      typeof event.transcript === "string"
        ? event.transcript
        : this.partialTextByEventKey.get(key) ?? "";
    this.partialTextByEventKey.delete(key);
    this.emitTranscript(transcript, true);
  }

  private emitTranscript(text: string, isFinal: boolean) {
    const transcript = text.trim();
    if (!transcript || this.startedAtMs === null) {
      return;
    }

    this.emitResult({
      text: transcript,
      isFinal,
      timestampMs: this.elapsedRange()
    });
  }

  private elapsedRange(): [number, number] {
    const startedAtMs = this.startedAtMs ?? this.now();
    const elapsedMs = Math.max(this.now() - startedAtMs, 0);
    return [elapsedMs, elapsedMs];
  }

  private emitResult(result: LiveSttResult) {
    for (const subscriber of this.resultSubscribers) {
      subscriber(result);
    }
  }

  private emitError(error: LiveSttError) {
    for (const subscriber of this.errorSubscribers) {
      subscriber(error);
    }
  }
}

function createDefaultPeerConnection(): OpenAiRealtimePeerConnection {
  if (typeof RTCPeerConnection === "undefined") {
    throw new LiveSttError(
      "unsupported_runtime",
      "이 브라우저는 OpenAI Realtime WebRTC 연결을 지원하지 않습니다."
    );
  }

  return new RTCPeerConnection() as OpenAiRealtimePeerConnection;
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

const OPENAI_REALTIME_AUDIO_COMMIT_INTERVAL_MS = 1500;
const OPENAI_REALTIME_PENDING_AUDIO_RMS_DB = -75;

function createAnalyserAudioLevelMeter(
  stream: MediaStream,
  onAudioLevel?: (event: LiveSttAudioLevelEvent) => void
): AudioLevelMeter {
  if (!onAudioLevel || typeof window === "undefined" || !window.AudioContext) {
    return noopAudioLevelMeter;
  }

  const audioContext = new window.AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  const samples = new Float32Array(analyser.fftSize);
  source.connect(analyser);

  const intervalId = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    onAudioLevel(calculatePcmAudioLevel(samples));
  }, 100);

  return {
    stop() {
      window.clearInterval(intervalId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => undefined);
    }
  };
}

const noopAudioLevelMeter: AudioLevelMeter = {
  stop() {}
};

function getRealtimeTranscriptEventKey(event: Record<string, unknown>) {
  const itemId =
    typeof event.item_id === "string" && event.item_id.length > 0
      ? event.item_id
      : "default";
  const contentIndex =
    typeof event.content_index === "number" ? event.content_index : 0;
  return `${itemId}:${contentIndex}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDataChannelOpen(dataChannel: OpenAiRealtimeDataChannel) {
  return dataChannel.readyState === undefined || dataChannel.readyState === "open";
}

async function readResponseError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => undefined);
  if (
    isRecord(payload) &&
    typeof payload.message === "string" &&
    payload.message.length > 0
  ) {
    return payload.message;
  }

  return fallbackMessage;
}

function toLiveSttError(error: unknown, fallbackMessage: string) {
  if (error instanceof LiveSttError) {
    return error;
  }

  return new LiveSttError(
    "start_failed",
    error instanceof Error ? error.message : fallbackMessage
  );
}
