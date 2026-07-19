import { describe, expect, it } from "vitest";
import { buildRehearsalTimingAssessment } from "./rehearsalReportTimingAssessment";

const formatDuration = (seconds: number) => `${seconds}초`;

describe("buildRehearsalTimingAssessment", () => {
  it("권장 시간 대비 차이가 20% 이내이면 적절로 판정한다", () => {
    expect(buildRehearsalTimingAssessment(79, 84, formatDuration)).toEqual({
      label: "적절",
      tone: "success",
    });
    expect(buildRehearsalTimingAssessment(80, 100, formatDuration)).toEqual({
      label: "적절",
      tone: "success",
    });
  });

  it("20% 범위를 벗어나면 권장 시간과의 차이를 안내한다", () => {
    expect(buildRehearsalTimingAssessment(79, 100, formatDuration)).toEqual({
      label: "권장보다 21초 짧음",
      tone: "warning",
    });
    expect(buildRehearsalTimingAssessment(121, 100, formatDuration)).toEqual({
      label: "권장보다 21초 김",
      tone: "warning",
    });
  });

  it("판정할 시간 정보가 없으면 확인 불가 상태를 반환한다", () => {
    expect(buildRehearsalTimingAssessment(null, 100, formatDuration)).toEqual({
      label: "시간 정보 없음",
      tone: "muted",
    });
    expect(buildRehearsalTimingAssessment(10, 0, formatDuration)).toEqual({
      label: "시간 정보 없음",
      tone: "muted",
    });
  });
});
