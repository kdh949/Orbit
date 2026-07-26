import type { LiveSttBiasContext, LiveSttDecodingMethod } from "../liveSttAdapter";

type SherpaAudioFrame = {
  sampleRate: number;
  samples: Float32Array;
};

type SherpaAudioFrameBatch = {
  frames: SherpaAudioFrame[];
  sampleCount: number;
};

// Keep this local so the classic worker response never contains ESM imports.
class SherpaAudioFrameBatcher {
  private frames: SherpaAudioFrame[] = [];
  private sampleCount = 0;
  private readonly decodeBatchSamples: number;

  constructor(decodeBatchSamples: number) {
    this.decodeBatchSamples = normalizeDecodeBatchSamples(decodeBatchSamples);
  }

  push(frame: SherpaAudioFrame) {
    this.frames.push(frame);
    this.sampleCount += frame.samples.length;

    if (this.sampleCount < this.decodeBatchSamples) {
      return null;
    }

    return this.flush();
  }

  flush(): SherpaAudioFrameBatch | null {
    if (this.frames.length === 0) {
      return null;
    }

    const batch = {
      frames: this.frames,
      sampleCount: this.sampleCount
    };
    this.reset();
    return batch;
  }

  reset() {
    this.frames = [];
    this.sampleCount = 0;
  }
}

type WorkerManifest = {
  modelId: string;
  version: string;
  baseUrl: string;
  sampleRate: number;
  numThreads?: number;
  decodingMethod?: LiveSttDecodingMethod;
  runtime: {
    helpers: string[];
    script: string;
    wasm: string | null;
    data: string | null;
  };
  model: {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
    bpeVocab: string | null;
  };
};

type WorkerInboundMessage =
  | { type: "load"; manifest: WorkerManifest }
  | {
      type: "start";
      sessionId: string;
      decodeBatchSamples: number;
      debugStatsEnabled: boolean;
      biasContext?: LiveSttBiasContext | null;
      decodingMethod?: LiveSttDecodingMethod | null;
    }
  | {
      type: "update-bias";
      sessionId: string;
      biasContext: LiveSttBiasContext | null;
    }
  | {
      type: "audio-frame";
      sessionId: string;
      sampleRate: number;
      samples: Float32Array;
    }
  | { type: "stop"; sessionId: string }
  | { type: "dispose" };

type WorkerOutboundMessage =
  | { type: "loaded"; modelId: string; version: string }
  | { type: "started"; sessionId: string }
  | {
      type: "partial";
      sessionId: string;
      transcript: string;
      isFinal: false;
      confidence: number | null;
    }
  | {
      type: "final";
      sessionId: string;
      transcript: string;
      isFinal: true;
      confidence: number | null;
    }
  | {
      type: "debug-stats";
      sessionId: string;
      stats: WorkerDebugStats;
    }
  | { type: "stopped"; sessionId: string }
  | {
      type: "error";
      code: "LIVE_STT_MODEL_UNAVAILABLE" | "LIVE_STT_START_FAILED";
      message: string;
      sessionId?: string;
    };

type SherpaRecognizer = Record<string, unknown>;
type SherpaStream = Record<string, unknown>;
type DecodeStreamStats = {
  loops: number;
  readyAfterLoopCap: boolean;
};
type WorkerDebugStats = {
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
};
type SherpaModule = Record<string, unknown> & {
  calledRun?: boolean;
  mainScriptUrlOrBlob?: string;
  locateFile?: (path: string, prefix: string) => string;
  getPreloadedPackage?: (packageName: string, packageSize: number) => ArrayBuffer | null;
  onRuntimeInitialized?: () => void;
  createOnlineRecognizer?: unknown;
  FS_createDataFile?: unknown;
  FS_unlink?: unknown;
};

type WorkerScope = typeof globalThis & {
  Module?: SherpaModule;
  createOnlineRecognizer?: unknown;
  crossOriginIsolated?: boolean;
  importScripts: (...urls: string[]) => void;
  close: () => void;
  onmessage: ((event: MessageEvent<WorkerInboundMessage>) => void) | null;
  postMessage: (message: WorkerOutboundMessage) => void;
};

const workerScope = globalThis as unknown as WorkerScope;

