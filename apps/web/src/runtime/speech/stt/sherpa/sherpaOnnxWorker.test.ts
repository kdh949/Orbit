import { dirname, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as vm from "node:vm";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const adapterEntryPath =
  "/src/runtime/speech/stt/sherpa/sherpaOnnxLiveSttAdapter.ts";
const workerFilePath =
  "/src/runtime/speech/stt/sherpa/sherpaOnnxWorker.ts?worker_file&type=classic";
const audioWorkletPath =
  "/src/runtime/speech/stt/sherpa/liveSttPcmCapture.worklet.js?no-inline";

describe("sherpaOnnxWorker classic worker output", () => {
  let server: ViteDevServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("lets Vite own the default worker URL in the adapter entry", async () => {
    server = await createTestServer();
    const source = await readFile(
      resolve(
        webRoot,
        "src/runtime/speech/stt/sherpa/sherpaOnnxLiveSttAdapter.ts"
      ),
      "utf8"
    );

    const result = await server.transformRequest(adapterEntryPath);
    const executableCode = stripInlineSourceMap(result?.code ?? "");

    expect(source).toContain('new URL("./sherpaOnnxWorker.ts", import.meta.url)');
    expect(source).not.toContain(
      "./sherpaOnnxWorker.ts?worker_file&type=classic"
    );
    expect(result).not.toBeNull();
    expect(executableCode).toContain("new Worker(");
    expect(executableCode).not.toContain(
      "./sherpaOnnxWorker.ts?worker_file&type=classic"
    );
  });

  it("does not leave ESM static syntax in the classic worker response", async () => {
    server = await createTestServer();
    const response = await fetchDevServerText(server, workerFilePath);
    const executableCode = stripViteDevEnvBootstrap(
      stripInlineSourceMap(response.body)
    );

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("javascript");
    expect(response.body).toContain('importScripts("/@vite/env")');
    expect(response.body).not.toMatch(/^\s*<!doctype html>/i);
    expect(executableCode).toContain("class SherpaAudioFrameBatcher");
    expect(executableCode).not.toMatch(/(^|\n)\s*import\s+(?!Scripts\b)/);
    expect(executableCode).not.toMatch(/(^|\n)\s*export\s+/);
    expect(executableCode).not.toContain("/src/");
    expect(executableCode).not.toContain("/@vite/");
  });

  it("serves the audio worklet as JavaScript instead of fallback HTML", async () => {
    server = await createTestServer();
    const response = await fetchDevServerText(server, audioWorkletPath);
    const executableCode = stripInlineSourceMap(response.body);

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("javascript");
    expect(response.body).not.toMatch(/^\s*<!doctype html>/i);
    expect(executableCode).toContain("registerProcessor(");
    expect(executableCode).not.toMatch(/(^|\n)\s*import\s+/);
    expect(executableCode).not.toMatch(/(^|\n)\s*export\s+/);
  });

  it("reports a clear setup error before loading pthread sherpa runtimes without SharedArrayBuffer", async () => {
    server = await createWorkerTransformServer();
    const result = await server.transformRequest(
      "/src/runtime/speech/stt/sherpa/sherpaOnnxWorker.ts?worker_file&type=classic"
    );
    const executableCode = stripInlineSourceMap(result?.code ?? "");
    const posted: Array<Record<string, unknown>> = [];
    const importScripts = vi.fn();
    const context: WorkerTestContext = {
      ArrayBuffer,
      Float32Array,
      SharedArrayBuffer: undefined,
      TextEncoder,
      URL,
      console,
      fetch: vi.fn(),
      performance: { now: () => 0 },
      postMessage: (message: Record<string, unknown>) => {
        posted.push(message);
      },
      close: vi.fn(),
      queueMicrotask: (callback: () => void) => queueMicrotask(callback),
      importScripts
    };

    vm.runInNewContext(executableCode, context);
    importScripts.mockClear();
    await sendWorkerMessage(context, {
      type: "load",
      manifest: {
        ...manifestFixture(),
        runtime: {
          helpers: [],
          script: "http://model.local/sherpa-onnx-wasm-main-vad-asr.js",
          wasm: "http://model.local/sherpa-onnx-wasm-main-vad-asr.wasm",
          data: null
        }
      }
    });

    expect(importScripts).not.toHaveBeenCalled();
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "LIVE_STT_MODEL_UNAVAILABLE",
        message: expect.stringContaining("SharedArrayBuffer")
      })
    );
  });

  it("keeps the active recognizer usable when update-bias recreation fails", async () => {
    server = await createWorkerTransformServer();
    const result = await server.transformRequest(
      "/src/runtime/speech/stt/sherpa/sherpaOnnxWorker.ts?worker_file&type=classic"
    );
    const executableCode = stripInlineSourceMap(result?.code ?? "");
    const posted: Array<Record<string, unknown>> = [];
    const freed: string[] = [];
    let failNextStreamCreation = false;
    const context: WorkerTestContext = {
      ArrayBuffer,
      Float32Array,
      TextEncoder,
      URL,
      console,
      fetch: vi.fn(async () => new Response(new ArrayBuffer(1))),
      performance: { now: () => 0 },
      postMessage: (message: Record<string, unknown>) => {
        posted.push(message);
      },
      close: vi.fn(),
      queueMicrotask: (callback: () => void) => queueMicrotask(callback),
      importScripts: vi.fn(() => {
        const runtimeModule = context.Module;
        if (!runtimeModule) {
          return;
        }
        runtimeModule.calledRun = true;
        runtimeModule.FS_createDataFile = vi.fn();
        runtimeModule.FS_unlink = vi.fn();
        runtimeModule.createOnlineRecognizer = vi.fn(() =>
          createFakeRecognizer(freed, () => failNextStreamCreation)
        );
      })
    };

    vm.runInNewContext(executableCode, context);
    await sendWorkerMessage(context, { type: "load", manifest: manifestFixture() });
    await sendWorkerMessage(context, {
      type: "start",
      sessionId: "session-1",
      decodeBatchSamples: 1,
      debugStatsEnabled: false,
      biasContext: biasContextFixture("slide-1"),
      decodingMethod: null
    });

    failNextStreamCreation = true;
    await sendWorkerMessage(context, {
      type: "update-bias",
      sessionId: "session-1",
      biasContext: biasContextFixture("slide-2")
    });
    failNextStreamCreation = false;

    expect(freed).not.toContain("stream-1");
    expect(freed).not.toContain("recognizer-1");
    const errorsAfterUpdate = posted.filter((message) => message.type === "error").length;
    expect(errorsAfterUpdate).toBe(1);

    await sendWorkerMessage(context, {
      type: "audio-frame",
      sessionId: "session-1",
      sampleRate: 16000,
      samples: new Float32Array([0])
    });
    await sendWorkerMessage(context, { type: "stop", sessionId: "session-1" });

    expect(posted.filter((message) => message.type === "error")).toHaveLength(
      errorsAfterUpdate
    );
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "stopped", sessionId: "session-1" })
    );
  });

  it("falls back to greedy_search when the hotword recognizer fails to build", async () => {
    server = await createWorkerTransformServer();
    const result = await server.transformRequest(
      "/src/runtime/speech/stt/sherpa/sherpaOnnxWorker.ts?worker_file&type=classic"
    );
    const executableCode = stripInlineSourceMap(result?.code ?? "");
    const posted: Array<Record<string, unknown>> = [];
    const freed: string[] = [];
    const warnings: string[] = [];
    const context: WorkerTestContext = {
      ArrayBuffer,
      Float32Array,
      TextEncoder,
      URL,
      console: { ...console, warn: (...args: unknown[]) => warnings.push(args.join(" ")) },
      fetch: vi.fn(async () => new Response(new ArrayBuffer(1))),
      performance: { now: () => 0 },
      postMessage: (message: Record<string, unknown>) => {
        posted.push(message);
      },
      close: vi.fn(),
      queueMicrotask: (callback: () => void) => queueMicrotask(callback),
      importScripts: vi.fn(() => {
        const runtimeModule = context.Module;
        if (!runtimeModule) {
          return;
        }
        runtimeModule.calledRun = true;
        runtimeModule.FS_createDataFile = vi.fn();
        runtimeModule.FS_unlink = vi.fn();
        // modified_beam_search (forced by hotwords) blows up like the real WASM
        // does with a bad bpe vocab; greedy_search must still succeed.
        runtimeModule.createOnlineRecognizer = vi.fn(
          (first: Record<string, unknown>, second?: Record<string, unknown>) => {
            const config = second ?? first;
            if (config?.decodingMethod === "modified_beam_search") {
              throw new Error("modified_beam_search unsupported in test runtime");
            }
            return createFakeRecognizer(freed, () => false);
          }
        );
      })
    };

    vm.runInNewContext(executableCode, context);
    await sendWorkerMessage(context, { type: "load", manifest: manifestFixture() });
    await sendWorkerMessage(context, {
      type: "start",
      sessionId: "session-1",
      decodeBatchSamples: 1,
      debugStatsEnabled: false,
      biasContext: biasContextFixture("slide-1"),
      decodingMethod: null
    });

    expect(posted.filter((message) => message.type === "error")).toHaveLength(0);
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "started", sessionId: "session-1" })
    );
    expect(warnings.some((line) => line.includes("hotword bias disabled"))).toBe(
      true
    );
  });
});

