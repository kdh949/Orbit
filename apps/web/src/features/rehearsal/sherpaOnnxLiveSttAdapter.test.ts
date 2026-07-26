import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SherpaOnnxLiveSttAdapter,
  resampleFloat32Audio
} from "./sherpaOnnxLiveSttAdapter";
import type { LiveSttBiasContext, LiveSttDecodingMethod } from "../../runtime/speech/stt/liveSttAdapter";
import type { LiveSttDebugPcmRecording } from "../../runtime/speech/stt/liveSttPcmDebug";
import type { SherpaOnnxModelManifest } from "./sherpaOnnxManifest";

describe("SherpaOnnxLiveSttAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads the manifest, starts a worker session, and forwards partial transcript events", async () => {
    const calls: string[] = [];
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(48000);
    const partials: string[] = [];
    const errors: string[] = [];
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return jsonResponse(manifestFixture());
      }) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      bufferSize: 4
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: (event) => partials.push(event.transcript),
      onError: (error) => errors.push(error.code)
    });

    audioContext.emitAudio(new Float32Array([0, 0.5, 1, 0]));
    adapter.stop();
    adapter.dispose();

    expect(calls).toEqual(["/models/live-stt/korean/manifest.json"]);
    expect(worker.messages.map((message) => message.type)).toEqual([
      "load",
      "start",
      "audio-frame",
      "stop",
      "dispose"
    ]);
    expect(worker.messages[1]).toMatchObject({
      type: "start",
      decodeBatchSamples: 2048
    });
    expect(worker.audioFrames).toHaveLength(1);
    expect(worker.audioFrames[0]?.sampleRate).toBe(16000);
    expect(audioContext.audioWorklet!.moduleLoads).toHaveLength(1);
    expect(audioContext.audioWorklet!.moduleLoads[0]?.options).toEqual({
      credentials: "same-origin"
    });
    expect(audioContext.workletNode?.processorOptions).toEqual({ frameSize: 4 });
    expect(audioContext.workletNode?.port.messages).toEqual([{ type: "dispose" }]);
    expect(audioContext.state).toBe("closed");
    expect(partials).toEqual(["오르빗 실시간 음성 인식"]);
    expect(errors).toEqual([]);
    expect(worker.isTerminated).toBe(true);
  });

  it("uses low-latency capture and batched decode defaults", async () => {
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined
    });
    adapter.dispose();

    expect(audioContext.workletNode?.processorOptions).toEqual({ frameSize: 512 });
    expect(worker.messages[1]).toMatchObject({
      type: "start",
      decodeBatchSamples: 2048
    });
  });

  it("calculates worker decode batch samples from the configured duration", async () => {
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      decodeBatchDurationMs: 250
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined
    });
    adapter.dispose();

    expect(worker.messages[1]).toMatchObject({
      type: "start",
      decodeBatchSamples: 4000
    });
  });

  it("passes live STT bias context to worker start and update messages", async () => {
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const biasContext: LiveSttBiasContext = {
      slideId: "slide_1",
      terms: [
        {
          text: "오르빗",
          source: "keyword",
          weight: 1,
          keywordId: "kw_orbit",
          canonicalText: "오르빗"
        }
      ]
    };
    const nextBiasContext: LiveSttBiasContext = {
      slideId: "slide_2",
      terms: [
        {
          text: "라이브 STT",
          source: "keyword",
          weight: 1,
          keywordId: "kw_live_stt",
          canonicalText: "라이브 STT"
        }
      ]
    };
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode
    });

    await adapter.start(
      { getTracks: () => [] } as unknown as MediaStream,
      {
        onPartialTranscript: () => undefined,
        onError: () => undefined
      },
      { biasContext }
    );
    adapter.updateBiasContext(nextBiasContext);
    adapter.dispose();

    expect(worker.messages[1]).toMatchObject({
      type: "start",
      biasContext
    });
    expect(worker.messages[2]).toMatchObject({
      type: "update-bias",
      biasContext: nextBiasContext
    });
  });

  it("passes a decoding method override to the worker start message", async () => {
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode
    });

    await adapter.start(
      { getTracks: () => [] } as unknown as MediaStream,
      {
        onPartialTranscript: () => undefined,
        onError: () => undefined
      },
      { decodingMethod: "modified_beam_search" }
    );
    adapter.dispose();

    expect(worker.messages[1]).toMatchObject({
      type: "start",
      decodingMethod: "modified_beam_search"
    });
  });

  it("exports a local WAV copy of the resampled model input when PCM debug is enabled", async () => {
    vi.stubGlobal("window", {
      location: { href: "http://localhost/" },
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === "orbit.liveStt.debugPcmDump" ? "1" : null
        )
      }
    });
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const recordings: LiveSttDebugPcmRecording[] = [];
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      bufferSize: 4
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined,
      onDebugPcmAvailable: (recording) => recordings.push(recording)
    });
    audioContext.emitAudio(new Float32Array([0, 0.5, -0.5, 1]));
    adapter.stop();
    adapter.dispose();

    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({
      sampleRate: 16000,
      durationMs: 0,
      peak: 1
    });
    expect(worker.audioFrames[0]?.samples).toEqual(
      new Float32Array([0, 0.5, -0.5, 1])
    );

    const view = new DataView(await recordings[0]!.blob.arrayBuffer());
    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(readPcm16Samples(view)).toEqual([0, 16384, -16384, 32767]);
  });

  it("does not export a debug PCM recording by default or after stale capture messages", async () => {
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const recordings: LiveSttDebugPcmRecording[] = [];
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      bufferSize: 4
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined,
      onDebugPcmAvailable: (recording) => recordings.push(recording)
    });
    audioContext.emitAudio(new Float32Array([0, 0.5, -0.5, 1]));
    adapter.stop();
    audioContext.emitAudio(new Float32Array([1, 1, 1, 1]));
    adapter.dispose();

    expect(recordings).toEqual([]);
    expect(worker.audioFrames).toHaveLength(1);
  });

  it("reports microphone audio levels at a throttled cadence", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const audioLevels: Array<{ peak: number; isLikelySilence: boolean }> = [];
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      bufferSize: 4
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined,
      onAudioLevel: (event) =>
        audioLevels.push({
          peak: event.peak,
          isLikelySilence: event.isLikelySilence
        })
    });

    audioContext.emitAudio(new Float32Array([0, 0, 0, 0]));
    now += 100;
    audioContext.emitAudio(new Float32Array([0, 0.5, 0, -0.5]));
    now += 150;
    audioContext.emitAudio(new Float32Array([0, 0.5, 0, -0.5]));
    adapter.dispose();

    expect(audioLevels).toEqual([
      { peak: 0, isLikelySilence: true },
      { peak: 0.5, isLikelySilence: false }
    ]);
  });

  it("does not report stale microphone audio levels after stop", async () => {
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(16000);
    const audioLevels: number[] = [];
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      bufferSize: 4
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined,
      onAudioLevel: (event) => audioLevels.push(event.peak)
    });

    adapter.stop();
    audioContext.emitAudio(new Float32Array([0, 0.5, 0, -0.5]));
    adapter.dispose();

    expect(audioLevels).toEqual([]);
  });

  it("does not log latency metrics when debug latency is disabled", async () => {
    const debugLog = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      location: { href: "http://localhost/" },
      localStorage: {
        getItem: vi.fn(() => null)
      }
    });
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(48000);
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      bufferSize: 4
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined
    });
    audioContext.emitAudio(new Float32Array([0, 0.5, 1, 0]));
    const sessionId = readStartedSessionId(worker);
    worker.emitWorkerMessage({
      type: "debug-stats",
      sessionId,
      stats: workerDebugStatsFixture()
    });
    adapter.dispose();

    expect(debugLog).not.toHaveBeenCalled();
  });

  it("logs latency metrics with transcript text when debug latency is enabled", async () => {
    const debugLog = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      location: { href: "http://localhost/" },
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === "orbit.liveStt.debugLatency" ? "1" : null
        )
      }
    });
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(48000);
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode,
      bufferSize: 4
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: () => undefined
    });
    audioContext.emitAudio(new Float32Array([0, 0.5, 1, 0]));
    const sessionId = readStartedSessionId(worker);
    worker.emitWorkerMessage({
      type: "debug-stats",
      sessionId: "stale-session",
      stats: workerDebugStatsFixture({ decodedBatches: 99 })
    });
    worker.emitWorkerMessage({
      type: "partial",
      sessionId: "stale-session",
      transcript: "stale transcript",
      isFinal: false,
      confidence: 0.12
    });
    worker.emitWorkerMessage({
      type: "debug-stats",
      sessionId,
      stats: workerDebugStatsFixture()
    });
    adapter.dispose();

    const serializedLogs = JSON.stringify(debugLog.mock.calls);
    const partialCallbackMetrics = debugLog.mock.calls.find(([message]) =>
      String(message).includes("partial-callback")
    )?.[1] as Record<string, number> | undefined;
    const audioLevelMetrics = debugLog.mock.calls.find(([message]) =>
      String(message).includes("audio-level")
    )?.[1] as Record<string, number> | undefined;
    const workerDebugLogs = debugLog.mock.calls.filter(([message]) =>
      String(message).startsWith("[orbit-live-stt-worker]")
    );
    const transcriptLogs = debugLog.mock.calls.filter(([message]) =>
      String(message).startsWith("[orbit-live-stt-transcript]")
    );

    expect(debugLog).toHaveBeenCalled();
    expect(serializedLogs).toContain("오르빗 실시간 음성 인식");
    expect(serializedLogs).not.toContain("stale transcript");
    expect(transcriptLogs).toHaveLength(1);
    expect(transcriptLogs[0]?.[1]).toEqual({
      sessionId,
      isFinal: false,
      confidence: 0.91,
      transcript: "오르빗 실시간 음성 인식"
    });
    expect(audioLevelMetrics).toMatchObject({
      peak: 1,
      peakDb: 0,
      isLikelySilence: 0
    });
    expect(typeof audioLevelMetrics?.rms).toBe("number");
    expect(typeof audioLevelMetrics?.rmsDb).toBe("number");
    expect(partialCallbackMetrics).toMatchObject({
      captureFrameSize: 4,
      sourceSampleRate: 48000,
      targetSampleRate: 16000,
      captureFrameDurationMs: 0,
      decodeBatchSamples: 2048,
      decodeBatchDurationMs: 128,
      isFinal: 0
    });
    expect(typeof partialCallbackMetrics?.callbackIntervalMs).toBe("number");
    expect(workerDebugLogs).toHaveLength(1);
    const workerLogMessage = String(workerDebugLogs[0]?.[0]);
    const workerLogPayload = JSON.parse(
      workerLogMessage.slice("[orbit-live-stt-worker] ".length)
    ) as Record<string, number | boolean>;
    expect(workerLogPayload).toMatchObject({
      decodedBatches: 2,
      acceptedSamples: 4096,
      batchSamples: 2048,
      decodeLoops: 64,
      readyAfterLoopCap: true,
      endpoint: false,
      resultChanged: false,
      resultLength: 12,
      audioMaxAbs: 0.42,
      audioRms: 0.1
    });
  });

  it("maps an unavailable manifest to the live STT model unavailable error", async () => {
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/missing-manifest.json",
      fetcher: vi.fn(async () => new Response("missing", { status: 404 })) as typeof fetch,
      createWorker: () => new FakeSherpaWorker()
    });

    await expect(
      adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
        onPartialTranscript: () => undefined,
        onError: () => undefined
      })
    ).rejects.toMatchObject({ code: "LIVE_STT_MODEL_UNAVAILABLE" });
  });

  it("maps unsupported AudioWorklet capture to the live STT model unavailable error", async () => {
    const audioContext = new FakeAudioContext(48000, {
      supportsAudioWorklet: false
    });
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => new FakeSherpaWorker(),
      createAudioContext: () => audioContext as unknown as AudioContext
    });

    await expect(
      adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
        onPartialTranscript: () => undefined,
        onError: () => undefined
      })
    ).rejects.toMatchObject({ code: "LIVE_STT_MODEL_UNAVAILABLE" });
    expect(audioContext.state).toBe("closed");
  });

  it("maps AudioWorklet module load failures to the live STT start failed error", async () => {
    const audioContext = new FakeAudioContext(48000, {
      addModuleError: new Error("module failed")
    });
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => new FakeSherpaWorker(),
      createAudioContext: () => audioContext as unknown as AudioContext
    });

    await expect(
      adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
        onPartialTranscript: () => undefined,
        onError: () => undefined
      })
    ).rejects.toMatchObject({ code: "LIVE_STT_START_FAILED" });
    expect(audioContext.state).toBe("closed");
  });

  it("reports AudioWorklet processor failures through the live STT error callback", async () => {
    const worker = new FakeSherpaWorker();
    const audioContext = new FakeAudioContext(48000);
    const errors: string[] = [];
    const adapter = new SherpaOnnxLiveSttAdapter({
      manifestUrl: "/models/live-stt/korean/manifest.json",
      fetcher: vi.fn(async () => jsonResponse(manifestFixture())) as typeof fetch,
      createWorker: () => worker,
      createAudioContext: () => audioContext as unknown as AudioContext,
      createAudioWorkletNode: (_context, _name, options) =>
        audioContext.createAudioWorkletNode(options) as unknown as AudioWorkletNode
    });

    await adapter.start({ getTracks: () => [] } as unknown as MediaStream, {
      onPartialTranscript: () => undefined,
      onError: (error) => errors.push(error.code)
    });

    audioContext.workletNode?.emitProcessorError();

    expect(errors).toEqual(["LIVE_STT_START_FAILED"]);
    expect(worker.messages.map((message) => message.type)).toEqual([
      "load",
      "start",
      "stop"
    ]);
    expect(audioContext.state).toBe("closed");
  });

  it("resamples microphone PCM to the model sample rate", () => {
    const output = resampleFloat32Audio(new Float32Array([0, 0.5, 1, 0]), 4, 2);

    expect(Array.from(output)).toEqual([0, 1]);
  });
});

class FakeSherpaWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: Array<{
    type: string;
    sessionId?: string;
    sampleRate?: number;
    samples?: Float32Array;
    decodeBatchSamples?: number;
    debugStatsEnabled?: boolean;
    biasContext?: LiveSttBiasContext | null;
    decodingMethod?: LiveSttDecodingMethod | null;
  }> = [];
  audioFrames: Array<{ sampleRate: number; samples: Float32Array }> = [];
  isTerminated = false;

  postMessage(
    message: {
      type: string;
      sessionId?: string;
      sampleRate?: number;
      samples?: Float32Array;
      decodeBatchSamples?: number;
      debugStatsEnabled?: boolean;
      biasContext?: LiveSttBiasContext | null;
      decodingMethod?: LiveSttDecodingMethod | null;
    },
    _transfer?: Transferable[] | StructuredSerializeOptions
  ) {
    this.messages.push(message);

    if (message.type === "load") {
      this.emit({ type: "loaded", modelId: "korean", version: "2024-06-16" });
      return;
    }

    if (message.type === "start" && message.sessionId) {
      this.emit({ type: "started", sessionId: message.sessionId });
      return;
    }

    if (
      message.type === "audio-frame" &&
      message.sessionId &&
      typeof message.sampleRate === "number" &&
      message.samples
    ) {
      this.audioFrames.push({
        sampleRate: message.sampleRate,
        samples: message.samples
      });
      this.emit({
        type: "partial",
        sessionId: message.sessionId,
        transcript: "오르빗 실시간 음성 인식",
        isFinal: false,
        confidence: 0.91
      });
    }
  }

  terminate() {
    this.isTerminated = true;
  }

  emitWorkerMessage(data: unknown) {
    this.emit(data);
  }

  private emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  destination = new FakeAudioNode();
  audioWorklet?: FakeAudioWorklet;
  workletNode: FakeAudioWorkletNode | null = null;

  constructor(
    readonly sampleRate: number,
    options: { supportsAudioWorklet?: boolean; addModuleError?: Error } = {}
  ) {
    if (options.supportsAudioWorklet !== false) {
      this.audioWorklet = new FakeAudioWorklet(options.addModuleError);
    }
  }

  createMediaStreamSource(_stream: MediaStream) {
    return new FakeAudioNode();
  }

  createAudioWorkletNode(options: AudioWorkletNodeOptions) {
    this.workletNode = new FakeAudioWorkletNode(options.processorOptions);
    return this.workletNode;
  }

  createGain() {
    return new FakeGainNode();
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }

  emitAudio(samples: Float32Array) {
    this.workletNode?.port.emit({
      type: "audio-frame",
      sampleRate: this.sampleRate,
      samples
    });
  }
}

