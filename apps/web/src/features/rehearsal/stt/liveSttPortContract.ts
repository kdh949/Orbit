import { describe, expect, it } from "vitest";
import {
  LiveSttError,
  type LiveSttBiasPhrase,
  type LiveSttPort,
  type LiveSttResult
} from "../../../runtime/speech/stt/liveSttPort";

type ContractHarness = {
  port: LiveSttPort;
  audioSource: MediaStream;
  emitResult: (result: { text: string; isFinal?: boolean; confidence?: number }) => void;
  emitError: (error: LiveSttError) => void;
  readBiasPhrases: () => LiveSttBiasPhrase[];
  expectedBiasPhrasesAfterUpdate?: LiveSttBiasPhrase[];
};

export function runLiveSttPortContractTests(
  name: string,
  createHarness: () => ContractHarness
) {
  describe(`${name} LiveSttPort contract`, () => {
    it("시작 후 partial/final 결과를 session-relative timestamp로 전달한다", async () => {
      const harness = createHarness();
      const results: LiveSttResult[] = [];

      harness.port.onResult((result) => results.push(result));
      await harness.port.start({
        language: "ko",
        audioSource: harness.audioSource,
        biasPhrases: [{ text: "오르빗", weight: 1, source: "keyword" }]
      });
      harness.emitResult({ text: "오르빗 리허설", isFinal: false, confidence: 0.8 });
      harness.emitResult({ text: "오르빗 리허설 완료", isFinal: true, confidence: 0.9 });

      expect(results).toEqual([
        {
          text: "오르빗 리허설",
          isFinal: false,
          timestampMs: [0, 0],
          confidence: 0.8
        },
        {
          text: "오르빗 리허설 완료",
          isFinal: true,
          timestampMs: [0, 0],
          confidence: 0.9
        }
      ]);
    });

    it("bias phrase를 세션 중 갱신할 수 있다", async () => {
      const harness = createHarness();

      await harness.port.start({
        language: "ko",
        audioSource: harness.audioSource,
        biasPhrases: [{ text: "첫 번째", weight: 1, source: "keyword" }]
      });
      harness.port.updateBiasPhrases([
        {
          text: "두 번째",
          weight: 0.4,
          source: "keyword",
          keywordId: "kw_second",
          canonicalText: "두 번째"
        },
        {
          text: "두 번째",
          weight: 0.8,
          source: "synonym",
          keywordId: "kw_second",
          canonicalText: "둘째"
        },
        { text: "  세 번째  ", weight: 1 }
      ]);

      expect(harness.readBiasPhrases()).toEqual(
        harness.expectedBiasPhrasesAfterUpdate ?? [
          {
            text: "두 번째",
            weight: 0.8,
            source: "synonym",
            keywordId: "kw_second",
            canonicalText: "둘째"
          },
          { text: "세 번째", weight: 1 }
        ]
      );
    });

    it("unsubscribe와 stop 이후 stale result를 무시한다", async () => {
      const harness = createHarness();
      const results: LiveSttResult[] = [];
      const unsubscribe = harness.port.onResult((result) => results.push(result));

      await harness.port.start({
        language: "ko",
        audioSource: harness.audioSource
      });
      unsubscribe();
      harness.emitResult({ text: "구독 해제 후 결과", isFinal: false });
      await harness.port.stop();
      harness.emitResult({ text: "정지 후 결과", isFinal: true });

      expect(results).toEqual([]);
    });

    it("typed error를 구독자에게 전달하고 unsubscribe를 존중한다", async () => {
      const harness = createHarness();
      const errors: LiveSttError[] = [];
      const unsubscribe = harness.port.onError((error) => errors.push(error));

      await harness.port.start({
        language: "ko",
        audioSource: harness.audioSource
      });
      harness.emitError(new LiveSttError("runtime_error", "테스트 오류"));
      unsubscribe();
      harness.emitError(new LiveSttError("runtime_error", "무시할 오류"));

      expect(errors.map((error) => error.message)).toEqual(["테스트 오류"]);
    });
  });
}
