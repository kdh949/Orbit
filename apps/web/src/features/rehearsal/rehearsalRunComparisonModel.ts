import type { Deck } from "@orbit/shared/deck";
import type {
  RehearsalComparisonIssue,
  RehearsalRunComparison,
} from "@orbit/shared/rehearsals";

export type RehearsalRunComparisonItemViewModel = RehearsalComparisonIssue & {
  categoryLabel: string;
  href: string;
  slideLabel: string;
};

export type RehearsalRunComparisonGroupViewModel = {
  key: "repeated" | "new" | "improved" | "incomparable";
  label: string;
  description: string;
  items: RehearsalRunComparisonItemViewModel[];
};

export type RehearsalRunComparisonViewModel = {
  briefing: RehearsalRunComparisonItemViewModel[];
  contextLabel: string;
  groups: RehearsalRunComparisonGroupViewModel[];
  hasPreviousRun: boolean;
  silenceComparison: {
    currentLongSilenceCount: number;
    previousLongSilenceCount: number;
    longSilenceCountDelta: number;
    currentTotalSilenceSeconds: number;
    previousTotalSilenceSeconds: number;
    totalSilenceSecondsDelta: number;
  } | null;
};

export type ComparisonReminder = {
  key: string;
  label: string;
  reason: string;
  slideId: string;
};

export type ComparisonReminderState = {
  active: ComparisonReminder | null;
  seenKeys: string[];
};

const CATEGORY_LABELS: Record<RehearsalComparisonIssue["category"], string> = {
  "semantic-cue": "의미 전달",
  timing: "발표 시간",
  delivery: "전달 방식",
};

export function getSemanticOutcomeAnchor(cueId: string, revision: number) {
  return `semantic-outcome-${toAnchorSegment(cueId)}-${revision}`;
}

export function getSlideAnalysisAnchor(slideId: string) {
  return `slide-analysis-${toAnchorSegment(slideId)}`;
}

export function buildRehearsalRunComparisonViewModel(
  comparison: RehearsalRunComparison,
  deck: Deck | null,
  projectId: string,
): RehearsalRunComparisonViewModel {
  const toItem = (issue: RehearsalComparisonIssue) =>
    buildIssueViewModel(issue, comparison.currentRunId, deck, projectId);

  return {
    hasPreviousRun: comparison.previousRunId !== null,
    contextLabel:
      comparison.previousRunId === null
        ? "첫 비교 기준을 만들었어요"
        : "직전 완료 회차와 비교했어요",
    briefing: comparison.briefing.slice(0, 3).map(toItem),
    silenceComparison:
      comparison.silenceComparison.state === "comparable"
        ? {
            currentLongSilenceCount:
              comparison.silenceComparison.currentLongSilenceCount!,
            previousLongSilenceCount:
              comparison.silenceComparison.previousLongSilenceCount!,
            longSilenceCountDelta:
              comparison.silenceComparison.longSilenceCountDelta!,
            currentTotalSilenceSeconds:
              comparison.silenceComparison.currentTotalSilenceSeconds!,
            previousTotalSilenceSeconds:
              comparison.silenceComparison.previousTotalSilenceSeconds!,
            totalSilenceSecondsDelta:
              comparison.silenceComparison.totalSilenceSecondsDelta!,
          }
        : null,
    groups: [
      {
        key: "repeated",
        label: "반복된 이슈",
        description: "직전 회차에 이어 이번에도 확인된 핵심 이슈예요.",
        items: comparison.repeated.map(toItem),
      },
      {
        key: "new",
        label: "새 이슈",
        description: "이번 회차에서 새로 확인된 이슈예요.",
        items: comparison.newIssues.map(toItem),
      },
      {
        key: "improved",
        label: "개선됨",
        description: "직전 회차의 이슈를 이번 회차에서 개선했어요.",
        items: comparison.improved.map(toItem),
      },
      {
        key: "incomparable",
        label: "비교 제외",
        description:
          "기준 변경 또는 측정 제외로 직접 비교하지 않았으며 부정적인 결과로 계산하지 않아요.",
        items: comparison.incomparable.map(toItem),
      },
    ],
  };
}

export function createComparisonReminderState(): ComparisonReminderState {
  return { active: null, seenKeys: [] };
}

export function enterComparisonSlide(
  state: ComparisonReminderState,
  comparison: RehearsalRunComparison | null,
  slideId: string,
): ComparisonReminderState {
  if (!comparison) {
    return state.active ? { ...state, active: null } : state;
  }

  const issue = comparison.repeated.find(
    (candidate) =>
      candidate.category === "semantic-cue" &&
      candidate.severity === "high" &&
      candidate.slideId === slideId,
  );
  if (!issue) {
    return state.active ? { ...state, active: null } : state;
  }

  const key = buildReminderKey(comparison.currentRunId, issue);
  if (state.seenKeys.includes(key)) {
    return state.active ? { ...state, active: null } : state;
  }

  return {
    active: {
      key,
      label: issue.label,
      reason: issue.reason,
      slideId: issue.slideId,
    },
    seenKeys: [...state.seenKeys, key],
  };
}

export function dismissComparisonReminder(
  state: ComparisonReminderState,
): ComparisonReminderState {
  return state.active ? { ...state, active: null } : state;
}

function buildIssueViewModel(
  issue: RehearsalComparisonIssue,
  currentRunId: string,
  deck: Deck | null,
  projectId: string,
): RehearsalRunComparisonItemViewModel {
  const anchor =
    issue.category === "semantic-cue" && issue.cueId && issue.cueRevision
      ? getSemanticOutcomeAnchor(issue.cueId, issue.cueRevision)
      : getSlideAnalysisAnchor(issue.slideId);

  return {
    ...issue,
    categoryLabel: CATEGORY_LABELS[issue.category],
    href: `/rehearsal/${encodeURIComponent(projectId)}/report/${encodeURIComponent(
      currentRunId,
    )}#${anchor}`,
    slideLabel: getSlideLabel(deck, issue.slideId),
  };
}

function getSlideLabel(deck: Deck | null, slideId: string) {
  const slide = deck?.slides.find((candidate) => candidate.slideId === slideId);
  if (!slide) return slideId;
  const title = slide.title.trim();
  return title
    ? `슬라이드 ${slide.order} · ${title}`
    : `슬라이드 ${slide.order}`;
}

function buildReminderKey(
  currentRunId: string,
  issue: RehearsalComparisonIssue,
) {
  return [
    currentRunId,
    issue.slideId,
    issue.cueId ?? "none",
    issue.cueRevision ?? "none",
  ].join(":");
}

function toAnchorSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
