import { describe, expect, it } from "vitest";

import { createPrompterLexicalEvidenceAccumulator } from "./prompterLexicalEvidence";

describe("createPrompterLexicalEvidenceAccumulator", () => {
  it("현재 문장의 여러 partial 결과에서 lexical evidence를 누적한다", () => {
    const evidence = createAccumulator();

    const first = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "오르빗 리허설 화면을",
      sentenceProgressRatio: 0.4,
      atMs: 1_000
    });
    const second = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "발표 흐름과 함께 점검합니다",
      sentenceProgressRatio: 0.95,
      atMs: 1_200
    });

    expect(first.lexicalRecall).toBeCloseTo(3 / 7);
    expect(second).toMatchObject({
      lexicalRecall: 1,
      meaningfulTokenCount: 7,
      matchedMeaningfulTokenCount: 7,
      terminalAnchorMatched: true,
      sentenceProgressRatio: 0.95
    });
  });

  it("반복 partial은 script multiset 수를 넘어 과대계산하지 않는다", () => {
    const evidence = createPrompterLexicalEvidenceAccumulator({
      sentenceId: "sentence_1",
      text: "오르빗 리허설 리허설 화면"
    });

    evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "리허설 리허설 리허설 리허설",
      sentenceProgressRatio: 0.5,
      atMs: 1_000
    });
    const snapshot = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "리허설 리허설 리허설 리허설",
      sentenceProgressRatio: 0.5,
      atMs: 1_100
    });

    expect(snapshot.lexicalRecall).toBe(0.5);
    expect(snapshot.stableResultCount).toBe(2);
  });

  it("관련 없는 결과는 누적 evidence 시각과 안정 횟수를 갱신하지 않는다", () => {
    const evidence = createAccumulator();
    evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "오르빗 리허설 화면은 발표 흐름과 함께 점검합니다",
      sentenceProgressRatio: 1,
      atMs: 1_000
    });

    const unrelated = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "확인했습니다",
      sentenceProgressRatio: 0,
      atMs: 3_000
    });

    expect(unrelated).toMatchObject({
      lexicalRecall: 1,
      stableResultCount: 1,
      updatedAtMs: 1_000
    });
  });

  it("이미 반영된 token만 반복되면 evidence 시각을 갱신하지 않는다", () => {
    const evidence = createAccumulator();
    evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "오르빗 리허설 화면은 발표 흐름과 함께 점검합니다",
      sentenceProgressRatio: 1,
      atMs: 1_000
    });

    const repeated = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "오르빗",
      sentenceProgressRatio: 0,
      atMs: 3_000
    });

    expect(repeated).toMatchObject({
      lexicalRecall: 1,
      stableResultCount: 2,
      updatedAtMs: 1_000
    });
  });

  it("마지막 2~3개 meaningful token을 terminal anchor로 사용한다", () => {
    const evidence = createAccumulator();

    const middle = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "오르빗 리허설 화면 발표",
      sentenceProgressRatio: 0.7,
      atMs: 1_000
    });
    const terminal = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "흐름과 함께 점검합니다",
      sentenceProgressRatio: 0.9,
      atMs: 1_200
    });

    expect(middle.terminalAnchorMatched).toBe(false);
    expect(terminal).toMatchObject({
      terminalAnchorTokenCount: 3,
      terminalAnchorMatched: true
    });
  });

  it("조사 정규화를 기존 speech matcher와 동일하게 적용한다", () => {
    const evidence = createPrompterLexicalEvidenceAccumulator({
      sentenceId: "sentence_1",
      text: "오르빗 리허설 화면"
    });

    const snapshot = evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "오르빗으로 리허설을 화면에서",
      sentenceProgressRatio: 0.8,
      atMs: 1_000
    });

    expect(snapshot.lexicalRecall).toBe(1);
  });

  it("현재 문장이 아닌 결과는 무시하고 reset 시 evidence를 비운다", () => {
    const evidence = createAccumulator();

    const ignored = evidence.acceptResult({
      sentenceId: "sentence_2",
      transcriptText: "오르빗 리허설 화면 발표 흐름과 함께 점검합니다",
      sentenceProgressRatio: 1,
      atMs: 1_000
    });
    expect(ignored).toMatchObject({ lexicalRecall: 0, updatedAtMs: null });

    evidence.acceptResult({
      sentenceId: "sentence_1",
      transcriptText: "오르빗 리허설 화면",
      sentenceProgressRatio: 0.5,
      atMs: 1_100
    });
    const reset = evidence.reset({
      sentenceId: "sentence_2",
      text: "다음 문장을 설명합니다"
    });

    expect(reset).toEqual({
      sentenceId: "sentence_2",
      lexicalRecall: 0,
      meaningfulTokenCount: 3,
      matchedMeaningfulTokenCount: 0,
      terminalAnchorTokenCount: 3,
      terminalAnchorMatched: false,
      sentenceProgressRatio: 0,
      stableResultCount: 0,
      updatedAtMs: null
    });
    expect(reset).not.toHaveProperty("transcriptText");
    expect(reset).not.toHaveProperty("scriptText");
  });
});

function createAccumulator() {
  return createPrompterLexicalEvidenceAccumulator({
    sentenceId: "sentence_1",
    text: "오르빗 리허설 화면은 발표 흐름과 함께 점검합니다"
  });
}