let recognizer: SherpaRecognizer | null = null;
let runtimeModule: SherpaModule | null = null;
let loadedManifest: WorkerManifest | null = null;
let stream: SherpaStream | null = null;
let activeSessionId: string | null = null;
let latestText = "";
let audioBatcher: SherpaAudioFrameBatcher | null = null;
let decodedBatches = 0;
let acceptedSamples = 0;
let shouldPostDebugStats = false;
let activeBiasKey = "";
let activeDecodingMethod: LiveSttDecodingMethod | null = null;

const fsModelPaths = {
  encoder: "/orbit-live-stt-encoder.onnx",
  decoder: "/orbit-live-stt-decoder.onnx",
  joiner: "/orbit-live-stt-joiner.onnx",
  tokens: "/orbit-live-stt-tokens.txt",
  bpeVocab: "/orbit-live-stt-bpe.model"
} as const;

workerScope.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  void handleMessage(event.data);
};

async function handleMessage(message: WorkerInboundMessage) {
  try {
    switch (message.type) {
      case "load":
        await loadRecognizer(message.manifest);
        post({
          type: "loaded",
          modelId: message.manifest.modelId,
          version: message.manifest.version
        });
        return;
      case "start":
        startSession(
          message.sessionId,
          message.decodeBatchSamples,
          message.debugStatsEnabled,
          message.biasContext ?? null,
          message.decodingMethod ?? null
        );
        return;
      case "update-bias":
        updateSessionBias(message.sessionId, message.biasContext);
        return;
      case "audio-frame":
        queueAudioFrame(message);
        return;
      case "stop":
        stopSession(message.sessionId);
        return;
      case "dispose":
        disposeRecognizer();
        return;
    }
  } catch (error) {
    post({
      type: "error",
      code:
        message.type === "load"
          ? "LIVE_STT_MODEL_UNAVAILABLE"
          : "LIVE_STT_START_FAILED",
      message: describeWorkerError(error),
      sessionId: "sessionId" in message ? message.sessionId : undefined
    });
  }
}

// sherpa-onnx WASM aborts (e.g. a malformed bpe vocab parsed by ssentencepiece)
// surface as a non-Error throw — often the numeric Emscripten exception pointer.
// Decode it where possible so failures aren't flattened to "Live STT worker failed."
function describeWorkerError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "number" && runtimeModule) {
    const getExceptionMessage = (runtimeModule as Record<string, unknown>)
      .getExceptionMessage;
    if (typeof getExceptionMessage === "function") {
      try {
        const decoded = getExceptionMessage(error) as unknown;
        const text = Array.isArray(decoded)
          ? decoded.filter(Boolean).join(": ")
          : String(decoded ?? "");
        if (text) {
          return text;
        }
      } catch {
        // fall through to generic stringification
      }
    }
  }

  const text = typeof error === "string" ? error : String(error ?? "");
  return text && text !== "[object Object]" ? text : "Live STT worker failed.";
}

async function loadRecognizer(nextManifest: WorkerManifest) {
  if (runtimeModule && loadedManifest) {
    return;
  }

  const nextModule = await loadSherpaRuntime(nextManifest);
  await installModelFiles(nextModule, nextManifest);
  runtimeModule = nextModule;
  loadedManifest = nextManifest;
}

function startSession(
  sessionId: string,
  decodeBatchSamples: number,
  debugStatsEnabled: boolean,
  biasContext: LiveSttBiasContext | null,
  decodingMethod: LiveSttDecodingMethod | null
) {
  if (!runtimeModule || !loadedManifest) {
    throw new Error("Live STT recognizer has not been loaded.");
  }

  activeSessionId = sessionId;
  latestText = "";
  decodedBatches = 0;
  acceptedSamples = 0;
  shouldPostDebugStats = debugStatsEnabled;
  activeDecodingMethod = decodingMethod;
  audioBatcher = new SherpaAudioFrameBatcher(decodeBatchSamples);
  recreateRecognizer(biasContext, decodingMethod);
  post({ type: "started", sessionId });
}

function updateSessionBias(
  sessionId: string,
  biasContext: LiveSttBiasContext | null
) {
  if (activeSessionId !== sessionId || !runtimeModule || !loadedManifest) {
    return;
  }

  const nextBiasKey = createBiasKey(biasContext);
  if (nextBiasKey === activeBiasKey) {
    return;
  }

  audioBatcher?.reset();
  latestText = "";
  recreateRecognizer(biasContext, activeDecodingMethod);
}

