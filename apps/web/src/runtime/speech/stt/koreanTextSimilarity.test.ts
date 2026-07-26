import { describe, expect, it } from "vitest";

import {
  jamoEditSimilarity,
  normalizeKoreanBiasText,
  scoreBiasMatch,
} from "./koreanTextSimilarity";

describe("koreanTextSimilarity", () => {
  it("공통 live transcript 정규화 후 NFD 자모로 분해한다", () => {
    expect(normalizeKoreanBiasText(" 결재 승인 ")).toBe("결재승인");
    expect(normalizeKoreanBiasText("ORBIT Live STT")).toBe("orbitlivestt");
  });

  it("자모 편집거리 기반 유사도를 계산한다", () => {
    expect(jamoEditSimilarity("결재", "결제")).toBeGreaterThanOrEqual(
      0.75,
    );
    expect(jamoEditSimilarity("결재", "오르빗")).toBeLessThan(0.75);
    expect(jamoEditSimilarity("", "")).toBe(1);
    expect(jamoEditSimilarity("abc", "")).toBe(0);
  });

  it("정확 포함은 weight 전체 점수를 부여한다", () => {
    expect(
      scoreBiasMatch("이번 결재 승인 결과를 보겠습니다", [
        { text: "결재 승인", weight: 0.8 },
      ]),
    ).toBe(0.8);
  });

  it("공백 오류와 유사 발음 후보를 sliding window로 매칭한다", () => {
    expect(
      scoreBiasMatch("이번 결제승인 결과를 보겠습니다", [
        { text: "결재 승인", weight: 1 },
      ]),
    ).toBeGreaterThanOrEqual(0.75);
  });

  it("threshold 미만 후보와 weight 0 phrase는 점수에 반영하지 않는다", () => {
    expect(
      scoreBiasMatch("오르빗 발표를 시작합니다", [
        { text: "결재 승인", weight: 1 },
        { text: "오르빗", weight: 0 },
      ]),
    ).toBe(0);
  });

  it("여러 phrase 점수를 합산한다", () => {
    expect(
      scoreBiasMatch("오르빗 결재 승인", [
        { text: "오르빗", weight: 0.5 },
        { text: "결재 승인", weight: 0.8 },
      ]),
    ).toBe(1.3);
  });
});