class FakeAudioWorklet {
  moduleLoads: Array<{ url: string; options?: WorkletOptions }> = [];

  constructor(private readonly addModuleError?: Error) {}

  async addModule(url: string, options?: WorkletOptions) {
    this.moduleLoads.push({ url, options });

    if (this.addModuleError) {
      throw this.addModuleError;
    }
  }
}

class FakeAudioNode {
  connect(_node?: unknown) {
    return _node;
  }

  disconnect() {}
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 };
}

class FakeAudioWorkletNode extends FakeAudioNode {
  port = new FakeMessagePort();
  onprocessorerror: ((event: Event) => void) | null = null;

  constructor(readonly processorOptions: unknown) {
    super();
  }

  emitProcessorError() {
    this.onprocessorerror?.(new Event("processorerror"));
  }
}

class FakeMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  messages: unknown[] = [];

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  start() {}

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function manifestFixture(): SherpaOnnxModelManifest {
  return {
    provider: "sherpa-onnx",
    modelId: "sherpa-onnx-streaming-zipformer-korean-2024-06-16",
    version: "2024-06-16",
    baseUrl: ".",
    sampleRate: 16000,
    runtime: {
      script: "sherpa-onnx-wasm-main-asr.js",
      wasm: "sherpa-onnx-wasm-main-asr.wasm",
      data: "sherpa-onnx-wasm-main-asr.data"
    },
    model: {
      encoder: "encoder.onnx",
      decoder: "decoder.onnx",
      joiner: "joiner.onnx",
      tokens: "tokens.txt"
    }
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" }
  });
}

