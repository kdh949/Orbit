import { describe, expect, it, vi } from "vitest";

import { runLiveSttPortContractTests } from "./liveSttPortContract";
import {
  LiveSttError,
  type LiveSttBiasPhrase,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "../../../runtime/speech/stt/liveSttPort";
import { RerankingLiveSttPort } from "./rerankingLiveSttPort";

runLiveSttPortContractTests("Reranking", () => {
  const inner = new FakeInnerPort();
  const port = new RerankingLiveSttPort(inner);

  return {
    port,
    audioSource: fakeMediaStream(),
    emitResult: (result) => inner.emitResult(toLiveSttResult(result)),
    emitError: (error) => inner.emitError(error),
    readBiasPhrases: () => inner.biasPhrases
  };
});

describe("RerankingLiveSttPort", () => {
  it("final alternatives를 bias phrase로 재순위하고 alternatives를 제거한다", async () => {
    const inner = new FakeInnerPort();
    const port = new RerankingLiveSttPort(inner);
    const results: LiveSttResult[] = [];
    port.onResult((result) => results.push(result));

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream(),
      biasPhrases: [{ text: "결제 승인", weight: 1 }]
    });
    inner.emitResult({
      text: "이번 결재 승인 결과",
      isFinal: true,
      timestampMs: [0, 0],
      confidence: 0.9,
      alternatives: [
        { text: "이번 결재 승인 결과", confidence: 0.9 },
        { text: "이번 결제 승인 결과", confidence: 0.6 }
      ]
    });

    expect(results).toEqual([
      {
        text: "이번 결제 승인 결과",
        isFinal: true,
        timestampMs: [0, 0],
        confidence: 0.6
      }
    ]);
  });

  it("interim result와 alternatives 없는 result는 원형을 유지하되 alternatives는 숨긴다", async () => {
    const inner = new FakeInnerPort();
    const port = new RerankingLiveSttPort(inner);
    const results: LiveSttResult[] = [];
    port.onResult((result) => results.push(result));

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream(),
      biasPhrases: [{ text: "결제 승인", weight: 1 }]
    });
    inner.emitResult({
      text: "중간 결재",
      isFinal: false,
      timestampMs: [0, 0],
      alternatives: [
        { text: "중간 결재", confidence: 0.5 },
        { text: "중간 결제", confidence: 0.4 }
      ]
    });
    inner.emitResult({
      text: "마지막 결과",
      isFinal: true,
      timestampMs: [1, 1]
    });

    expect(results).toEqual([
      {
        text: "중간 결재",
        isFinal: false,
        timestampMs: [0, 0]
      },
      {
        text: "마지막 결과",
        isFinal: true,
        timestampMs: [1, 1]
      }
    ]);
  });

  it("updateBiasPhrases와 stop, dispose를 내부 포트에 위임한다", async () => {
    const inner = new FakeInnerPort();
    const port = new RerankingLiveSttPort(inner);

    port.updateBiasPhrases([{ text: "오르빗", weight: 1 }]);
    await port.stop();
    port.dispose();

    expect(inner.biasPhrases).toEqual([{ text: "오르빗", weight: 1 }]);
    expect(inner.stop).toHaveBeenCalled();
    expect(inner.dispose).toHaveBeenCalled();
  });
});

class FakeInnerPort implements LiveSttPort {
  readonly engineId = "web-speech";
  readonly capabilities = {
    onDevice: true,
    streaming: true,
    keywordBiasing: true,
    languages: ["ko"]
  };
  readonly resultSubscribers = new Set<(result: LiveSttResult) => void>();
  readonly errorSubscribers = new Set<(error: LiveSttError) => void>();
  biasPhrases: LiveSttBiasPhrase[] = [];
  startConfig: LiveSttSessionConfig | null = null;
  stop = vi.fn(async () => undefined);
  dispose = vi.fn();

  async start(config: LiveSttSessionConfig) {
    this.startConfig = config;
    this.biasPhrases = [...(config.biasPhrases ?? [])];
  }

  updateBiasPhrases(phrases: readonly LiveSttBiasPhrase[]) {
    this.biasPhrases = [...phrases];
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

  emitResult(result: LiveSttResult) {
    for (const subscriber of this.resultSubscribers) {
      subscriber(result);
    }
  }

  emitError(error: LiveSttError) {
    for (const subscriber of this.errorSubscribers) {
      subscriber(error);
    }
  }
}

function toLiveSttResult(result: {
  text: string;
  isFinal?: boolean;
  confidence?: number;
}): LiveSttResult {
  return {
    text: result.text,
    isFinal: result.isFinal ?? false,
    timestampMs: [0, 0],
    ...(typeof result.confidence === "number"
      ? { confidence: result.confidence }
      : {})
  };
}

function fakeMediaStream() {
  return { getTracks: () => [] } as unknown as MediaStream;
}
