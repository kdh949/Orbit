import type { DeckSlideAction, Slide } from "@orbit/shared";

import type { SlideshowAnimationPlan } from "../presenter/slideshowStepModel";
import { normalizeSpeechText } from "./phraseExtractor";

export type ExpectedKeywordOccurrenceStep = {
  animationIds: string[];
  occurrenceIds: string[];
  stepIndex: number;
};

export type ExpectedKeywordOccurrenceMatch = {
  keywordId: string;
  occurrenceId: string;
  text: string;
};

export type ExpectedKeywordOccurrenceResolution = {
  blocker:
    | "already-consumed"
    | "ambiguous"
    | "confidence-low"
    | "evidence-pending"
    | "no-current-keyword-step"
    | "no-keyword-hit"
    | null;
  candidates: ExpectedKeywordOccurrenceMatch[];
  expectedStep: ExpectedKeywordOccurrenceStep | null;
  matches: ExpectedKeywordOccurrenceMatch[];
};

type KeywordOccurrenceTermHit = ExpectedKeywordOccurrenceMatch & {
  end: number;
  start: number;
};

export function getExpectedKeywordOccurrenceStep(args: {
  presenterStepIndex: number;
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
}): ExpectedKeywordOccurrenceStep | null {
  const terminalStepIndex =
    args.slideAnimationPlan.maxStepIndex ??
    args.slideAnimationPlan.triggerSteps.length;
  const timelineStep = args.slideAnimationPlan.triggerSteps[args.presenterStepIndex];
  const isTerminalStep =
    !timelineStep &&
    args.presenterStepIndex >= terminalStepIndex;
  const animationIds = new Set(
    timelineStep?.animations.map((animation) => animation.animationId) ?? []
  );
  const occurrenceIds = Array.from(
    new Set(
      args.slide.actions.flatMap((action) =>
        action.trigger.kind === "keyword-occurrence" &&
        ((action.effect.kind === "play-animation" &&
          animationIds.has(action.effect.animationId)) ||
          (isTerminalStep && action.effect.kind === "go-to-next-slide"))
          ? [action.trigger.occurrenceId]
          : []
      )
    )
  );
  return occurrenceIds.length > 0
    ? {
        animationIds: [...animationIds],
        occurrenceIds,
        stepIndex: args.presenterStepIndex
      }
    : null;
}

export function matchExpectedKeywordOccurrenceStep(args: {
  allowedOccurrenceIds?: readonly string[];
  confidence?: number | null;
  consumedOccurrenceIds: readonly string[];
  expectedStep: ExpectedKeywordOccurrenceStep | null;
  newSegment: string;
  slide: Slide;
}): ExpectedKeywordOccurrenceResolution {
  if (!args.expectedStep) {
    return {
      blocker: "no-current-keyword-step",
      candidates: [],
      expectedStep: null,
      matches: []
    };
  }
  if (
    args.expectedStep.occurrenceIds.some((occurrenceId) =>
      args.consumedOccurrenceIds.includes(occurrenceId)
    )
  ) {
    return {
      blocker: "already-consumed",
      candidates: [],
      expectedStep: args.expectedStep,
      matches: []
    };
  }
  const distinctMatches = findExpectedStepTermHits({
    allowedOccurrenceIds: args.allowedOccurrenceIds,
    expectedStep: args.expectedStep,
    segment: normalizeSpeechText(args.newSegment),
    slide: args.slide,
    startAt: 0
  });
  if (distinctMatches.length === 0) {
    return {
      blocker: "no-keyword-hit",
      candidates: [],
      expectedStep: args.expectedStep,
      matches: []
    };
  }
  if (distinctMatches.length > 1) {
    return {
      blocker: "ambiguous",
      candidates: distinctMatches,
      expectedStep: args.expectedStep,
      matches: []
    };
  }
  if ((args.confidence ?? 1) < 0.7) {
    return {
      blocker: "confidence-low",
      candidates: distinctMatches,
      expectedStep: args.expectedStep,
      matches: []
    };
  }
  return {
    blocker: null,
    candidates: distinctMatches,
    expectedStep: args.expectedStep,
    matches: distinctMatches
  };
}

