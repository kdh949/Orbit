import { describe, expect, it } from "vitest";

import {
  getRehearsalTeleprompterCenterPadding,
  getRehearsalTeleprompterWheelDirection,
  normalizeRehearsalTeleprompterWheelDelta
} from "./RehearsalScriptTeleprompter";

describe("RehearsalScriptTeleprompter focus alignment", () => {
  it("keeps enough scroll space to center the first and last sentence", () => {
    expect(getRehearsalTeleprompterCenterPadding(600, 80)).toBe(260);
    expect(getRehearsalTeleprompterCenterPadding(40, 80)).toBe(24);
  });
});

describe("RehearsalScriptTeleprompter wheel navigation", () => {
  it("작은 트랙패드 입력은 누적 임계값 전까지 문장을 이동하지 않는다", () => {
    expect(getRehearsalTeleprompterWheelDirection(23)).toBeNull();
    expect(getRehearsalTeleprompterWheelDirection(-23)).toBeNull();
  });

  it("아래 휠은 다음 문장, 위 휠은 이전 문장으로 해석한다", () => {
    expect(getRehearsalTeleprompterWheelDirection(24)).toBe("next");
    expect(getRehearsalTeleprompterWheelDirection(-24)).toBe("previous");
  });

  it("브라우저의 줄·페이지 단위 휠 값을 픽셀 기준으로 정규화한다", () => {
    expect(normalizeRehearsalTeleprompterWheelDelta(2, 0)).toBe(2);
    expect(normalizeRehearsalTeleprompterWheelDelta(2, 1)).toBe(32);
    expect(normalizeRehearsalTeleprompterWheelDelta(1, 2)).toBe(120);
  });
});