function createTestServer() {
  return createServer({
    root: webRoot,
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0
    },
    worker: {
      format: "iife"
    }
  });
}

async function fetchDevServerText(server: ViteDevServer, path: string) {
  const request = new MockRequest(path);
  const response = new MockResponse();

  await new Promise<void>((resolve, reject) => {
    response.on("finish", resolve);
    response.on("error", reject);
    server.middlewares(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
      (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }

        if (!response.writableEnded) {
          response.statusCode = 404;
          response.end();
        }
      }
    );
  });
  return {
    status: response.status,
    contentType: response.header("content-type"),
    body: response.text()
  };
}

function stripInlineSourceMap(code: string) {
  return code.replace(/\n\/\/# sourceMappingURL=.*$/s, "");
}

function createWorkerTransformServer() {
  return createServer({
    root: webRoot,
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: {
      middlewareMode: true
    },
    worker: {
      format: "iife"
    }
  });
}

type WorkerTestContext = {
  Module?: Record<string, unknown>;
  onmessage?: (event: { data: Record<string, unknown> }) => void;
  [key: string]: unknown;
};

async function sendWorkerMessage(
  context: WorkerTestContext,
  data: Record<string, unknown>
) {
  context.onmessage?.({ data });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function manifestFixture() {
  return {
    modelId: "korean-streaming-test",
    version: "2026-06-30",
    baseUrl: "http://model.local/",
    sampleRate: 16000,
    runtime: {
      helpers: [],
      script: "http://model.local/runtime.js",
      wasm: null,
      data: null
    },
    model: {
      encoder: "encoder.onnx",
      decoder: "decoder.onnx",
      joiner: "joiner.onnx",
      tokens: "tokens.txt",
      bpeVocab: null
    }
  };
}

function biasContextFixture(slideId: string) {
  return {
    slideId,
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
}

function createFakeRecognizer(
  freed: string[],
  shouldFailStreamCreation: () => boolean
) {
  const id = freed.filter((value) => value.startsWith("created-")).length + 1;
  freed.push(`created-${id}`);
  const stream = {
    id: `stream-${id}`,
    freed: false,
    acceptWaveform(this: { id: string; freed: boolean }) {
      throwIfFreed(this);
    },
    inputFinished(this: { id: string; freed: boolean }) {
      throwIfFreed(this);
    },
    free(this: { id: string; freed: boolean }) {
      this.freed = true;
      freed.push(this.id);
    }
  };
  const recognizer = {
    id: `recognizer-${id}`,
    freed: false,
    createStream() {
      if (shouldFailStreamCreation()) {
        throw new Error("createStream failed");
      }
      return stream;
    },
    decode(this: { id: string; freed: boolean }) {
      throwIfFreed(this);
    },
    isReady(this: { id: string; freed: boolean }) {
      throwIfFreed(this);
      return false;
    },
    getResult(this: { id: string; freed: boolean }) {
      throwIfFreed(this);
      return { text: "", confidence: null };
    },
    isEndpoint(this: { id: string; freed: boolean }) {
      throwIfFreed(this);
      return false;
    },
    free(this: { id: string; freed: boolean }) {
      this.freed = true;
      freed.push(this.id);
    }
  };

  return recognizer;
}

function throwIfFreed(resource: { id: string; freed: boolean }) {
  if (resource.freed) {
    throw new Error(`${resource.id} was already freed`);
  }
}

function stripViteDevEnvBootstrap(code: string) {
  return code.replace(/^\s*importScripts\("\/@vite\/env"\)\s*;\s*/, "");
}

class MockRequest extends Readable {
  method = "GET";
  headers = { host: "127.0.0.1" };

  constructor(readonly url: string) {
    super();
  }

  override _read() {
    this.push(null);
  }
}

class MockResponse extends Writable {
  private readonly chunks: Buffer[] = [];
  private readonly headers = new Map<string, string>();

  statusCode = 200;

  get status() {
    return this.statusCode;
  }

  setHeader(name: string, value: number | string | readonly string[]) {
    this.headers.set(
      name.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : String(value)
    );
    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }

  removeHeader(name: string) {
    this.headers.delete(name.toLowerCase());
  }

  writeHead(
    statusCode: number,
    headers?: Record<string, number | string | readonly string[]>
  ) {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers ?? {})) {
      this.setHeader(name, value);
    }
    return this;
  }

  header(name: string) {
    return this.headers.get(name.toLowerCase()) ?? "";
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    );
    callback();
  }

  override end(
    chunk?: Buffer | string | (() => void),
    encoding?: BufferEncoding | (() => void),
    callback?: () => void
  ) {
    if (typeof chunk === "function") {
      return super.end(chunk);
    }

    if (chunk) {
      this.chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(
              chunk,
              typeof encoding === "string" ? encoding : "utf8"
            )
      );
    }

    return super.end(typeof encoding === "function" ? encoding : callback);
  }
}
