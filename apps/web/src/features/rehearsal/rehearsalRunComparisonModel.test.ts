import type {
  RehearsalComparisonIssue,
  RehearsalRunComparison,
} from "@orbit/shared/rehearsals";
import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it } from "vitest";
import {
  buildRehearsalRunComparisonViewModel,
  createComparisonReminderState,
  dismissComparisonReminder,
  enterComparisonSlide,
  getSemanticOutcomeAnchor,
} from "./rehearsalRunComparisonModel";

describe("buildRehearsalRunComparisonViewModel", () => {
  it("maps briefing and issue groups to current-run evidence links", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const semantic = issueFixture({ slideId: slide.slideId });
    const timing = issueFixture({
      category: "timing",
      cueId: undefined,
      cueRevision: undefined,
      label: "슬라이드 시간 초과",
      severity: "medium",
      slideId: slide.slideId,
    });
    const comparison = comparisonFixture({
      briefing: [semantic, timing],
      improved: [issueFixture({ label: "개선한 고객 가치" })],
      repeated: [semantic, timing],
      newIssues: [issueFixture({ cueId: "scue_new", label: "새 이슈" })],
      incomparable: [
        issueFixture({ cueId: "scue_changed", label: "비교하지 않은 Cue" }),
      ],
    });

    const model = buildRehearsalRunComparisonViewModel(
      comparison,
      deck,
      "project_1",
    );

    expect(model.hasPreviousRun).toBe(true);
    expect(model.briefing).toHaveLength(2);
    expect(model.briefing[0]).toMatchObject({
      categoryLabel: "의미 전달",
      href: `/rehearsal/project_1/report/run_current#${getSemanticOutcomeAnchor(
        semantic.cueId!,
        semantic.cueRevision!,
      )}`,
      slideLabel: expect.stringContaining("슬라이드 1"),
    });
    expect(model.briefing[1]?.href).toContain(
      `#slide-analysis-${slide.slideId}`,
    );
    expect(
      model.groups.map((group) => [group.key, group.items.length]),
    ).toEqual([
      ["repeated", 2],
      ["new", 1],
      ["improved", 1],
      ["incomparable", 1],
    ]);
    expect(model.groups[3]?.description).toContain(
      "부정적인 결과로 계산하지 않아요",
    );
  });

  it("keeps a first run understandable without inventing a previous comparison", () => {
    const model = buildRehearsalRunComparisonViewModel(
      comparisonFixture({ previousRunId: null }),
      null,
      "project_1",
    );

    expect(model.hasPreviousRun).toBe(false);
    expect(model.contextLabel).toBe("첫 비교 기준을 만들었어요");
  });
});

describe("comparison slide-entry reminder", () => {
  it("shows only a repeated high-severity issue once per rehearsal session", () => {
    const highRepeated = issueFixture({ slideId: "slide_1" });
    const comparison = comparisonFixture({
      repeated: [
        highRepeated,
        issueFixture({
          cueId: "scue_medium",
          severity: "medium",
          slideId: "slide_2",
        }),
      ],
      newIssues: [issueFixture({ cueId: "scue_new", slideId: "slide_3" })],
    });

    const entered = enterComparisonSlide(
      createComparisonReminderState(),
      comparison,
      "slide_1",
    );
    expect(entered.active).toMatchObject({
      label: highRepeated.label,
      slideId: "slide_1",
    });

    const dismissed = dismissComparisonReminder(entered);
    expect(dismissed.active).toBeNull();
    expect(
      enterComparisonSlide(dismissed, comparison, "slide_1").active,
    ).toBeNull();
    expect(
      enterComparisonSlide(dismissed, comparison, "slide_2").active,
    ).toBeNull();
    expect(
      enterComparisonSlide(dismissed, comparison, "slide_3").active,
    ).toBeNull();
  });
});

function issueFixture(
  patch: Partial<RehearsalComparisonIssue> = {},
): RehearsalComparisonIssue {
  return {
    category: "semantic-cue",
    slideId: "slide_1",
    cueId: "scue_repeated",
    cueRevision: 2,
    label: "고객 가치",
    severity: "high",
    reason: "두 회차 연속 핵심 의미를 충분히 전달하지 못했습니다.",
    ...patch,
  };
}

function comparisonFixture(
  patch: Partial<RehearsalRunComparison> = {},
): RehearsalRunComparison {
  return {
    currentRunId: "run_current",
    previousRunId: "run_previous",
    silenceComparison: {
      state: "unavailable",
      metricDefinitionVersion: null,
      currentLongSilenceCount: null,
      previousLongSilenceCount: null,
      longSilenceCountDelta: null,
      currentTotalSilenceSeconds: null,
      previousTotalSilenceSeconds: null,
      totalSilenceSecondsDelta: null,
      reasonCode: "LEGACY_COMPARISON",
    },
    improved: [],
    repeated: [],
    newIssues: [],
    incomparable: [],
    briefing: [],
    ...patch,
  };
}
