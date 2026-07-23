import { describe, expect, it, vi } from "vitest";

import { OrbitDiagnosticRecorder } from "../../diagnostics/diagnosticRecorder";
import { DiagnosticLiveSttPort } from "./diagnosticLiveSttPort";
import {
  LiveSttError,
  type LiveSttPort,
  type LiveSttResult
} from "./liveSttPort";

describe("DiagnosticLiveSttPort", () => {
  it("records one normalized result and named subscriber deliveries", async () => {
    const inner = new FakeLiveSttPort();
    const recorder = new OrbitDiagnosticRecorder({
      createId: () => "session_stt"
    });
    recorder.start({ mode: "full", surface: "presentation" });
    const port = new DiagnosticLiveSttPort(inner, recorder);
    const delivered: LiveSttResult[] = [];
    port.onResult((result) => delivered.push(result), {
      subscriberId: "presentation-animation"
    });

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream(),
      biasPhrases: [{ text: "오르빗", weight: 1 }]
    });
    inner.emitResult({
      text: "오르빗",
      isFinal: true,
      timestampMs: [10, 10],
      utteranceId: "item_1:0",
      resultRevision: 2
    });

    const events = recorder.snapshot().recentEvents;
    expect(
      events.filter((event) => event.name === "stt.result.normalized")
    ).toHaveLength(1);
    expect(
      events.find(
        (event) => event.name === "stt.subscriber.delivery_succeeded"
      )
    ).toMatchObject({
      trace: { triggerTraceId: "speech:item_1:0:2" },
      data: { subscriberId: "presentation-animation" }
    });
    expect(delivered[0]?.diagnosticTrace).toMatchObject({
      speechSequence: 1,
      triggerTraceId: "speech:item_1:0:2"
    });
  });

  it("isolates and identifies a throwing subscriber", () => {
    const inner = new FakeLiveSttPort();
    const recorder = new OrbitDiagnosticRecorder({
      createId: () => "session_subscriber"
    });
    recorder.start({ mode: "full", surface: "rehearsal" });
    const port = new DiagnosticLiveSttPort(inner, recorder);
    const secondSubscriber = vi.fn();
    port.onResult(
      () => {
        throw new Error("consumer failed");
      },
      { subscriberId: "rehearsal-animation" }
    );
    port.onResult(secondSubscriber, {
      subscriberId: "rehearsal-prompter"
    });

    inner.emitResult({
      text: "민감한 원문",
      isFinal: true,
      timestampMs: [0, 0]
    });

    expect(secondSubscriber).toHaveBeenCalledOnce();
    expect(
      recorder
        .snapshot()
        .recentEvents.find(
          (event) => event.name === "stt.subscriber.delivery_failed"
        )
    ).toMatchObject({
      reason: "SUBSCRIBER_THROW",
      data: {
        subscriberId: "rehearsal-animation",
        errorName: "Error"
      }
    });
  });
});

class FakeLiveSttPort implements LiveSttPort {
  readonly engineId = "web-speech";
  readonly capabilities = {
    onDevice: true,
    streaming: true,
    keywordBiasing: true,
    languages: ["ko"]
  };
  private readonly resultSubscribers = new Set<
    (result: LiveSttResult) => void
  >();
  private readonly errorSubscribers = new Set<(error: LiveSttError) => void>();

  async start() {}
  async stop() {}
  updateBiasPhrases() {}
  dispose() {}

  onResult(cb: (result: LiveSttResult) => void) {
    this.resultSubscribers.add(cb);
    return () => this.resultSubscribers.delete(cb);
  }

  onError(cb: (error: LiveSttError) => void) {
    this.errorSubscribers.add(cb);
    return () => this.errorSubscribers.delete(cb);
  }

  emitResult(result: LiveSttResult) {
    for (const subscriber of this.resultSubscribers) {
      subscriber(result);
    }
  }
}

function fakeMediaStream() {
  return {} as MediaStream;
}
