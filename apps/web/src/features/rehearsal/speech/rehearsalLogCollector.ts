import type {
  RehearsalRunMeta,
  RehearsalSemanticCueDecision,
  SemanticCapabilityEvent,
} from "@orbit/shared/rehearsals";
import type { AdviceEventType } from "../../../runtime/speech/tracking/speechTrackingConfig";

export type RehearsalLogSlide = {
  slideId: string;
  keywordIds: readonly string[];
  matchableSentenceIds?: readonly string[];
};

export type RehearsalLogCollectorOptions = {
  slides: readonly RehearsalLogSlide[];
  now?: () => Date;
  adviceReentryCooldownMs?: number;
};

export type RehearsalLogCollector = {
  enterSlide: (slideId: string) => void;
  recordKeywordHit: (slideId: string, keywordId: string) => void;
  recordProvisionalMissing: (slideId: string, keywordId: string) => void;
  recordSentenceCovered: (input: {
    slideId: string;
    sentenceId: string;
    matchKind: "covered" | "paraphrased";
    similarity?: number;
    lexicalOverlap?: number;
  }) => void;
  recordAdLib: (input: {
    slideId: string;
    text: string;
    nearestSentenceId: string | null;
    similarity: number | null;
  }) => void;
  recordSemanticCueDecisions: (
    decisions: readonly RehearsalSemanticCueDecision[]
  ) => void;
  recordSemanticCapabilityEvent: (event: SemanticCapabilityEvent) => void;
  setAdviceState: (type: AdviceEventType, active: boolean) => void;
  finalize: () => RehearsalRunMeta;
};

type AdviceState = {
  active: boolean;
  lastRecordedAtMs: number | null;
};

export function createRehearsalLogCollector(
  options: RehearsalLogCollectorOptions
): RehearsalLogCollector {
  const now = options.now ?? (() => new Date());
  const cooldownMs = options.adviceReentryCooldownMs ?? 15000;
  const slideTimeline: RehearsalRunMeta["slideTimeline"] = [];
  const keywordHits = new Map<string, Set<string>>();
  const provisionalMissing = new Map<string, Set<string>>();
  const coveredSentenceIds = new Map<string, Set<string>>();
  const utteranceOutcomes: RehearsalRunMeta["utteranceOutcomes"] = [];
  const semanticCueDecisions: RehearsalRunMeta["semanticCueDecisions"] = [];
  const semanticCapabilityEvents: RehearsalRunMeta["semanticCapabilityEvents"] = [];
  const adviceState = new Map<AdviceEventType, AdviceState>();
  const adviceEvents: RehearsalRunMeta["adviceEvents"] = [];

  function enterSlide(slideId: string) {
    slideTimeline.push({
      slideId,
      enteredAt: now().toISOString()
    });
  }

  function recordKeywordHit(slideId: string, keywordId: string) {
    getSet(keywordHits, slideId).add(keywordId);
  }

  function recordProvisionalMissing(slideId: string, keywordId: string) {
    getSet(provisionalMissing, slideId).add(keywordId);
  }

  function recordSentenceCovered(input: {
    slideId: string;
    sentenceId: string;
    matchKind: "covered" | "paraphrased";
    similarity?: number;
    lexicalOverlap?: number;
  }) {
    const slideCovered = getSet(coveredSentenceIds, input.slideId);
    if (slideCovered.has(input.sentenceId)) {
      return;
    }

    slideCovered.add(input.sentenceId);
    utteranceOutcomes.push({
      slideId: input.slideId,
      kind: input.matchKind,
      sentenceId: input.sentenceId,
      ...(input.similarity === undefined ? {} : { similarity: input.similarity }),
      ...(input.lexicalOverlap === undefined
        ? {}
        : { lexicalOverlap: input.lexicalOverlap }),
      at: now().toISOString()
    });
  }

  function recordAdLib(input: {
    slideId: string;
    text: string;
    nearestSentenceId: string | null;
    similarity: number | null;
  }) {
    const text = input.text.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 600);
    if (!text) {
      return;
    }

    utteranceOutcomes.push({
      slideId: input.slideId,
      kind: "ad-lib",
      text,
      ...(input.nearestSentenceId === null
        ? {}
        : { sentenceId: input.nearestSentenceId }),
      ...(input.similarity === null ? {} : { similarity: input.similarity }),
      at: now().toISOString()
    });
  }

  function setAdviceState(type: AdviceEventType, active: boolean) {
    const current = adviceState.get(type) ?? {
      active: false,
      lastRecordedAtMs: null
    };
    const currentTime = now();
    const currentMs = currentTime.getTime();

    if (active && !current.active) {
      const canRecord =
        current.lastRecordedAtMs === null ||
        currentMs - current.lastRecordedAtMs >= cooldownMs;
      if (canRecord) {
        adviceEvents.push({ type, at: currentTime.toISOString() });
        current.lastRecordedAtMs = currentMs;
      }
    }

    current.active = active;
    adviceState.set(type, current);
  }

  function recordSemanticCueDecisions(
    decisions: readonly RehearsalSemanticCueDecision[]
  ) {
    for (const decision of decisions) {
      semanticCueDecisions.push({
        ...decision,
        premise:
          decision.premise === undefined
            ? undefined
            : normalizeBoundedMetaText(decision.premise, 600),
        hypothesis:
          decision.hypothesis === undefined
            ? undefined
            : normalizeBoundedMetaText(decision.hypothesis, 300),
        at: decision.at ?? now().toISOString()
      });
    }
  }

  function recordSemanticCapabilityEvent(event: SemanticCapabilityEvent) {
    semanticCapabilityEvents.push(event);
    if (semanticCapabilityEvents.length > 100) {
      semanticCapabilityEvents.splice(0, semanticCapabilityEvents.length - 100);
    }
  }

  function finalize(): RehearsalRunMeta {
    const missedKeywords: RehearsalRunMeta["missedKeywords"] = [];
    const missedSentenceOutcomes: RehearsalRunMeta["utteranceOutcomes"] = [];

    for (const slide of options.slides) {
      const hits = keywordHits.get(slide.slideId) ?? new Set<string>();
      for (const keywordId of slide.keywordIds) {
        if (!hits.has(keywordId)) {
          missedKeywords.push({ slideId: slide.slideId, keywordId });
        }
      }

      const covered = coveredSentenceIds.get(slide.slideId) ?? new Set<string>();
      for (const sentenceId of slide.matchableSentenceIds ?? []) {
        if (!covered.has(sentenceId)) {
          missedSentenceOutcomes.push({
            slideId: slide.slideId,
            kind: "missed",
            sentenceId
          });
        }
      }
    }

    return {
      recordingDurationSeconds: null,
      slideTimeline: [...slideTimeline],
      missedKeywords,
      adviceEvents: [...adviceEvents],
      utteranceOutcomes: [...utteranceOutcomes, ...missedSentenceOutcomes],
      semanticCueDecisions: [...semanticCueDecisions],
      semanticCapabilityEvents: [...semanticCapabilityEvents]
    };
  }

  return {
    enterSlide,
    recordKeywordHit,
    recordProvisionalMissing,
    recordSentenceCovered,
    recordAdLib,
    recordSemanticCueDecisions,
    recordSemanticCapabilityEvent,
    setAdviceState,
    finalize
  };
}

function getSet(map: Map<string, Set<string>>, key: string) {
  const current = map.get(key);
  if (current) {
    return current;
  }

  const next = new Set<string>();
  map.set(key, next);
  return next;
}

function normalizeBoundedMetaText(value: string, maxLength: number) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
