import { realtimeTranscriptionClientSecretResponseSchema } from "@orbit/shared";
import type { OpenAiRealtimeTranscriptionDelay } from "@orbit/shared";
import type { RealtimeWhisperTurnMetric } from "./realtimeWhisperSpikeMetrics";

export type SpikeConnectionPhase =
  | "idle"
  | "requesting-microphone"
  | "requesting-secret"
  | "negotiating"
  | "connected"
  | "stopping"
  | "error";

export type SpikeConnectionTimings = {
  microphoneReadyMs: number | null;
  clientSecretReadyMs: number | null;
  remoteDescriptionReadyMs: number | null;
  dataChannelOpenMs: number | null;
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

export type RealtimeWhisperSpikeSnapshot = {
  phase: SpikeConnectionPhase;
  peerConnectionState: RTCPeerConnectionState | "closed";
  iceConnectionState: RTCIceConnectionState | "closed";
  dataChannelState: RTCDataChannelState | "closed";
  isSpeaking: boolean;
  rmsDb: number;
  peakDb: number;
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
  maxCommitIntervalMs: number;
  silenceCommitMs: number;
  speechThresholdDb: number;
  deviceId?: string;
};

const initialTimings: SpikeConnectionTimings = {
  microphoneReadyMs: null,
  clientSecretReadyMs: null,
  remoteDescriptionReadyMs: null,
  dataChannelOpenMs: null
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
  private lastVoiceAt = 0;
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
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(this.options.deviceId
          ? { deviceId: { exact: this.options.deviceId } }
          : {})
      };
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });
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
      const isSpeaking = rmsDb >= this.options.speechThresholdDb;

      if (isSpeaking) {
        this.lastVoiceAt = now;
        if (this.activeTurnId === null) {
          this.beginTurn(now);
        }
      }

      if (
        this.activeTurnId !== null &&
        ((!isSpeaking && now - this.lastVoiceAt >= this.options.silenceCommitMs) ||
          now - this.activeTurnStartedAt >= this.options.maxCommitIntervalMs)
      ) {
        this.commitActiveTurn(
          now - this.activeTurnStartedAt >= this.options.maxCommitIntervalMs
            ? "max-interval"
            : "silence"
        );
      }

      this.patch({ rmsDb, peakDb, isSpeaking });
    }, 50);
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
    this.patch({ phase: "connected", error: null });
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