function queueAudioFrame(message: Extract<WorkerInboundMessage, { type: "audio-frame" }>) {
  if (!recognizer || !stream || !audioBatcher || activeSessionId !== message.sessionId) {
    return;
  }

  const samples =
    message.samples instanceof Float32Array
      ? message.samples
      : new Float32Array(message.samples);
  const batch = audioBatcher.push({
    sampleRate: message.sampleRate,
    samples
  });

  if (!batch) {
    return;
  }

  decodeAudioBatch(message.sessionId, batch);
}

function decodeAudioBatch(sessionId: string, batch: SherpaAudioFrameBatch) {
  if (!recognizer || !stream || activeSessionId !== sessionId) {
    return;
  }

  const acceptStart = performance.now();
  for (const frame of batch.frames) {
    acceptWaveform(recognizer, stream, frame.sampleRate, frame.samples);
  }
  const acceptEnd = performance.now();
  const decodeStats = decodeStream(recognizer, stream);
  const decodeEnd = performance.now();

  const result = readRecognizerResult(recognizer, stream);
  const resultChanged = Boolean(result.text && result.text !== latestText);
  const endpoint = isEndpoint(recognizer, stream);
  decodedBatches += 1;
  acceptedSamples += batch.sampleCount;
  if (shouldPostDebugStats) {
    const amplitude = measureBatchAmplitude(batch);
    post({
      type: "debug-stats",
      sessionId,
      stats: {
        decodedBatches,
        acceptedSamples,
        batchSamples: batch.sampleCount,
        acceptMs: acceptEnd - acceptStart,
        decodeMs: decodeEnd - acceptEnd,
        decodeLoops: decodeStats.loops,
        readyAfterLoopCap: decodeStats.readyAfterLoopCap,
        endpoint,
        resultChanged,
        resultLength: result.text.length,
        audioMaxAbs: amplitude.maxAbs,
        audioRms: amplitude.rms
      }
    });
  }

  if (resultChanged) {
    latestText = result.text;
    post({
      type: "partial",
      sessionId,
      transcript: result.text,
      isFinal: false,
      confidence: result.confidence
    });
  }

  if (endpoint) {
    if (latestText) {
      post({
        type: "final",
        sessionId,
        transcript: latestText,
        isFinal: true,
        confidence: result.confidence
      });
    }
    resetStream(recognizer, stream);
    latestText = "";
  }
}

function stopSession(sessionId: string) {
  if (activeSessionId !== sessionId) {
    return;
  }

  const pendingBatch = audioBatcher?.flush();
  if (pendingBatch) {
    decodeAudioBatch(sessionId, pendingBatch);
  }

  const result = recognizer && stream ? finishStream(recognizer, stream) : null;
  const finalText = result?.text || latestText;
  if (finalText) {
    post({
      type: "final",
      sessionId,
      transcript: finalText,
      isFinal: true,
      confidence: result?.confidence ?? null
    });
  }

  if (stream) {
    freeResource(stream);
  }

  stream = null;
  activeSessionId = null;
  latestText = "";
  audioBatcher = null;
  decodedBatches = 0;
  acceptedSamples = 0;
  shouldPostDebugStats = false;
  activeBiasKey = "";
  activeDecodingMethod = null;
  post({ type: "stopped", sessionId });
}

function disposeRecognizer() {
  audioBatcher?.reset();
  if (stream) {
    freeResource(stream);
  }

  if (recognizer) {
    freeResource(recognizer);
  }

  stream = null;
  recognizer = null;
  runtimeModule = null;
  loadedManifest = null;
  activeSessionId = null;
  latestText = "";
  audioBatcher = null;
  decodedBatches = 0;
  acceptedSamples = 0;
  shouldPostDebugStats = false;
  activeBiasKey = "";
  activeDecodingMethod = null;
  workerScope.close();
}

