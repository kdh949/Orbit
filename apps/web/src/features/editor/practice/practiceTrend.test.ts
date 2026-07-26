import type { SlidePracticeReportRecord } from "@orbit/shared/slide-practice";
import { describe, expect, it } from "vitest";

import {
  buildPracticeTrendSeries,
  comparablePracticeReports,
  type PracticeTrendMetric,
} from "./practiceTrend";

const currentHash = "a".repeat(64);
type PracticeReportV3Record = Extract<SlidePracticeReportRecord, { reportVersion: 3 }>;
type LegacyPracticeReportRecord = Exclude<SlidePracticeReportRecord, { reportVersion: 3 }>;

describe("practice trend model", () => {
  it("turns latest-first history into the five-point QA fixture chronologically", () => {
    const fixture = [
      report(5, { fillerCount: 0, activeSpeechMs: 200_000 }),
      report(4, { fillerCount: 3, activeSpeechMs: 200_000 }),
      report(3, { fillerCount: 6, activeSpeechMs: 189_474 }),
      report(2, { fillerCount: 9, activeSpeechMs: 200_000 }),
      report(1, { fillerCount: 10, activeSpeechMs: 193_548 }),
    ];

    const series = buildPracticeTrendSeries({
      reports: fixture,
      slideContentHash: currentHash,
      metric: "fillerRate",
    });

    expect(series.points.map((point) => point.value?.toFixed(1))).toEqual([
      "3.1", "2.7", "1.9", "0.9", "0.0",
    ]);
    expect(series.points.map((point) => point.dateLabel)).toEqual([
      "1회차 (7/13)", "2회차 (7/15)", "3회차 (7/17)", "4회차 (7/19)", "5회차 (7/21)",
    ]);
    expect(series.mode).toBe("trend");
    expect(series.direction).toBe("improved");
  });

  it("excludes legacy, other hash, and other metric definition records", () => {
    const reports: SlidePracticeReportRecord[] = [
      report(5),
      { ...report(4), slideContentHash: "b".repeat(64) },
      legacyReport(3),
      legacyReport(2),
    ];

    expect(comparablePracticeReports(reports, currentHash).map((item) => item.reportId))
      .toEqual(["report-5"]);
  });

  it("keeps unmeasured values as gaps while preserving a measured zero", () => {
    const series = buildPracticeTrendSeries({
      reports: [
        report(3, { fillerCount: 0 }),
        report(2, { qualityState: "unmeasured", fillerCount: 0 }),
        report(1, { fillerCount: 2 }),
      ],
      slideContentHash: currentHash,
      metric: "fillerRate",
    });

    expect(series.points.map((point) => point.value)).toEqual([2, null, 0]);
    expect(series.segments).toEqual([]);
  });

  it("treats less than five seconds of active speech as an unmeasured filler rate", () => {
    const series = buildPracticeTrendSeries({
      reports: [report(1, { activeSpeechMs: 4_999, fillerCount: 0 })],
      slideContentHash: currentHash,
      metric: "fillerRate",
    });
    expect(series.points[0]?.value).toBeNull();
    expect(series.direction).toBe("unavailable");
  });

  it.each([
    ["pace", [3.1, 3.6], "improved"],
    ["loudness", [-50, -40], "improved"],
    ["pauseRatio", [0.05, 0.2], "improved"],
    ["pace", [4.2, 5.2], "declined"],
  ] as const)("uses target-range distance for %s", (metric, values, expected) => {
    const series = buildPracticeTrendSeries({
      reports: [metricReport(2, metric, values[1]), metricReport(1, metric, values[0])],
      slideContentHash: currentHash,
      metric,
    });
    expect(series.mode).toBe("comparison");
    expect(series.direction).toBe(expected);
  });

  it("uses current, comparison, and trend modes for one, two, and three records", () => {
    expect(seriesFor(1).mode).toBe("current");
    expect(seriesFor(2).mode).toBe("comparison");
    expect(seriesFor(3).mode).toBe("trend");
  });
});

function seriesFor(count: number) {
  return buildPracticeTrendSeries({
    reports: Array.from({ length: count }, (_, index) => report(count - index)),
    slideContentHash: currentHash,
    metric: "pace",
  });
}

function metricReport(index: number, metric: PracticeTrendMetric, value: number) {
  const base = report(index);
  if (metric === "pace") return { ...base, voice: { ...base.voice, syllablesPerSecond: value } };
  if (metric === "loudness") return { ...base, voice: { ...base.voice, loudnessDb: value } };
  return { ...base, voice: { ...base.voice, pauseRatio: value } };
}

function report(
  index: number,
  options: {
    activeSpeechMs?: number;
    fillerCount?: number;
    qualityState?: "measured" | "unmeasured";
  } = {},
): PracticeReportV3Record {
  const activeSpeechMs = options.activeSpeechMs ?? 60_000;
  const fillerCount = options.fillerCount ?? index;
  return {
    reportVersion: 3,
    metricDefinitionVersion: 3,
    contentHashVersion: "slide-text-v1",
    slideContentHash: currentHash,
    classifierVersion: 4,
    reportId: `report-${index}`,
    createdBy: "user-1",
    createdAt: `2026-07-${String(11 + index * 2).padStart(2, "0")}T12:00:00.000Z`,
    expiresAt: "2026-10-19T12:00:00.000Z",
    practiceSessionId: `practice-${index}`,
    projectId: "project-1",
    deckId: "deck-1",
    deckVersion: index,
    slideId: "slide-1",
    slideOrder: 1,
    startedAt: `2026-07-${String(11 + index * 2).padStart(2, "0")}T11:59:00.000Z`,
    durationMs: 240_000,
    syllableCount: 100,
    meanRecognitionConfidence: 0.9,
    fillers: {
      policyVersion: 1,
      totalCount: fillerCount,
      details: fillerCount === 0 ? [] : [{ word: "음", count: fillerCount }],
    },
    voice: {
      activeSpeechMs,
      pauseRatio: 0.2,
      pitchMedianHz: 170,
      pitchSpanHz: 80,
      pitchValidRatio: 0.8,
      loudnessDb: -36,
      loudnessMadDb: 2.4,
      syllablesPerSecond: 4.2,
      signalToNoiseDb: 20,
      breathinessRatio: 0.2,
      clarityRatio: 0.8,
      rhythmRegularity: 0.7,
      clippingRatio: 0,
    },
    style: { mode: "neutral", confidence: 0, evidenceLabels: ["판단 보류"], message: "판단을 보류했습니다." },
    quality: options.qualityState === "unmeasured"
      ? { state: "unmeasured", reasons: ["insufficient-speech"] }
      : { state: "measured", reasons: [] },
    source: { kind: "server", sttEngine: "report-stt", deviceIdHash: null, baselineVersion: null },
  };
}

function legacyReport(index: number): LegacyPracticeReportRecord {
  const current = report(index);
  const { contentHashVersion: _contentHashVersion, slideContentHash: _slideContentHash, ...body } = current;
  return { ...body, reportVersion: 2, metricDefinitionVersion: 2 };
}
