import { describe, expect, it, vi } from "vitest";

import {
  createDiagnosticWorker,
  DiagnosticWorkerWriter
} from "./diagnosticStore";
import type {
  DiagnosticSession,
  OrbitDiagnosticEvent
} from "./diagnosticTypes";
import type {
  DiagnosticWorkerInboundMessage,
  DiagnosticWorkerOutboundMessage
} from "./diagnosticStore";

describe("DiagnosticWorkerWriter", () => {
  it("creates the persistence worker as an ES module", () => {
    const worker = new FakeDiagnosticWorker();
    const workerConstructor = vi.fn(function () {
      return worker;
    });
    vi.stubGlobal("Worker", workerConstructor);

    try {
      expect(createDiagnosticWorker()).toBe(worker);
      expect(workerConstructor).toHaveBeenCalledWith(expect.any(URL), {
        type: "module"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts an event batch at the configured boundary", () => {
    const worker = new FakeDiagnosticWorker();
    const writer = new DiagnosticWorkerWriter({
      batchSize: 2,
      createWorker: () => worker
    });

    writer.startSession(createSession());
    writer.append(createEvent(1));
    expect(worker.messages.map((message) => message.type)).toEqual([
      "start-session"
    ]);

    writer.append(createEvent(2));
    expect(worker.messages.at(-1)).toMatchObject({
      type: "append-events",
      events: [{ seq: 1 }, { seq: 2 }]
    });
  });

  it("does not rebind browser timer functions to the writer", () => {
    const worker = new FakeDiagnosticWorker();
    const timer = 1 as unknown as ReturnType<typeof setTimeout>;
    const setTimer = vi.fn(function (
      this: unknown,
      _callback: () => void,
      _delayMs: number
    ) {
      expect(this).toBeUndefined();
      return timer;
    });
    const clearTimer = vi.fn(function (
      this: unknown,
      receivedTimer: ReturnType<typeof setTimeout>
    ) {
      expect(this).toBeUndefined();
      expect(receivedTimer).toBe(timer);
    });
    const writer = new DiagnosticWorkerWriter({
      batchSize: 2,
      clearTimer,
      createWorker: () => worker,
      setTimer
    });

    writer.append(createEvent(1));
    writer.append(createEvent(2));

    expect(setTimer).toHaveBeenCalledOnce();
    expect(clearTimer).toHaveBeenCalledOnce();
  });

  it("flushes pending events before resolving", async () => {
    const worker = new FakeDiagnosticWorker();
    const writer = new DiagnosticWorkerWriter({
      batchSize: 50,
      createId: () => "flush_test",
      createWorker: () => worker
    });
    writer.append(createEvent(1));

    const flush = writer.flush();
    expect(worker.messages.map((message) => message.type)).toEqual([
      "append-events",
      "flush"
    ]);
    worker.emitMessage({ type: "flushed", requestId: "flush_test" });

    await expect(flush).resolves.toBeUndefined();
  });

  it("surfaces worker storage warnings without throwing from append", () => {
    const worker = new FakeDiagnosticWorker();
    const writer = new DiagnosticWorkerWriter({
      createWorker: () => worker
    });
    const listener = vi.fn();
    writer.subscribeWarnings(listener);

    expect(() => writer.append(createEvent(1))).not.toThrow();
    worker.emitMessage({ type: "warning", errorName: "QuotaExceededError" });

    expect(listener).toHaveBeenCalledWith("QuotaExceededError");
  });
});

class FakeDiagnosticWorker {
  readonly messages: DiagnosticWorkerInboundMessage[] = [];
  private messageListener:
    | ((event: MessageEvent<DiagnosticWorkerOutboundMessage>) => void)
    | null = null;

  addEventListener(
    type: "error" | "message",
    listener:
      | ((event: Event) => void)
      | ((event: MessageEvent<DiagnosticWorkerOutboundMessage>) => void)
  ) {
    if (type === "message") {
      this.messageListener =
        listener as (event: MessageEvent<DiagnosticWorkerOutboundMessage>) => void;
    }
  }

  postMessage(message: DiagnosticWorkerInboundMessage) {
    this.messages.push(message);
  }

  emitMessage(message: DiagnosticWorkerOutboundMessage) {
    this.messageListener?.({ data: message } as MessageEvent<DiagnosticWorkerOutboundMessage>);
  }
}

function createSession(): DiagnosticSession {
  return {
    schemaVersion: 1,
    sessionId: "session_test",
    mode: "full",
    surface: "presentation",
    startedAt: "2026-07-24T00:00:00.000Z",
    endedAt: null,
    eventCount: 0,
    estimatedBytes: 0,
    metadata: {}
  };
}

function createEvent(seq: number): OrbitDiagnosticEvent {
  return {
    schemaVersion: 1,
    sessionId: "session_test",
    seq,
    wallTimeIso: "2026-07-24T00:00:00.000Z",
    monotonicMs: seq,
    level: "info",
    stage: "session",
    name: "test.event",
    trace: {},
    data: {}
  };
}