export function findFutureKeywordOccurrenceMatches(args: {
  allowedOccurrenceIds?: readonly string[];
  confidence?: number | null;
  consumedOccurrenceIds: readonly string[];
  newSegment: string;
  presenterStepIndex: number;
  slide: Slide;
  slideAnimationPlan: SlideshowAnimationPlan;
}): ExpectedKeywordOccurrenceMatch[] {
  if ((args.confidence ?? 1) < 0.7) return [];
  const segment = normalizeSpeechText(args.newSegment);
  let cursor = 0;
  const currentStep = getExpectedKeywordOccurrenceStep({
    presenterStepIndex: args.presenterStepIndex,
    slide: args.slide,
    slideAnimationPlan: args.slideAnimationPlan
  });
  const currentHits = findExpectedStepTermHits({
    allowedOccurrenceIds: args.allowedOccurrenceIds,
    expectedStep: currentStep,
    segment,
    slide: args.slide,
    startAt: cursor
  });
  // The current step can only contribute one occurrence to automatic playback.
  // Advancing the scan cursor prevents a later pending step from claiming a
  // keyword that appeared before the current trigger in the same STT result.
  if (currentHits.length === 1) {
    cursor = currentHits[0].end;
  }
  const matches: ExpectedKeywordOccurrenceMatch[] = [];
  const terminalStepIndex =
    args.slideAnimationPlan.maxStepIndex ??
    args.slideAnimationPlan.triggerSteps.length;
  for (
    let stepIndex = args.presenterStepIndex + 1;
    stepIndex <= terminalStepIndex;
    stepIndex += 1
  ) {
    const expectedStep = getExpectedKeywordOccurrenceStep({
      presenterStepIndex: stepIndex,
      slide: args.slide,
      slideAnimationPlan: args.slideAnimationPlan
    });
    if (
      !expectedStep ||
      expectedStep.occurrenceIds.some((occurrenceId) =>
        args.consumedOccurrenceIds.includes(occurrenceId)
      )
    ) {
      continue;
    }
    const hits = findExpectedStepTermHits({
      allowedOccurrenceIds: args.allowedOccurrenceIds,
      expectedStep,
      segment,
      slide: args.slide,
      startAt: cursor
    });
    // Multiple occurrence actions in a single step have no unambiguous
    // ordering inside one STT revision. Leave them for the current-step
    // matcher or click fallback instead of guessing.
    if (hits.length !== 1) continue;
    matches.push(hits[0]);
    cursor = hits[0].end;
  }
  return Array.from(
    new Map(matches.map((match) => [match.occurrenceId, match])).values()
  );
}

function findExpectedStepTermHits(args: {
  allowedOccurrenceIds?: readonly string[];
  expectedStep: ExpectedKeywordOccurrenceStep | null;
  segment: string;
  slide: Slide;
  startAt: number;
}): KeywordOccurrenceTermHit[] {
  if (!args.expectedStep || !args.segment) return [];
  const allowedOccurrenceIds = args.allowedOccurrenceIds
    ? new Set(args.allowedOccurrenceIds)
    : null;
  const hits = args.slide.actions.flatMap((action) => {
    const trigger = action.trigger;
    if (
      trigger.kind !== "keyword-occurrence" ||
      !args.expectedStep?.occurrenceIds.includes(trigger.occurrenceId) ||
      (allowedOccurrenceIds !== null &&
        !allowedOccurrenceIds.has(trigger.occurrenceId))
    ) {
      return [];
    }
    const keyword = args.slide.keywords.find(
      (candidate) => candidate.keywordId === trigger.keywordId
    );
    if (!keyword) return [];
    const terms = [keyword.text, ...keyword.synonyms, ...keyword.abbreviations]
      .map((term) => normalizeSpeechText(term))
      .filter(Boolean);
    const start = terms.reduce<number | null>((closest, term) => {
      const next = args.segment.indexOf(term, args.startAt);
      if (next < 0) return closest;
      return closest === null || next < closest ? next : closest;
    }, null);
    if (start === null) return [];
    const matchedTerm = terms.find(
      (term) => args.segment.indexOf(term, args.startAt) === start
    );
    if (!matchedTerm) return [];
    return [{
      end: start + matchedTerm.length,
      keywordId: keyword.keywordId,
      occurrenceId: trigger.occurrenceId,
      start,
      text: keyword.text
    }];
  });
  return Array.from(
    new Map(hits.map((hit) => [hit.occurrenceId, hit])).values()
  ).sort((left, right) => left.start - right.start);
}

export function resolveOccurrenceActions(slide: Slide, occurrenceId: string) {
  return slide.actions.filter(
    (action): action is DeckSlideAction =>
      action.trigger.kind === "keyword-occurrence" &&
      action.trigger.occurrenceId === occurrenceId
  );
}