function readStartedSessionId(worker: FakeSherpaWorker) {
  const sessionId = worker.messages.find((message) => message.type === "start")
    ?.sessionId;
  if (!sessionId) {
    throw new Error("Expected Live STT worker session to be started.");
  }

  return sessionId;
}

function readAscii(view: DataView, offset: number, length: number) {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index))
  ).join("");
}

function readPcm16Samples(view: DataView) {
  const length = view.getUint32(40, true) / 2;
  return Array.from({ length }, (_, index) =>
    view.getInt16(44 + index * 2, true)
  );
}

function workerDebugStatsFixture(
  overrides: Partial<{
    decodedBatches: number;
    acceptedSamples: number;
    batchSamples: number;
    acceptMs: number;
    decodeMs: number;
    decodeLoops: number;
    readyAfterLoopCap: boolean;
    endpoint: boolean;
    resultChanged: boolean;
    resultLength: number;
    audioMaxAbs: number;
    audioRms: number;
  }> = {}
) {
  return {
    decodedBatches: 2,
    acceptedSamples: 4096,
    batchSamples: 2048,
    acceptMs: 1.5,
    decodeMs: 130.25,
    decodeLoops: 64,
    readyAfterLoopCap: true,
    endpoint: false,
    resultChanged: false,
    resultLength: 12,
    audioMaxAbs: 0.42,
    audioRms: 0.1,
    ...overrides
  };
}
