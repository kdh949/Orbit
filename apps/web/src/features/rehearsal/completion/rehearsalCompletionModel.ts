import type { Deck } from "@orbit/shared/deck";
import type { RehearsalRunMeta } from "@orbit/shared/rehearsals";

import type { SpeechTrackerSnapshot } from "../../../runtime/speech/tracking/speechTrackingEvents";
import { getDeckTargetSeconds as getRehearsalDeckTargetSeconds } from "../../presenter-shell/panel/rehearsalTiming";

const rehearsalPracticeSummaryStoragePrefix = "orbit.rehearsal.lastSummary";

export type RehearsalPracticeSummary = {
  completedAt: string;
  coveragePercent: number;
  deckId: string;
  durationSeconds: number;
  missedKeywordCount: number;
  projectId: string;
  targetSeconds: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readBrowserLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export type RehearsalCompletionSummary = {
  comparisonLabel: string;
  coverageLabel: string;
  coveragePercent: number;
  durationLabel: string;
  durationSeconds: number;
  hasSpeechTrackingData: boolean;
  missedKeywordRows: Array<{
    key: string;
    label: string;
    slideLabel: string;
  }>;
  missedKeywordCount: number;
  missedKeywordCountLabel: string;
  missedKeywordEmptyLabel: string;
  targetDeltaLabel: string;
  targetLabel: string;
  targetSeconds: number;
};

export function buildRehearsalCompletionSummary(options: {
  deck: Deck | null;
  elapsedSeconds: number;
  meta: RehearsalRunMeta | null;
  previousSummary: RehearsalPracticeSummary | null;
  snapshot: SpeechTrackerSnapshot;
  targetSeconds: number;
}): RehearsalCompletionSummary {
  const targetSeconds =
    options.targetSeconds > 0
      ? options.targetSeconds
      : getTargetDurationSeconds(options.deck);
  const elapsedSeconds =
    options.elapsedSeconds > 0 ? options.elapsedSeconds : targetSeconds;
  const missedKeywordRows = buildLocalMissedKeywordRows(
    options.deck,
    options.meta,
  );
  const hasSpeechTrackingData = Boolean(options.meta);
  const coveragePercent =
    hasSpeechTrackingData && options.snapshot.matchableSentenceCount > 0
      ? Math.round(options.snapshot.effectiveCoverage * 100)
      : hasSpeechTrackingData && missedKeywordRows.length > 0
        ? 0
        : hasSpeechTrackingData
          ? 100
          : 0;
  const missedKeywordCount = options.meta?.missedKeywords.length ?? 0;

  return {
    comparisonLabel: buildRehearsalComparisonLabel(
      elapsedSeconds,
      targetSeconds,
      options.previousSummary,
    ),
    coverageLabel: hasSpeechTrackingData
      ? `${clamp(coveragePercent, 0, 100)}%`
      : "측정 안 됨",
    coveragePercent: clamp(coveragePercent, 0, 100),
    durationLabel: formatClock(elapsedSeconds),
    durationSeconds: elapsedSeconds,
    hasSpeechTrackingData,
    missedKeywordRows,
    missedKeywordCount,
    missedKeywordCountLabel: hasSpeechTrackingData
      ? String(missedKeywordCount)
      : "-",
    missedKeywordEmptyLabel: hasSpeechTrackingData
      ? "놓친 핵심 항목이 없습니다."
      : "음성 추적 데이터가 없습니다.",
    targetDeltaLabel: formatTargetDeltaLabel(targetSeconds - elapsedSeconds),
    targetLabel: formatClock(targetSeconds),
    targetSeconds,
  };
}

function buildLocalMissedKeywordRows(
  deck: Deck | null,
  meta: RehearsalRunMeta | null,
): RehearsalCompletionSummary["missedKeywordRows"] {
  if (!deck || !meta) {
    return [];
  }

  const slidesById = new Map(
    deck.slides.map((slide) => [slide.slideId, slide]),
  );
  return meta.missedKeywords.slice(0, 2).map((missedKeyword) => {
    const slide = slidesById.get(missedKeyword.slideId);
    const keyword = slide?.keywords?.find(
      (candidate) => candidate.keywordId === missedKeyword.keywordId,
    );

    return {
      key: `${missedKeyword.slideId}-${missedKeyword.keywordId}`,
      label: keyword?.text ?? missedKeyword.keywordId,
      slideLabel: slide ? `슬라이드 ${slide.order}` : missedKeyword.slideId,
    };
  });
}

export function createRehearsalPracticeSummary(
  deck: Deck,
  summary: RehearsalCompletionSummary,
): RehearsalPracticeSummary {
  return {
    completedAt: new Date().toISOString(),
    coveragePercent: summary.coveragePercent,
    deckId: deck.deckId,
    durationSeconds: summary.durationSeconds,
    missedKeywordCount: summary.missedKeywordCount,
    projectId: deck.projectId,
    targetSeconds: summary.targetSeconds,
  };
}

export function buildRehearsalPreflightBanner(
  deck: Deck,
  previousSummary: RehearsalPracticeSummary | null,
) {
  const targetLabel = formatDuration(getTargetDurationSeconds(deck));
  if (!previousSummary) {
    return `이번 목표는 ${targetLabel}입니다. 슬라이드와 음성 트리거를 확인하고 시작하세요.`;
  }

  return `지난 리허설은 ${formatDuration(
    previousSummary.durationSeconds,
  )}였습니다. 이번엔 ${targetLabel} 목표로 가볼까요?`;
}

function buildRehearsalComparisonLabel(
  elapsedSeconds: number,
  targetSeconds: number,
  previousSummary: RehearsalPracticeSummary | null,
) {
  if (previousSummary) {
    const previousDelta = previousSummary.durationSeconds - elapsedSeconds;
    if (previousDelta > 0) {
      return `지난번보다 ${formatDuration(previousDelta)} 빨랐어요`;
    }
    if (previousDelta < 0) {
      return `지난번보다 ${formatDuration(Math.abs(previousDelta))} 늦었어요`;
    }
    return "지난번과 같은 시간이에요";
  }

  const targetDelta = targetSeconds - elapsedSeconds;
  if (targetDelta > 0) {
    return `목표보다 ${formatDuration(targetDelta)} 빨랐어요`;
  }
  if (targetDelta < 0) {
    return `목표보다 ${formatDuration(Math.abs(targetDelta))} 초과했어요`;
  }
  return "목표 시간에 맞췄어요";
}

export function readRehearsalPracticeSummary(
  projectId: string,
  deckId: string,
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
): RehearsalPracticeSummary | null {
  try {
    const raw = storage?.getItem(
      getRehearsalPracticeSummaryStorageKey(projectId, deckId),
    );
    if (!raw) {
      return null;
    }

    return parseRehearsalPracticeSummary(JSON.parse(raw), projectId, deckId);
  } catch {
    return null;
  }
}

export function writeRehearsalPracticeSummary(
  summary: RehearsalPracticeSummary,
  storage: Pick<Storage, "setItem"> | null = readBrowserLocalStorage(),
) {
  try {
    storage?.setItem(
      getRehearsalPracticeSummaryStorageKey(summary.projectId, summary.deckId),
      JSON.stringify(summary),
    );
  } catch {
    // Summary persistence is best-effort; the rehearsal flow must keep working.
  }
}

function getRehearsalPracticeSummaryStorageKey(
  projectId: string,
  deckId: string,
) {
  return `${rehearsalPracticeSummaryStoragePrefix}:${projectId}:${deckId}`;
}

function parseRehearsalPracticeSummary(
  value: unknown,
  projectId: string,
  deckId: string,
): RehearsalPracticeSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RehearsalPracticeSummary>;
  if (
    candidate.projectId !== projectId ||
    candidate.deckId !== deckId ||
    typeof candidate.completedAt !== "string" ||
    typeof candidate.durationSeconds !== "number" ||
    typeof candidate.targetSeconds !== "number" ||
    typeof candidate.coveragePercent !== "number" ||
    typeof candidate.missedKeywordCount !== "number"
  ) {
    return null;
  }

  return {
    completedAt: candidate.completedAt,
    coveragePercent: clamp(Math.round(candidate.coveragePercent), 0, 100),
    deckId,
    durationSeconds: Math.max(0, Math.round(candidate.durationSeconds)),
    missedKeywordCount: Math.max(0, Math.round(candidate.missedKeywordCount)),
    projectId,
    targetSeconds: Math.max(0, Math.round(candidate.targetSeconds)),
  };
}

function formatTargetDeltaLabel(deltaSeconds: number) {
  const absDelta = Math.abs(deltaSeconds);
  if (deltaSeconds >= 0) {
    return `${formatDuration(absDelta)} 여유`;
  }

  return `${formatDuration(absDelta)} 초과`;
}

export function getTargetDurationSeconds(deck: Deck | null) {
  return deck ? getRehearsalDeckTargetSeconds(deck) : 0;
}

export function formatDuration(totalSeconds: number) {
  const boundedSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(boundedSeconds / 60);
  const seconds = Math.floor(boundedSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}