function recreateRecognizer(
  biasContext: LiveSttBiasContext | null,
  decodingMethod: LiveSttDecodingMethod | null
) {
  if (!runtimeModule || !loadedManifest) {
    throw new Error("Live STT recognizer has not been loaded.");
  }

  let nextRecognizer: SherpaRecognizer | null = null;
  let nextStream: SherpaStream | null = null;
  try {
    nextRecognizer = createRecognizer(
      runtimeModule,
      loadedManifest,
      biasContext,
      decodingMethod
    );
    nextStream = createRecognizerStream(nextRecognizer);
  } catch (error) {
    if (nextStream) {
      freeResource(nextStream);
    }
    if (nextRecognizer) {
      freeResource(nextRecognizer);
    }
    nextStream = null;
    nextRecognizer = null;

    // A hotword bias context forces modified_beam_search, which builds the bpe
    // tokenizer. If that fails (bad/missing bpe vocab) keep Live STT alive by
    // degrading to greedy_search without bias instead of killing the session.
    const usedHotwords = createHotwordsConfig(biasContext) !== null;
    if (!usedHotwords) {
      throw error;
    }

    console.warn(
      `[orbit-live-stt] hotword bias disabled, falling back to greedy_search: ${describeWorkerError(error)}`
    );
    try {
      nextRecognizer = createRecognizer(
        runtimeModule,
        loadedManifest,
        null,
        "greedy_search"
      );
      nextStream = createRecognizerStream(nextRecognizer);
      biasContext = null;
    } catch (fallbackError) {
      if (nextStream) {
        freeResource(nextStream);
      }
      if (nextRecognizer) {
        freeResource(nextRecognizer);
      }
      throw fallbackError;
    }
  }

  const previousStream = stream;
  const previousRecognizer = recognizer;
  recognizer = nextRecognizer;
  stream = nextStream;
  activeBiasKey = createBiasKey(biasContext);

  if (previousStream) {
    freeResource(previousStream);
  }

  if (previousRecognizer) {
    freeResource(previousRecognizer);
  }
}

async function loadSherpaRuntime(nextManifest: WorkerManifest) {
  assertSherpaRuntimeEnvironment(nextManifest);

  const runtimeModule: SherpaModule = {
    mainScriptUrlOrBlob: nextManifest.runtime.script,
    locateFile: (path) => {
      if (nextManifest.runtime.wasm && path.endsWith(".wasm")) {
        return nextManifest.runtime.wasm;
      }

      if (nextManifest.runtime.data && path.endsWith(".data")) {
        return nextManifest.runtime.data;
      }

      return new URL(path, nextManifest.baseUrl).toString();
    },
    getPreloadedPackage: () => {
      if (nextManifest.runtime.data) {
        return null;
      }

      return new ArrayBuffer(0);
    }
  };
  const runtimeReady = waitForRuntime(runtimeModule);
  workerScope.Module = runtimeModule;
  workerScope.importScripts(nextManifest.runtime.script);
  await runtimeReady;
  for (const helperScript of nextManifest.runtime.helpers) {
    workerScope.importScripts(helperScript);
  }
  return workerScope.Module ?? runtimeModule;
}

function assertSherpaRuntimeEnvironment(nextManifest: WorkerManifest) {
  if (!requiresSharedMemoryRuntime(nextManifest)) {
    return;
  }

  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error(
      "Live STT WASM runtime requires SharedArrayBuffer. Serve the web app with COOP/COEP headers so cross-origin isolation is enabled."
    );
  }

  if (workerScope.crossOriginIsolated === false) {
    throw new Error(
      "Live STT WASM runtime requires cross-origin isolation. Check Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers."
    );
  }
}

function requiresSharedMemoryRuntime(nextManifest: WorkerManifest) {
  return nextManifest.runtime.script.includes("vad-asr");
}

function waitForRuntime(runtimeModule: SherpaModule) {
  return new Promise<void>((resolve) => {
    const previous = runtimeModule.onRuntimeInitialized;
    runtimeModule.onRuntimeInitialized = () => {
      previous?.();
      resolve();
    };

    queueMicrotask(() => {
      if (runtimeModule.calledRun) {
        resolve();
      }
    });
  });
}

function createRecognizer(
  runtimeModule: SherpaModule,
  nextManifest: WorkerManifest,
  biasContext: LiveSttBiasContext | null,
  decodingMethodOverride: LiveSttDecodingMethod | null
) {
  const hotwords = createHotwordsConfig(biasContext);
  const config = {
    featConfig: {
      sampleRate: nextManifest.sampleRate,
      featureDim: 80
    },
    modelConfig: {
      transducer: {
        encoder: fsModelPaths.encoder,
        decoder: fsModelPaths.decoder,
        joiner: fsModelPaths.joiner
      },
      tokens: fsModelPaths.tokens,
      numThreads: nextManifest.numThreads ?? 1,
      provider: "cpu",
      debug: false,
      modelingUnit: nextManifest.model.bpeVocab ? "bpe" : "cjkchar",
      bpeVocab: nextManifest.model.bpeVocab ? fsModelPaths.bpeVocab : ""
    },
    decodingMethod: hotwords
      ? "modified_beam_search"
      : decodingMethodOverride ?? nextManifest.decodingMethod ?? "greedy_search",
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
    ...(hotwords
      ? {
          hotwordsBuf: hotwords.buffer,
          hotwordsBufSize: hotwords.bufferSize,
          hotwordsScore: hotwords.score
        }
      : {})
  };
  const factory =
    asFunction(workerScope.createOnlineRecognizer) ??
    asFunction(runtimeModule.createOnlineRecognizer) ??
    asFunction(readPath(runtimeModule, ["sherpa_onnx", "createOnlineRecognizer"])) ??
    asFunction(readPath(runtimeModule, ["sherpaOnnx", "createOnlineRecognizer"]));

  if (!factory) {
    throw new Error("sherpa-onnx WASM runtime does not expose createOnlineRecognizer.");
  }

  return tryFactoryCall(factory, runtimeModule, config);
}

