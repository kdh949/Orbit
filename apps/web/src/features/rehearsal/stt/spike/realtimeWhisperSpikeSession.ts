import { realtimeTranscriptionClientSecretResponseSchema } from "@orbit/shared";
import type { OpenAiRealtimeTranscriptionDelay } from "@orbit/shared";
import type { RealtimeWhisperTurnMetric } from "./realtimeWhisperSpikeMetrics";
import {
  advanceSpeechDetector,
  calculateNoiseFloorDb,
  initialSpeechDetectorState,
  resolveAdaptiveSpeechThresholdDb,
  type SpeechDetectorState
} from "./realtimeWhisperSpikeVad";

export type SpikeConnectionPhase =
  | "idle"
  | "requesting-microphone"
  | "requesting-secret"
  | "negotiating"
  | "calibrating"
  | "ready"
  | "stopping"
  | "error";

export type SpikeConnectionTimings = {
  microphoneReadyMs: number | null;
  clientSecretReadyMs: number | null;
  remoteDescriptionReadyMs: number | null;
  dataChannelOpenMs: number | null;
  sessionUpdatedMs: number | null;
  calibrationReadyMs: number | null;
};

export type SpikeTranscript = {
  key: string;
  itemId: string;
  text: string;
  isFinal: boolean;
  partialCount: number;
  confidence: number | null;
};

export type SpikeEventLog = {
  sequence: number;
  elapsedMs: number;
  type: string;
  itemId?: string;
  textLength?: number;
  detail?: string;
};

export type SpikeAudioInputInfo = {
  label: string;
  sampleRate: number | null;
  audioContextSampleRate: number | null;
  channelCount: number | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  readyState: MediaStreamTrackState;
  enabled: boolean;
  muted: boolean;
};

export type RealtimeWhisperSpikeSnapshot = {
  phase: SpikeConnectionPhase;
  peerConnectionState: RTCPeerConnectionState | "closed";
  iceConnectionState: RTCIceConnectionState | "closed";
  dataChannelState: RTCDataChannelState | "closed";
  isSpeaking: boolean;
  rmsDb: number;
  peakDb: number;
  noiseFloorDb: number | null;
  speechThresholdDb: number | null;
  calibrationRemainingMs: number | null;
  audioInput: SpikeAudioInputInfo | null;
  issuedModel: string | null;
  issuedDelay: OpenAiRealtimeTranscriptionDelay | null;
  activeModel: string | null;
  activeDelay: string | null;
  error: string | null;
  timings: SpikeConnectionTimings;
  transcripts: SpikeTranscript[];
  turns: RealtimeWhisperTurnMetric[];
  events: SpikeEventLog[];
};

