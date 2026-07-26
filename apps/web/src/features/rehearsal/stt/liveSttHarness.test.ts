import { describe, expect, it } from "vitest";
import { runLiveSttHarness, scoreLiveSttResults } from "./liveSttHarness";
import {
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "../../../runtime/speech/stt/liveSttPort";

describe("liveSttHarness", () => {
  it("phrase recall, keyword hit rate, latency를 계산한다", () => {
    expect(
      scoreLiveSttResults(
        {
          id: "ko-demo",
          expectedPhrases: ["오르빗 리허설", "자동 전환"],
          expectedKeywords: ["STT"]
        },
        [
          {
            text: "오르빗 리허설을 시작합니다",
            isFinal: false,
            timestampMs: [120, 120]
          },
          {
            text: "STT 자동 전환",
            isFinal: true,
            timestampMs: [450, 450]
          }
        ]
      )
    ).toEqual({
      scenarioId: "ko-demo",
      phraseRecall: 1,
      keywordHitRate: 1,
      firstPartialLatencyMs: 120,
      firstFinalLatencyMs: 450,
      resultCount: 2
    });
  });

  it("LiveSttPort factory와 drive 함수로 mock scenario를 실행한다", async () => {
    const port = new FakeHarnessPort();

    const metrics = await runLiveSttHarness({
      scenario: {
        id: "mock-ko",
        expectedPhrases: ["발표 화면"],
        expectedKeywords: ["오르빗"]
      },
      createPort: () => port,
      audioSource: { getTracks: () => [] } as unknown as MediaStream,
      drive: () => {
        port.emit({
          text: "오르빗 발표 화면",
          isFinal: true,
          timestampMs: [300, 300]
        });
      }
    });

    expect(metrics.phraseRecall).toBe(1);
    expect(metrics.keywordHitRate).toBe(1);
    expect(port.startedConfig?.biasPhrases).toEqual([
      { text: "발표 화면", weight: 1, source: "legacy" },
      { text: "오르빗", weight: 1, source: "keyword" }
    ]);
    expect(port.disposed).toBe(true);
  });
});

class FakeHarnessPort implements LiveSttPort {
  readonly engineId = "sherpa";
  readonly capabilities = {
    onDevice: true,
    streaming: true,
    keywordBiasing: true,
    languages: ["ko"]
  };
  readonly subscribers = new Set<(result: LiveSttResult) => void>();
  startedConfig: LiveSttSessionConfig | null = null;
  disposed = false;

  async start(config: LiveSttSessionConfig) {
    this.startedConfig = config;
  }

  async stop() {}

  updateBiasPhrases() {}

  onResult(cb: (result: LiveSttResult) => void): LiveSttUnsubscribe {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  onError(): LiveSttUnsubscribe {
    return () => undefined;
  }

  async dispose() {
    this.disposed = true;
  }

  emit(result: LiveSttResult) {
    for (const subscriber of this.subscribers) {
      subscriber(result);
    }
  }
}