function createHotwordsConfig(biasContext: LiveSttBiasContext | null) {
  const terms = (biasContext?.terms ?? [])
    .filter((term) => term.text.trim().length > 0 && term.weight >= 0.45)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 32);
  const hotwords = Array.from(
    new Set(terms.map((term) => term.text.replace(/\s+/g, " ").trim()))
  );

  if (hotwords.length === 0) {
    return null;
  }

  const maxWeight = terms.reduce(
    (current, term) => Math.max(current, term.weight),
    0
  );
  const buffer = hotwords.join("\n");
  return {
    buffer,
    bufferSize: new TextEncoder().encode(buffer).length,
    score: maxWeight >= 0.9 ? 2 : 1.5
  };
}

function createBiasKey(biasContext: LiveSttBiasContext | null) {
  if (!biasContext) {
    return "";
  }

  return `${biasContext.slideId}:${biasContext.terms
    .map((term) => `${term.source}:${term.text}:${term.weight}`)
    .join("|")}`;
}

async function installModelFiles(
  runtimeModule: SherpaModule,
  nextManifest: WorkerManifest
) {
  await Promise.all([
    writeUrlToFs(runtimeModule, nextManifest.model.encoder, fsModelPaths.encoder),
    writeUrlToFs(runtimeModule, nextManifest.model.decoder, fsModelPaths.decoder),
    writeUrlToFs(runtimeModule, nextManifest.model.joiner, fsModelPaths.joiner),
    writeUrlToFs(runtimeModule, nextManifest.model.tokens, fsModelPaths.tokens),
    nextManifest.model.bpeVocab
      ? writeUrlToFs(runtimeModule, nextManifest.model.bpeVocab, fsModelPaths.bpeVocab)
      : Promise.resolve()
  ]);
}

