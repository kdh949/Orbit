import { deriveKeywordOccurrences } from "@orbit/editor-core/keywords";
import type { Deck, Slide } from "@orbit/shared/deck";
import type { RehearsalEvaluationSnapshot } from "@orbit/shared/rehearsals";

import { createSlideshowAnimationPlan } from "../../runtime/presentation/slideshow/slideshowStepModel";
import type { ExtractedSentence } from "../../runtime/speech/tracking/speechTrackingEvents";
import type { PrompterProgressSnapshot } from "../../runtime/speech/tracking/prompterProgressTracker";
import { getPresenterTimingProgress } from "../presenter-shell/PresenterScaffold";
import { defaultRehearsalCommandConfig } from "./rehearsalCommands";
import { getKeywordOccurrenceTriggerIdsForSlide } from "../../runtime/presentation/playback/triggeredActionPlayback";
import {
  createRehearsalScriptPrompterRows,
  type RehearsalScriptPrompterRowStatus,
} from "../presenter-shell/panel/rehearsalScriptPrompter";
import { getRehearsalSlideBodyTexts } from "./rehearsalSlideText";

export type RehearsalPrompterRows = {
  current: string;
  focusSentenceId: string | null;
  items: RehearsalPrompterItem[];
  next: string;
  previous: string;
};

type RehearsalPrompterItem = {
  isFocusTarget: boolean;
  sentenceId: string;
  status: RehearsalScriptPrompterRowStatus;
  text: string;
};

export function resetRehearsalTimerState(actions: {
  setElapsedSeconds: (value: number) => void;
  setSlideElapsedSeconds: (value: number) => void;
  setIsTimerRunning: (value: boolean) => void;
}) {
  actions.setElapsedSeconds(0);
  actions.setSlideElapsedSeconds(0);
  actions.setIsTimerRunning(false);
}

export function shouldRenderRehearsalThumbnailImage(
  thumbnailUrl: string,
  failedThumbnailUrls: ReadonlySet<string>,
) {
  return Boolean(thumbnailUrl && !failedThumbnailUrls.has(thumbnailUrl));
}

export function getRehearsalPrompterRows(
  sentences: readonly ExtractedSentence[],
  coveredSentenceIds: readonly string[],
  fallbackNotes: string,
  prompterProgress?: PrompterProgressSnapshot,
): RehearsalPrompterRows {
  if (sentences.length === 0) {
    const fallback = fallbackNotes.trim() || "발표자 노트가 없습니다.";
    return {
      previous: "",
      current: fallback,
      focusSentenceId: "fallback",
      items: [
        {
          isFocusTarget: true,
          sentenceId: "fallback",
          status: "current",
          text: fallback,
        },
      ],
      next: "",
    };
  }

  const rows = createRehearsalScriptPrompterRows({
    sentences,
    coveredSentenceIds,
    prompterProgress,
  });
  const focusIndex = rows.findIndex((row) => row.isFocusTarget);
  let previous = "";
  for (let index = focusIndex - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.sentence.matchable) {
      previous = row.sentence.text;
      break;
    }
  }
  const current =
    rows.find((row) => row.status === "current")?.sentence.text ??
    rows.find((row) => row.isFocusTarget)?.sentence.text ??
    sentences[0]?.text ??
    "";
  const next = rows.find((row) => row.status === "next")?.sentence.text ?? "";

  return {
    previous,
    current,
    focusSentenceId:
      rows.find((row) => row.isFocusTarget)?.sentence.sentenceId ?? null,
    items: rows.map((row) => ({
      isFocusTarget: row.isFocusTarget,
      sentenceId: row.sentence.sentenceId,
      status: row.status,
      text: row.sentence.text,
    })),
    next,
  };
}

export function getHighlightedKeywordOccurrencesForSlide(slide: Slide | null) {
  if (!slide) {
    return undefined;
  }

  const targetOccurrenceIds = new Set([
    ...getKeywordOccurrenceTriggerIdsForSlide(slide),
    ...slide.keywords.flatMap((keyword) => keyword.requiredOccurrenceIds ?? []),
  ]);

  if (targetOccurrenceIds.size === 0) {
    return [];
  }

  return deriveKeywordOccurrences(slide).filter((occurrence) =>
    targetOccurrenceIds.has(occurrence.occurrenceId),
  );
}

export function buildP3SessionSlides(
  deck: Deck,
  evaluationSnapshot?: RehearsalEvaluationSnapshot,
) {
  const deckSlidesById = new Map(
    deck.slides.map((slide) => [slide.slideId, slide]),
  );
  const evaluationSlides = evaluationSnapshot?.slides ?? deck.slides;
  const pronunciationEntries =
    evaluationSnapshot?.pronunciationLexicon?.entries ?? [];

  return evaluationSlides.map((evaluationSlide) => {
    const slide = deckSlidesById.get(evaluationSlide.slideId);
    return {
      slideId: evaluationSlide.slideId,
      speakerNotes: slide?.speakerNotes ?? "",
      keywords: evaluationSlide.keywords ?? [],
      semanticCues: evaluationSlide.semanticCues ?? [],
      pronunciationEntries: pronunciationEntries.filter((entry) =>
        entry.scriptOccurrences.some(
          (occurrence) => occurrence.slideId === evaluationSlide.slideId,
        ),
      ),
      controlPhrases: defaultRehearsalCommandConfig.flatMap(
        (command) => command.phrases,
      ),
      legacyPhrases: [
        evaluationSlide.title,
        ...(slide ? getRehearsalSlideBodyTexts(slide) : []),
      ].filter(Boolean),
    };
  });
}

export function getRemainingTriggerStepsFromPlan(
  maxStepIndex: number,
  stepIndex: number,
) {
  return Math.max(0, maxStepIndex - stepIndex);
}

export function getRemainingTriggerStepsForSlide(options: {
  slide: Slide;
  stepIndex: number;
  triggerAnimationIds: Iterable<string>;
}) {
  const plan = createSlideshowAnimationPlan({
    slide: options.slide,
    triggerAnimationIds: options.triggerAnimationIds,
  });

  return getRemainingTriggerStepsFromPlan(plan.maxStepIndex, options.stepIndex);
}

export const getRehearsalTimingProgress = getPresenterTimingProgress;