export type RealtimeWhisperSpikeOptions = {
  projectId: string;
  delay: OpenAiRealtimeTranscriptionDelay;
  maxCommitIntervalMs: number | null;
  silenceCommitMs: number;
  noiseCalibrationMs: number;
  noiseThresholdMarginDb: number;
  speechAttackMs: number;
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

const initialTimings: SpikeConnectionTimings = {
  microphoneReadyMs: null,
  clientSecretReadyMs: null,
  remoteDescriptionReadyMs: null,
  dataChannelOpenMs: null,
  sessionUpdatedMs: null,
  calibrationReadyMs: null
};

export class RealtimeWhisperSpikeSession {
  private snapshot: RealtimeWhisperSpikeSnapshot = createInitialSnapshot();
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterTimer: number | null = null;
  private connectStartedAt = 0;
  private eventSequence = 0;
  private turnSequence = 0;
  private activeTurnId: number | null = null;
  private activeTurnStartedAt = 0;
  private calibrationStartedAt: number | null = null;
  private noiseFloorSamples: number[] = [];
  private speechDetectorState: SpeechDetectorState = initialSpeechDetectorState;
  private readonly turnIdByItemKey = new Map<string, number>();
  private readonly transcriptByKey = new Map<string, SpikeTranscript>();

  constructor(
    private readonly options: RealtimeWhisperSpikeOptions,
    private readonly onSnapshot: (snapshot: RealtimeWhisperSpikeSnapshot) => void
  ) {}

  async start() {
    if (this.snapshot.phase !== "idle" && this.snapshot.phase !== "error") {
      return;
    }

    this.connectStartedAt = performance.now();
    this.patch({
      ...createInitialSnapshot(),
      phase: "requesting-microphone"
    });

    try {
      const audioConstraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: this.options.echoCancellation,
        noiseSuppression: this.options.noiseSuppression,
        autoGainControl: this.options.autoGainControl,
        ...(this.options.deviceId
          ? { deviceId: { exact: this.options.deviceId } }
          : {})
      };
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });
      const audioTrack = this.mediaStream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error("마이크 오디오 트랙을 찾지 못했습니다.");
      }
      this.publishAudioInput(audioTrack);
      audioTrack.addEventListener("mute", this.handleAudioTrackState);
      audioTrack.addEventListener("unmute", this.handleAudioTrackState);
      audioTrack.addEventListener("ended", this.handleAudioTrackState);
      this.setTiming("microphoneReadyMs");
      this.startAudioMeter(this.mediaStream);

      this.patch({ phase: "requesting-secret" });
      const token = await this.fetchClientSecret();
      this.setTiming("clientSecretReadyMs");
      this.patch({ issuedModel: token.model, issuedDelay: token.delay });

      this.patch({ phase: "negotiating" });
      const peerConnection = new RTCPeerConnection();
      this.peerConnection = peerConnection;
      peerConnection.addEventListener("connectionstatechange", this.handlePeerState);
      peerConnection.addEventListener("iceconnectionstatechange", this.handlePeerState);
      for (const track of this.mediaStream.getAudioTracks()) {
        peerConnection.addTrack(track, this.mediaStream);
      }

      const dataChannel = peerConnection.createDataChannel("oai-events");
      this.dataChannel = dataChannel;
      dataChannel.addEventListener("open", this.handleDataChannelOpen);
      dataChannel.addEventListener("close", this.handleDataChannelClose);
      dataChannel.addEventListener("error", this.handleDataChannelError);
      dataChannel.addEventListener("message", this.handleDataChannelMessage);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token.clientSecret}`,
          "Content-Type": "application/sdp"
        },
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(`Realtime SDP handshake failed (${response.status})`);
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: await response.text()
      });
      this.setTiming("remoteDescriptionReadyMs");
      this.publishConnectionState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "연결에 실패했습니다.";
      await this.releaseResources();
      this.patch({ phase: "error", error: message });
      this.log("spike.error", { detail: message });
    }
  }

  async stop() {
    if (this.snapshot.phase === "idle") {
      return;
    }
    this.patch({ phase: "stopping" });
    await this.releaseResources();
    this.patch({
      phase: "idle",
      peerConnectionState: "closed",
      iceConnectionState: "closed",
      dataChannelState: "closed",
      isSpeaking: false
    });
  }

  commitNow() {
    this.commitActiveTurn("manual");
    this.speechDetectorState = initialSpeechDetectorState;
    this.patch({ isSpeaking: false });
  }

  readSnapshot() {
    return this.snapshot;
  }

  private async fetchClientSecret() {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(this.options.projectId)}/realtime-transcription/client-secret`,
      { credentials: "include", method: "POST" }
    );
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined);
      const detail =
        isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : `client secret 요청 실패 (${response.status})`;
      throw new Error(detail);
    }
    return realtimeTranscriptionClientSecretResponseSchema.parse(
      await response.json()
    );
  }

  private startAudioMeter(stream: MediaStream) {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    this.audioContext = audioContext;
    this.analyser = analyser;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      this.publishAudioInput(audioTrack, audioContext.sampleRate);
    }
    const samples = new Float32Array(analyser.fftSize);

    this.meterTimer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      let peak = 0;
      for (const sample of samples) {
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const rmsDb = amplitudeToDb(rms);
      const peakDb = amplitudeToDb(peak);
      const now = performance.now();
      this.patch({ rmsDb, peakDb });

      if (this.snapshot.phase === "calibrating") {
        this.captureNoiseFloorSample(rmsDb, now);
        return;
      }

      if (
        this.snapshot.phase !== "ready" ||
        this.snapshot.speechThresholdDb === null
      ) {
        return;
      }

      const transition = advanceSpeechDetector(this.speechDetectorState, {
        nowMs: now,
        rmsDb,
        thresholdDb: this.snapshot.speechThresholdDb,
        attackMs: this.options.speechAttackMs,
        releaseMs: this.options.silenceCommitMs
      });
      this.speechDetectorState = transition.state;

      if (transition.speechStartedAtMs !== null && this.activeTurnId === null) {
        this.beginTurn(transition.speechStartedAtMs);
      }
      if (transition.speechEndedAtMs !== null) {
        this.commitActiveTurn("silence");
      }

      const reachedMaxInterval =
        this.activeTurnId !== null &&
        this.options.maxCommitIntervalMs !== null &&
        now - this.activeTurnStartedAt >= this.options.maxCommitIntervalMs;
      if (reachedMaxInterval) {
        this.commitActiveTurn("max-interval");
        if (this.speechDetectorState.isSpeaking) {
          this.beginTurn(now);
        }
      }

      this.patch({ isSpeaking: transition.state.isSpeaking });
    }, 50);
  }

  private captureNoiseFloorSample(rmsDb: number, now: number) {
    const startedAt = this.calibrationStartedAt ?? now;
    this.calibrationStartedAt = startedAt;
    this.noiseFloorSamples.push(rmsDb);
    const remainingMs = Math.max(
      this.options.noiseCalibrationMs - (now - startedAt),
      0
    );
    this.patch({ calibrationRemainingMs: Math.round(remainingMs) });
    if (remainingMs > 0) {
      return;
    }

    const noiseFloorDb = calculateNoiseFloorDb(this.noiseFloorSamples);
    if (noiseFloorDb === null) {
      void this.failSession("마이크 noise floor를 계산하지 못했습니다.");
      return;
    }
    const speechThresholdDb = resolveAdaptiveSpeechThresholdDb(
      noiseFloorDb,
      this.options.noiseThresholdMarginDb
    );
    this.setTiming("calibrationReadyMs");
    this.patch({
      phase: "ready",
      calibrationRemainingMs: 0,
      noiseFloorDb,
      speechThresholdDb
    });
    this.log("local.noise_calibration_completed", {
      detail: `floor:${noiseFloorDb.toFixed(1)};threshold:${speechThresholdDb.toFixed(1)}`
    });
  }

  private beginTurn(now: number) {
    const turn: RealtimeWhisperTurnMetric = {
      turnId: ++this.turnSequence,
      itemId: null,
      speechStartedAtMs: this.elapsed(now),
      committedAtMs: null,
      firstDeltaAtMs: null,
      completedAtMs: null,
      transcript: "",
      partialCount: 0
    };
    this.activeTurnId = turn.turnId;
    this.activeTurnStartedAt = now;
    this.patch({ turns: [...this.snapshot.turns, turn] });
    this.log("local.speech_started", { detail: `turn:${turn.turnId}` });
  }

  private commitActiveTurn(reason: string) {
    const channel = this.dataChannel;
    if (
      this.activeTurnId === null ||
      !channel ||
      channel.readyState !== "open"
    ) {
      return;
    }

    const now = performance.now();
    channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    const turnId = this.activeTurnId;
    this.activeTurnId = null;
    this.updateTurn(turnId, { committedAtMs: this.elapsed(now) });
    this.log("client.audio_commit", { detail: `${reason};turn:${turnId}` });
  }

  private readonly handleDataChannelOpen = () => {
    this.setTiming("dataChannelOpenMs");
    this.patch({ error: null });
    this.publishConnectionState();
    this.dataChannel?.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: {
                model: "gpt-realtime-whisper",
                language: "ko",
                delay: this.options.delay
              },
              turn_detection: null
            }
          },
          include: ["item.input_audio_transcription.logprobs"]
        }
      })
    );
    this.log("connection.data_channel_open");
  };

  private readonly handleDataChannelClose = () => {
    this.publishConnectionState();
    this.log("connection.data_channel_closed");
  };

  private readonly handleDataChannelError = () => {
    this.patch({ error: "Realtime data channel 오류가 발생했습니다." });
    this.log("connection.data_channel_error");
  };

  private readonly handlePeerState = () => {
    this.publishConnectionState();
  };

  private readonly handleDataChannelMessage = (message: MessageEvent) => {
    let event: unknown;
    try {
      event = JSON.parse(String(message.data));
    } catch {
      this.log("server.invalid_json");
      return;
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      return;
    }

    const itemId = typeof event.item_id === "string" ? event.item_id : undefined;
    const text =
      typeof event.delta === "string"
        ? event.delta
        : typeof event.transcript === "string"
          ? event.transcript
          : undefined;
    this.log(event.type, {
      itemId,
      ...(text === undefined ? {} : { textLength: text.length })
    });

    if (event.type === "session.created" || event.type === "session.updated") {
      const transcription = readTranscriptionConfig(event);
      this.patch({
        activeModel: transcription.model ?? this.snapshot.activeModel,
        activeDelay: transcription.delay ?? this.snapshot.activeDelay
      });
      if (event.type === "session.updated") {
        this.handleSessionUpdated(transcription);
      }
      return;
    }

    if (event.type === "error") {
      this.patch({ error: readRealtimeError(event) });
      return;
    }

    if (
      event.type === "conversation.item.input_audio_transcription.delta" ||
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      this.handleTranscriptEvent(event);
    }
  };

  private handleTranscriptEvent(event: Record<string, unknown>) {
    const itemId = typeof event.item_id === "string" ? event.item_id : "unknown";
    const contentIndex =
      typeof event.content_index === "number" ? event.content_index : 0;
    const key = `${itemId}:${contentIndex}`;
    const current = this.transcriptByKey.get(key);
    const isFinal = event.type === "conversation.item.input_audio_transcription.completed";
    const delta = typeof event.delta === "string" ? event.delta : "";
    const finalText = typeof event.transcript === "string" ? event.transcript : "";
    const next: SpikeTranscript = {
      key,
      itemId,
      text: isFinal ? finalText || current?.text || "" : `${current?.text ?? ""}${delta}`,
      isFinal,
      partialCount: (current?.partialCount ?? 0) + (isFinal ? 0 : 1),
      confidence: readConfidence(event) ?? current?.confidence ?? null
    };
    this.transcriptByKey.set(key, next);
    this.patch({ transcripts: [...this.transcriptByKey.values()] });

    const turnId = this.resolveTurnId(key);
    const now = this.elapsed(performance.now());
    const turn = this.snapshot.turns.find((candidate) => candidate.turnId === turnId);
    this.updateTurn(turnId, {
      itemId,
      transcript: next.text,
      partialCount: next.partialCount,
      firstDeltaAtMs:
        turn?.firstDeltaAtMs ?? (isFinal ? null : now),
      ...(isFinal ? { completedAtMs: now } : {})
    });
  }

  private handleSessionUpdated(transcription: {
    model: string | null;
    delay: string | null;
  }) {
    if (!isExpectedTranscriptionConfig(transcription, this.options.delay)) {
      void this.failSession(
        `요청한 세션 설정이 적용되지 않았습니다. 요청: gpt-realtime-whisper/${this.options.delay}, 적용: ${transcription.model ?? "unknown"}/${transcription.delay ?? "unknown"}`
      );
      return;
    }

    this.setTiming("sessionUpdatedMs");
    this.calibrationStartedAt = null;
    this.noiseFloorSamples = [];
    this.speechDetectorState = initialSpeechDetectorState;
    this.patch({
      phase: "calibrating",
      calibrationRemainingMs: this.options.noiseCalibrationMs,
      isSpeaking: false
    });
    this.log("session.configuration_verified");
  }

  private resolveTurnId(key: string) {
    const existing = this.turnIdByItemKey.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const candidate =
      this.snapshot.turns.find(
        (turn) => turn.itemId === null && turn.completedAtMs === null
      ) ?? this.snapshot.turns.at(-1);
    if (candidate) {
      this.turnIdByItemKey.set(key, candidate.turnId);
      return candidate.turnId;
    }

    this.beginTurn(performance.now());
    const created = this.snapshot.turns.at(-1);
    if (!created) {
      throw new Error("전사 turn을 생성하지 못했습니다.");
    }
    this.turnIdByItemKey.set(key, created.turnId);
    return created.turnId;
  }

  private updateTurn(
    turnId: number,
    update: Partial<RealtimeWhisperTurnMetric>
  ) {
    this.patch({
      turns: this.snapshot.turns.map((turn) =>
        turn.turnId === turnId ? { ...turn, ...update } : turn
      )
    });
  }

  private publishConnectionState() {
    this.patch({
      peerConnectionState: this.peerConnection?.connectionState ?? "closed",
      iceConnectionState: this.peerConnection?.iceConnectionState ?? "closed",
      dataChannelState: this.dataChannel?.readyState ?? "closed"
    });
  }

  private readonly handleAudioTrackState = (event: Event) => {
    const track = event.currentTarget;
    if (track instanceof MediaStreamTrack) {
      this.publishAudioInput(track, this.audioContext?.sampleRate);
      this.log(`local.audio_track_${event.type}`);
    }
  };

  private publishAudioInput(
    track: MediaStreamTrack,
    audioContextSampleRate?: number
  ) {
    const settings = track.getSettings();
    this.patch({
      audioInput: {
        label: track.label || "이름 없는 마이크",
        sampleRate: toFiniteNumber(settings.sampleRate),
        audioContextSampleRate:
          audioContextSampleRate ?? this.snapshot.audioInput?.audioContextSampleRate ?? null,
        channelCount: toFiniteNumber(settings.channelCount),
        echoCancellation: toBoolean(settings.echoCancellation),
        noiseSuppression: toBoolean(settings.noiseSuppression),
        autoGainControl: toBoolean(settings.autoGainControl),
        readyState: track.readyState,
        enabled: track.enabled,
        muted: track.muted
      }
    });
  }

  private setTiming(key: keyof SpikeConnectionTimings) {
    this.patch({
      timings: {
        ...this.snapshot.timings,
        [key]: Math.round(this.elapsed(performance.now()))
      }
    });
  }

  private log(
    type: string,
    metadata: Pick<SpikeEventLog, "itemId" | "textLength" | "detail"> = {}
  ) {
    const entry: SpikeEventLog = {
      sequence: ++this.eventSequence,
      elapsedMs: Math.round(this.elapsed(performance.now())),
      type,
      ...metadata
    };
    this.patch({ events: [...this.snapshot.events.slice(-199), entry] });
  }

  private patch(update: Partial<RealtimeWhisperSpikeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.onSnapshot(this.snapshot);
  }

  private elapsed(now: number) {
    return Math.max(now - this.connectStartedAt, 0);
  }

  private async releaseResources() {
    if (this.meterTimer !== null) {
      window.clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    this.analyser?.disconnect();
    this.analyser = null;
    await this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.dataChannel?.close();
    this.dataChannel = null;
    this.peerConnection?.close();
    this.peerConnection = null;
    for (const track of this.mediaStream?.getTracks() ?? []) {
      track.stop();
    }
    this.mediaStream = null;
  }

  private async failSession(message: string) {
    await this.releaseResources();
    this.patch({
      phase: "error",
      error: message,
      isSpeaking: false,
      peerConnectionState: "closed",
      iceConnectionState: "closed",
      dataChannelState: "closed"
    });
    this.log("spike.error", { detail: message });
  }
}