async function writeUrlToFs(
  runtimeModule: SherpaModule,
  sourceUrl: string,
  targetPath: string
) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Live STT model asset is unavailable: ${response.status}`);
  }

  const createDataFile = asFunction(runtimeModule.FS_createDataFile);
  if (!createDataFile) {
    throw new Error("sherpa-onnx WASM runtime does not expose FS_createDataFile.");
  }

  const unlink = asFunction(runtimeModule.FS_unlink);
  try {
    unlink?.call(runtimeModule, targetPath);
  } catch {
    // The preload may not have created this path; either state is fine.
  }

  createDataFile.call(
    runtimeModule,
    targetPath,
    null,
    new Uint8Array(await response.arrayBuffer()),
    true,
    true,
    true
  );
}

function tryFactoryCall(
  factory: (...args: unknown[]) => unknown,
  runtimeModule: SherpaModule,
  config: Record<string, unknown>
) {
  try {
    return requireRecord(factory(runtimeModule, config), "online recognizer");
  } catch (firstError) {
    try {
      return requireRecord(factory(config), "online recognizer");
    } catch {
      throw firstError;
    }
  }
}

function createRecognizerStream(nextRecognizer: SherpaRecognizer) {
  const createStream = asFunction(nextRecognizer.createStream);
  if (!createStream) {
    throw new Error("sherpa-onnx recognizer does not expose createStream.");
  }

  return requireRecord(createStream.call(nextRecognizer), "online stream");
}

function acceptWaveform(
  nextRecognizer: SherpaRecognizer,
  nextStream: SherpaStream,
  sampleRate: number,
  samples: Float32Array
) {
  const streamAccept = asFunction(nextStream.acceptWaveform);
  if (streamAccept) {
    streamAccept.call(nextStream, sampleRate, samples);
    return;
  }

  const recognizerAccept = asFunction(nextRecognizer.acceptWaveform);
  if (!recognizerAccept) {
    throw new Error("sherpa-onnx stream does not expose acceptWaveform.");
  }

  try {
    recognizerAccept.call(nextRecognizer, nextStream, sampleRate, samples);
  } catch {
    recognizerAccept.call(nextRecognizer, sampleRate, samples);
  }
}

function decodeStream(
  nextRecognizer: SherpaRecognizer,
  nextStream: SherpaStream
): DecodeStreamStats {
  const decode = asFunction(nextRecognizer.decode);
  if (!decode) {
    throw new Error("sherpa-onnx recognizer does not expose decode.");
  }

  const isReady = asFunction(nextRecognizer.isReady);
  if (!isReady) {
    decode.call(nextRecognizer, nextStream);
    return { loops: 1, readyAfterLoopCap: false };
  }

  let loops = 0;
  while (Boolean(isReady.call(nextRecognizer, nextStream)) && loops < 64) {
    decode.call(nextRecognizer, nextStream);
    loops += 1;
  }

  return {
    loops,
    readyAfterLoopCap: Boolean(isReady.call(nextRecognizer, nextStream))
  };
}

function finishStream(nextRecognizer: SherpaRecognizer, nextStream: SherpaStream) {
  const inputFinished = asFunction(nextStream.inputFinished);
  inputFinished?.call(nextStream);
  decodeStream(nextRecognizer, nextStream);
  return readRecognizerResult(nextRecognizer, nextStream);
}

function readRecognizerResult(
  nextRecognizer: SherpaRecognizer,
  nextStream: SherpaStream
) {
  const getResult = asFunction(nextRecognizer.getResult);
  if (!getResult) {
    throw new Error("sherpa-onnx recognizer does not expose getResult.");
  }

  const rawResult = getResult.call(nextRecognizer, nextStream);
  if (typeof rawResult === "string") {
    return { text: rawResult.trim(), confidence: null };
  }

  if (!isRecord(rawResult)) {
    return { text: "", confidence: null };
  }

  const text =
    readStringResult(rawResult.text) ??
    readStringResult(rawResult.transcript) ??
    readStringResult(rawResult.result) ??
    "";
  const confidence =
    typeof rawResult.confidence === "number" &&
    Number.isFinite(rawResult.confidence)
      ? rawResult.confidence
      : null;

  return { text: text.trim(), confidence };
}

function isEndpoint(nextRecognizer: SherpaRecognizer, nextStream: SherpaStream) {
  const endpoint = asFunction(nextRecognizer.isEndpoint);
  return endpoint ? Boolean(endpoint.call(nextRecognizer, nextStream)) : false;
}

function resetStream(nextRecognizer: SherpaRecognizer, nextStream: SherpaStream) {
  const reset = asFunction(nextRecognizer.reset);
  if (reset) {
    reset.call(nextRecognizer, nextStream);
    return;
  }

  const streamReset = asFunction(nextStream.reset);
  streamReset?.call(nextStream);
}

function freeResource(resource: SherpaRecognizer | SherpaStream) {
  const free = asFunction(resource.free) ?? asFunction(resource.delete);
  free?.call(resource);
}

function post(message: WorkerOutboundMessage) {
  workerScope.postMessage(message);
}

function readPath(record: Record<string, unknown>, path: string[]) {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[key];
  }, record);
}

function asFunction(value: unknown): ((...args: unknown[]) => unknown) | null {
  return typeof value === "function"
    ? (value as (...args: unknown[]) => unknown)
    : null;
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw new Error(`sherpa-onnx ${label} was not created.`);
  }

  return value;
}

function readStringResult(value: unknown) {
  return typeof value === "string" ? value : null;
}

function measureBatchAmplitude(batch: SherpaAudioFrameBatch) {
  let maxAbs = 0;
  let sumSquares = 0;
  let count = 0;
  for (const frame of batch.frames) {
    const samples = frame.samples;
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index]!;
      const abs = value < 0 ? -value : value;
      if (abs > maxAbs) {
        maxAbs = abs;
      }
      sumSquares += value * value;
      count += 1;
    }
  }

  return {
    maxAbs,
    rms: count > 0 ? Math.sqrt(sumSquares / count) : 0
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDecodeBatchSamples(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(value));
}
