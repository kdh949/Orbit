import { describe, expect, it } from "vitest";

import { describePracticeQuality, formatPracticePace } from "./SlidePracticePanel";
import { countSpokenSyllables } from "./fillerAnalyzer";
import {
  createPracticeTranscriptState,
  finalizePracticeTranscript,
  getSlidePracticeErrorMessage,
  shouldUpdateVoiceBaseline,
  slidePracticeDisabledMessage,
  updatePracticeTranscript,
} from "./useSlidePracticeSession";

describe("slide practice transcript finalization", () => {
  it("final 없이 종료된 마지막 interim 전사를 분석 입력으로 보존한다", () => {
    const transcript = updatePracticeTranscript(createPracticeTranscriptState(), {
      isFinal: false,
      text: " 발표를 시작하겠습니다 ",
    });

    expect(finalizePracticeTranscript(transcript)).toBe("발표를 시작하겠습니다");
  });

  it("stop 중 final이 도착하면 같은 interim을 중복해서 합치지 않는다", () => {
    const interim = updatePracticeTranscript(createPracticeTranscriptState(), {
      isFinal: false,
      text: "발표를 시작하겠습니다",
    });
    const final = updatePracticeTranscript(interim, {
      isFinal: true,
      text: "발표를 시작하겠습니다",
    });

    expect(final.interim).toBe("");
    expect(finalizePracticeTranscript(final)).toBe("발표를 시작하겠습니다");
  });

  it("완료된 문장 뒤의 마지막 interim 문장을 함께 보존한다", () => {
    const first = updatePracticeTranscript(createPracticeTranscriptState(), {
      isFinal: true,
      text: "첫 번째 문장입니다",
    });
    const second = updatePracticeTranscript(first, {
      isFinal: false,
      text: "두 번째 문장입니다",
    });

    expect(finalizePracticeTranscript(second)).toBe("첫 번째 문장입니다 두 번째 문장입니다");
  });
});

describe("slide practice feature gate guidance", () => {
  it("서버의 비활성화 403 메시지를 사용자 안내로 바꾼다", () => {
    expect(
      getSlidePracticeErrorMessage(
        new Error("Slide practice is not enabled."),
        "연습 녹음을 완료하지 못했습니다.",
      ),
    ).toBe(slidePracticeDisabledMessage);
  });
});

describe("slide practice insufficient speech guidance", () => {
  it("전사가 비었을 때 0.0 대신 측정 안 됨을 표시한다", () => {
    expect(formatPracticePace(0, 0)).toBe("측정 안 됨");
  });

  it("최소 음절과 연습 시간 기준을 사용자 문장으로 설명한다", () => {
    const message = describePracticeQuality({
      durationMs: 2_500,
      reasons: ["insufficient-speech"],
      syllableCount: 4,
    });

    expect(countSpokenSyllables("음 어 그 로")).toBe(4);
    expect(message).toContain("전사된 음절이 4개입니다");
    expect(message).toContain("5음절 이상");
    expect(message).toContain("3초 이상");
    expect(message).not.toContain("insufficient-speech");
  });

  it("측정 불충분 결과는 개인 목소리 기준값에 합치지 않는다", () => {
    expect(shouldUpdateVoiceBaseline("unmeasured", 10_000)).toBe(false);
    expect(shouldUpdateVoiceBaseline("measured", 4_999)).toBe(false);
    expect(shouldUpdateVoiceBaseline("partial", 5_000)).toBe(true);
  });
});