export function createInitialSnapshot(): RealtimeWhisperSpikeSnapshot {
  return {
    phase: "idle",
    peerConnectionState: "closed",
    iceConnectionState: "closed",
    dataChannelState: "closed",
    isSpeaking: false,
    rmsDb: -100,
    peakDb: -100,
    noiseFloorDb: null,
    speechThresholdDb: null,
    calibrationRemainingMs: null,
    audioInput: null,
    issuedModel: null,
    issuedDelay: null,
    activeModel: null,
    activeDelay: null,
    error: null,
    timings: { ...initialTimings },
    transcripts: [],
    turns: [],
    events: []
  };
}

function amplitudeToDb(value: number) {
  return value > 0 ? Math.max(20 * Math.log10(value), -100) : -100;
}

function readTranscriptionConfig(event: Record<string, unknown>) {
  const session = isRecord(event.session) ? event.session : undefined;
  const audio = session && isRecord(session.audio) ? session.audio : undefined;
  const input = audio && isRecord(audio.input) ? audio.input : undefined;
  const transcription =
    input && isRecord(input.transcription) ? input.transcription : undefined;
  return {
    model:
      transcription && typeof transcription.model === "string"
        ? transcription.model
        : null,
    delay:
      transcription && typeof transcription.delay === "string"
        ? transcription.delay
        : null
  };
}

function readRealtimeError(event: Record<string, unknown>) {
  const error = isRecord(event.error) ? event.error : undefined;
  return error && typeof error.message === "string"
    ? error.message
    : "OpenAI Realtime 오류가 발생했습니다.";
}

function readConfidence(event: Record<string, unknown>) {
  if (!Array.isArray(event.logprobs) || event.logprobs.length === 0) {
    return null;
  }
  const values = event.logprobs.flatMap((entry) =>
    isRecord(entry) && typeof entry.logprob === "number" ? [entry.logprob] : []
  );
  if (values.length === 0) {
    return null;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.exp(average);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function isExpectedTranscriptionConfig(
  transcription: { model: string | null; delay: string | null },
  requestedDelay: OpenAiRealtimeTranscriptionDelay
) {
  return (
    transcription.model === "gpt-realtime-whisper" &&
    transcription.delay === requestedDelay
  );
}
