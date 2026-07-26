import type {
  RehearsalSemanticCueDecision,
  SemanticCue,
  SemanticFallbackReason,
  SemanticMeasurementMode
} from "@orbit/shared";

import { normalizeSpeechText } from "../../tracking/phraseExtractor";
import {
  selectSemanticCueCandidates,
  type SemanticCueCandidate
} from "./semanticCueCandidateSelector";
import type { SemanticCueEmbeddingIndex } from "./semanticCueEmbeddingIndex";
import {
  createSemanticCueDebugEvent,
  type SemanticCueDebugEvent
} from "./semanticCueDebugEvents";
import {
  SemanticCueNliProviderError,
  type SemanticCueNliDecision,
  type SemanticCueNliProvider
} from "../nli/semanticCueNliProvider";
import {
  buildSemanticCueReportEvidence,
  normalizeBoundedText
} from "./semanticCueReportEvidence";
import {
  combineSemanticCueScore,
  defaultSemanticCueCombinerConfig,
  type SemanticCueCombinerConfig
} from "./semanticCueScoreCombiner";
import {
  semanticCueRuntimeConfig,
  type SemanticCueRuntimeConfig
} from "./semanticCueRuntimeConfig";
import type { SemanticCapabilityTransition } from "./semanticCapabilityState";
import type { SemanticMatchDecisionReason } from "../semanticUtteranceDecision";

export type SemanticCueRuntime = {
  prepareSlide: (input: {
    slideId: string;
    cues: readonly SemanticCue[];
  }) => Promise<void>;
  evaluateFinalResult: (input: SemanticCueRuntimeInput) => Promise<SemanticCueRuntimeResult>;
};

export type SemanticCueRuntimeInput = {
  deckId: string;
  slideId: string;
  slideTitle?: string;
  transcript: string;
  isFinal: boolean;
  cues: readonly SemanticCue[];
  coveredCueIds: ReadonlySet<string>;
  phraseMatched: boolean;
  keywordCoverage: number;
  semanticDecisionReason: SemanticMatchDecisionReason | "no_match";
  semanticMatchingEnabled: boolean;
  generation: number;
  nowMs: number;
  evidenceStartMs?: number;
  evidenceEndMs?: number;
};

export type SemanticCueRuntimeResult = {
  decisions: RehearsalSemanticCueDecision[];
  debugEvent: SemanticCueDebugEvent;
  capabilityUpdates: SemanticCapabilityTransition[];
};

export function createSemanticCueRuntime(options: {
  provider?: SemanticCueNliProvider;
  enabled: boolean;
  embeddingIndex?: SemanticCueEmbeddingIndex;
  now?: () => number;
  deckId?: string;
  maxCandidates?: number;
  nliTimeoutMs?: number;
  nliMode?: "active" | "shadow";
  config?: SemanticCueRuntimeConfig;
  combinerConfig?: SemanticCueCombinerConfig;
}): SemanticCueRuntime {
  const now = options.now ?? (() => Date.now());
  const deckId = options.deckId ?? "deck_unknown";
  const config = options.config ?? semanticCueRuntimeConfig;
  const combinerConfig =
    options.combinerConfig ?? defaultSemanticCueCombinerConfig;
  const nliTimeoutMs = options.nliTimeoutMs ?? config.nliTimeoutMs;
  let lastNliRunAtMs: number | null = null;
  const coveredCueIds = new Set<string>();

  return {
    async prepareSlide(input) {
      await options.embeddingIndex?.prepareSlide(input);
    },

    async evaluateFinalResult(input) {
      const stableWindow = normalizeBoundedText(input.transcript, 600);
      const capabilityUpdates: SemanticCapabilityTransition[] = [];
      if (!stableWindow) {
        capabilityUpdates.push(
          capability(input, {
            capability: "transcript_evidence",
            toState: "degraded",
            reason: "no_transcript",
            measurementMode: "none",
            retryable: true
          })
        );
        return resultWithoutDecision({
          input,
          deckId,
          stableWindow,
          candidates: [],
          reasonCodes: ["no-transcript"],
          capabilityUpdates,
          fallback: {
            used: true,
            reason: "no_transcript",
            measurementMode: "none"
          }
        });
      }

      capabilityUpdates.push(
        capability(input, {
          capability: "transcript_evidence",
          toState: "available",
          measurementMode: "full",
          retryable: false
        })
      );

      if (!input.semanticMatchingEnabled) {
        capabilityUpdates.push(
          capability(input, {
            capability: "nli",
            toState: "unavailable",
            reason: "user_disabled",
            measurementMode: "none",
            retryable: false
          })
        );
        return resultWithoutDecision({
          input,
          deckId,
          stableWindow,
          candidates: [],
          reasonCodes: ["semantic_matching_disabled"],
          capabilityUpdates,
          fallback: {
            used: true,
            reason: "user_disabled",
            measurementMode: "none"
          }
        });
      }

      let retrievalScoresByCueId: ReadonlyMap<string, number> = new Map();
      try {
        retrievalScoresByCueId =
          (await options.embeddingIndex?.retrieveScores({
            slideId: input.slideId,
            transcript: stableWindow
          })) ?? new Map();
      } catch {
        capabilityUpdates.push(
          capability(input, {
            capability: "embedding",
            toState: "unavailable",
            reason: "runtime_error",
            measurementMode: "basic",
            retryable: true
          })
        );
      }

      const allCoveredCueIds = new Set([
        ...Array.from(input.coveredCueIds),
        ...Array.from(coveredCueIds)
      ]);
      const candidates = selectSemanticCueCandidates({
        slideId: input.slideId,
        transcript: stableWindow,
        cues: input.cues,
        coveredCueIds: allCoveredCueIds,
        retrievalScoresByCueId,
        maxCandidates: options.maxCandidates ?? config.maxCandidates,
        config
      });
      const basicDecisions = candidates
        .map((candidate) =>
          buildBasicDecision(input, candidate, stableWindow, now(), config)
        )
        .filter(
          (decision): decision is RehearsalSemanticCueDecision => decision !== null
        );
      for (const decision of basicDecisions) {
        if (decision.label === "covered") {
          coveredCueIds.add(decision.cueId);
        }
      }

      const ambiguousCandidates = candidates
        .filter(
          (candidate) =>
            candidate.selectedForNli &&
            (hasUsableNegativeHint(candidate.cue) ||
              !basicDecisions.some(
                (decision) =>
                  decision.cueId === candidate.cue.cueId &&
                  decision.label === "covered"
              ))
        )
        .slice(0, config.maxNliCandidates);
      const providerFailure = getProviderFailure(options.enabled, options.provider);
      if (providerFailure) {
        const fallbackDecisions = applyFallback(basicDecisions, providerFailure);
        capabilityUpdates.push(
          capability(input, {
            capability: "nli",
            toState: "unavailable",
            reason: providerFailure,
            measurementMode: fallbackDecisions.length > 0 ? "basic" : "none",
            retryable: providerFailure === "provider_unavailable"
          }),
          capability(input, {
            capability: "semantic_runtime",
            toState: fallbackDecisions.length > 0 ? "degraded" : "available",
            ...(fallbackDecisions.length > 0
              ? { reason: providerFailure }
              : {}),
            measurementMode: fallbackDecisions.length > 0 ? "basic" : "none",
            retryable: providerFailure === "provider_unavailable"
          })
        );
        return buildResult({
          input,
          deckId,
          stableWindow,
          candidates,
          decisions: fallbackDecisions,
          capabilityUpdates,
          reasonCodes:
            fallbackDecisions[0]?.reasonCodes ??
            [ambiguousCandidates.length > 0 ? providerFailure : "no-candidate"],
          fallback: {
            used: true,
            reason: providerFailure,
            measurementMode: fallbackDecisions.length > 0 ? "basic" : "none"
          }
        });
      }

      if (ambiguousCandidates.length === 0 || !options.provider) {
        capabilityUpdates.push(
          capability(input, {
            capability: "semantic_runtime",
            toState: "available",
            measurementMode: basicDecisions.length > 0 ? "basic" : "none",
            retryable: false
          })
        );
        return buildResult({
          input,
          deckId,
          stableWindow,
          candidates,
          decisions: basicDecisions,
          capabilityUpdates,
          reasonCodes: basicDecisions[0]?.reasonCodes ?? ["no-candidate"]
        });
      }

      if (
        lastNliRunAtMs !== null &&
        input.nowMs - lastNliRunAtMs < config.nliThrottleMs
      ) {
        return buildResult({
          input,
          deckId,
          stableWindow,
          candidates,
          decisions: basicDecisions,
          capabilityUpdates,
          reasonCodes: ["throttled"]
        });
      }

      lastNliRunAtMs = input.nowMs;
      const hypotheses = ambiguousCandidates.flatMap((candidate) =>
        [
          ...candidate.cue.nliHypotheses
            .slice(0, config.maxHypothesesPerCue)
            .map((hypothesis) => ({
              cueId: candidate.cue.cueId,
              hypothesis: boundNliText(hypothesis, 300)
            })),
          ...candidate.cue.negativeHints
            .filter((hypothesis) => isUsableNegativeHint(candidate.cue, hypothesis))
            .slice(0, 1)
            .map((hypothesis, index) => ({
              cueId: negativeHypothesisCueId(candidate.cue.cueId, index),
              hypothesis: boundNliText(hypothesis, 300)
            }))
        ].filter((item) => item.hypothesis.length > 0)
      );
      const premise = boundNliTokens(stableWindow, config.maxNliTokens);

      let nliDecisions: SemanticCueNliDecision[];
      try {
        nliDecisions = await evaluateWithTimeout(
          options.provider,
          { premise, hypotheses },
          nliTimeoutMs
        );
      } catch (error) {
        const reason: SemanticFallbackReason = getNliFailureReason(error);
        const fallbackDecisions = applyFallback(basicDecisions, reason);
        capabilityUpdates.push(
          capability(input, {
            capability: "nli",
            toState: reason === "timeout" ? "degraded" : "unavailable",
            reason,
            measurementMode: "basic",
            retryable: true
          }),
          capability(input, {
            capability: "semantic_runtime",
            toState: "degraded",
            reason,
            measurementMode: "basic",
            retryable: true
          })
        );
        return buildResult({
          input,
          deckId,
          stableWindow,
          candidates,
          decisions: fallbackDecisions,
          capabilityUpdates,
          reasonCodes: [reason],
          fallback: { used: true, reason, measurementMode: "basic" }
        });
      }

      if (nliDecisions.length === 0) {
        const reason = "provider_unavailable" as const;
        const fallbackDecisions = applyFallback(basicDecisions, reason);
        capabilityUpdates.push(
          capability(input, {
            capability: "nli",
            toState: "unavailable",
            reason,
            measurementMode: "basic",
            retryable: true
          })
        );
        return buildResult({
          input,
          deckId,
          stableWindow,
          candidates,
          decisions: fallbackDecisions,
          capabilityUpdates,
          reasonCodes: ["nli-empty-result"],
          fallback: { used: true, reason, measurementMode: "basic" }
        });
      }

      const fullDecisions = ambiguousCandidates.flatMap((candidate) => {
        const best = nliDecisions
          .filter((decision) => decision.cueId === candidate.cue.cueId)
          .sort((left, right) => right.entailmentScore - left.entailmentScore)[0];
        if (!best) {
          return [];
        }
        const negative = nliDecisions
          .filter((decision) =>
            isNegativeHypothesisCueId(decision.cueId, candidate.cue.cueId)
          )
          .sort((left, right) => right.entailmentScore - left.entailmentScore)[0];
        const nliEvidence = negative
          ? {
              ...best,
              contradictionScore: Math.max(
                best.contradictionScore,
                negative.entailmentScore
              )
            }
          : best;
        const combination = combineSemanticCueScore(
          {
            lexicalScore: candidate.lexicalScore,
            conceptCoverage: candidate.conceptCoverage,
            embeddingScore: candidate.retrievalScore,
            nli: nliEvidence
          },
          combinerConfig
        );
        const evidence = buildSemanticCueReportEvidence({
          slideId: input.slideId,
          candidate,
          nliDecision: nliEvidence,
          combination,
          premise,
          at: new Date(now()).toISOString()
        });
        if (options.nliMode !== "shadow" && evidence.label === "covered") {
          coveredCueIds.add(evidence.cueId);
        }
        return [evidence];
      });
      capabilityUpdates.push(
        capability(input, {
          capability: "nli",
          toState: "available",
          measurementMode: "full",
          retryable: false,
          provider: nliDecisions[0]?.provider,
          latencyMs: nliDecisions[0]?.latencyMs
        }),
        capability(input, {
          capability: "semantic_runtime",
          toState: "available",
          measurementMode:
            options.nliMode === "shadow"
              ? basicDecisions.length > 0
                ? "basic"
                : "none"
              : "full",
          retryable: false
        })
      );
      const decisions =
        options.nliMode === "shadow"
          ? basicDecisions
          : [
              ...basicDecisions.filter(
                (decision) =>
                  !fullDecisions.some(
                    (fullDecision) => fullDecision.cueId === decision.cueId
                  )
              ),
              ...fullDecisions
            ];
      const firstDecision = decisions[0];
      return buildResult({
        input,
        deckId,
        stableWindow,
        candidates,
        decisions,
        capabilityUpdates,
        nliDecisions,
        reasonCodes:
          options.nliMode === "shadow"
            ? [...(firstDecision?.reasonCodes ?? []), "nli-shadow-only"]
            : firstDecision?.reasonCodes ?? ["insufficient-evidence"]
      });
    }
  };
}

function buildBasicDecision(
  input: SemanticCueRuntimeInput,
  candidate: SemanticCueCandidate,
  premise: string,
  atMs: number,
  config: SemanticCueRuntimeConfig = semanticCueRuntimeConfig
): RehearsalSemanticCueDecision | null {
  const normalizedPremise = normalizeSpeechText(premise);
  const normalizedMeaning = normalizeSpeechText(candidate.cue.meaning);
  const meaningMatched =
    normalizedMeaning.length > 0 && normalizedPremise.includes(normalizedMeaning);
  const aliasMatched = Object.values(candidate.cue.aliases)
    .flat()
    .some((alias) => {
      const normalized = normalizeSpeechText(alias);
      return normalized.length > 0 && normalizedPremise.includes(normalized);
    });
  const strongConceptEvidence =
    candidate.conceptCoverage === 1 &&
    (candidate.retrievalScore >= config.basicCoveredRetrieval ||
      candidate.lexicalScore >= config.candidateEligibility.lexical);
  const deterministicCovered =
    meaningMatched ||
    (aliasMatched && candidate.conceptCoverage === 1) ||
    strongConceptEvidence;
  const needsRelationshipValidation = hasUsableNegativeHint(candidate.cue);
  const covered = deterministicCovered && !needsRelationshipValidation;
  const partial =
    !covered &&
    (deterministicCovered ||
      (candidate.score >= config.basicPartialScore &&
        (candidate.lexicalScore >= config.candidateEligibility.lexical ||
          candidate.conceptCoverage >= config.basicPartialConceptCoverage)));
  if (!covered && !partial) {
    return null;
  }

  const matchedBy = aliasMatched
    ? "alias"
    : candidate.lexicalScore > 0
      ? "lexical"
      : "embedding";
  return {
    slideId: input.slideId,
    cueId: candidate.cue.cueId,
    label: covered ? "covered" : "partial",
    finalScore: covered ? Math.max(candidate.score, 0.75) : candidate.score,
    embeddingScore: candidate.retrievalScore,
    lexicalScore: candidate.lexicalScore,
    conceptCoverage: candidate.conceptCoverage,
    premise,
    matchedBy,
    measurementMode: "basic",
    fallbackUsed: false,
    reasonCodes: covered
      ? [meaningMatched ? "exact-meaning" : aliasMatched ? "alias-support" : "deterministic-support"]
      : ["deterministic-partial"],
    at: new Date(atMs).toISOString()
  };
}

function applyFallback(
  decisions: readonly RehearsalSemanticCueDecision[],
  reason: SemanticFallbackReason
) {
  return decisions.map((decision) => ({
    ...decision,
    fallbackUsed: true,
    fallbackReason: reason,
    measurementMode: "basic" as const,
    reasonCodes: [...new Set([...decision.reasonCodes, `fallback-${reason}`])]
  }));
}

function getProviderFailure(
  enabled: boolean,
  provider: SemanticCueNliProvider | undefined
): "user_disabled" | "provider_unavailable" | null {
  if (!enabled) {
    return "user_disabled";
  }
  return provider ? null : "provider_unavailable";
}

function capability(
  input: SemanticCueRuntimeInput,
  transition: Omit<SemanticCapabilityTransition, "slideId" | "cueIds"> & {
    provider?: string;
    latencyMs?: number;
  }
): SemanticCapabilityTransition {
  return {
    ...transition,
    slideId: input.slideId,
    cueIds: input.cues.map((cue) => cue.cueId)
  };
}

async function evaluateWithTimeout(
  provider: SemanticCueNliProvider,
  input: Parameters<SemanticCueNliProvider["evaluate"]>[0],
  timeoutMs: number
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.evaluate({ ...input, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new SemanticCueNliTimeoutError());
          queueMicrotask(() => controller.abort());
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

class SemanticCueNliTimeoutError extends Error {}

function getNliFailureReason(error: unknown): SemanticFallbackReason {
  if (error instanceof SemanticCueNliTimeoutError) {
    return "timeout";
  }
  if (error instanceof SemanticCueNliProviderError) {
    return error.reason;
  }
  return "runtime_error";
}

function boundNliTokens(value: string, maxTokens: number) {
  return normalizeBoundedText(value, 600).split(/\s+/).slice(-maxTokens).join(" ");
}

function boundNliText(value: string, maxLength: number) {
  return normalizeBoundedText(value, maxLength);
}

function negativeHypothesisCueId(cueId: string, index: number) {
  return `${cueId}::negative::${index}`;
}

function isNegativeHypothesisCueId(value: string, cueId: string) {
  return value.startsWith(`${cueId}::negative::`);
}

function hasUsableNegativeHint(cue: SemanticCue) {
  return cue.negativeHints.some((hint) => isUsableNegativeHint(cue, hint));
}

function isUsableNegativeHint(cue: SemanticCue, hint: string) {
  const normalizedHint = normalizeNegativeHintText(hint);
  if (!normalizedHint) {
    return false;
  }
  const cueTokens = Array.from(
    new Set(
      [
        ...cue.candidateKeywords,
        ...cue.requiredConcepts,
        ...cue.nliHypotheses,
        ...Object.keys(cue.aliases)
      ]
        .flatMap((value) =>
          normalizeNegativeHintText(value).match(
            /[a-z0-9*_-]{2,}|[가-힣]{2,}/g
          ) ?? []
        )
        .filter((token) => !weakNegativeGenericTokens.has(token))
    )
  );
  const overlaps = cueTokens.filter((token) => normalizedHint.includes(token));
  return (
    overlaps.some((token) => /[a-z0-9*_-]/.test(token)) || overlaps.length >= 2
  );
}

function normalizeNegativeHintText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

const weakNegativeGenericTokens = new Set([
  "과제",
  "과정",
  "내용",
  "다른",
  "말했다",
  "문제",
  "발표자가",
  "발표자는",
  "설명했다",
  "언급했다",
  "이번",
  "이야기",
  "주제",
  "진행",
  "프로젝트",
  "공유"
]);

function resultWithoutDecision(
  options: Omit<Parameters<typeof buildResult>[0], "decisions">
) {
  return buildResult({ ...options, decisions: [] });
}

function buildResult(options: {
  input: SemanticCueRuntimeInput;
  deckId: string;
  stableWindow: string;
  candidates: readonly SemanticCueCandidate[];
  decisions: RehearsalSemanticCueDecision[];
  capabilityUpdates: SemanticCapabilityTransition[];
  nliDecisions?: readonly SemanticCueNliDecision[];
  reasonCodes: string[];
  fallback?: {
    used: boolean;
    reason: SemanticFallbackReason;
    measurementMode: SemanticMeasurementMode;
  };
}): SemanticCueRuntimeResult {
  const firstDecision = options.decisions[0];
  const selectedCandidate = options.candidates.find(
    (candidate) => candidate.cue.cueId === firstDecision?.cueId
  );
  return {
    decisions: options.decisions,
    capabilityUpdates: options.capabilityUpdates,
    debugEvent: buildDebugEvent({
      input: options.input,
      deckId: options.deckId,
      stableWindow: options.stableWindow,
      candidates: options.candidates,
      selectedCandidate,
      nliDecisions: options.nliDecisions,
      finalScore: firstDecision?.finalScore,
      label: firstDecision?.label,
      reasonCodes: options.reasonCodes,
      fallback: options.fallback
    })
  };
}

function buildDebugEvent(options: {
  input: SemanticCueRuntimeInput;
  deckId: string;
  stableWindow: string;
  candidates: readonly SemanticCueCandidate[];
  selectedCandidate?: SemanticCueCandidate;
  nliDecisions?: readonly SemanticCueNliDecision[];
  finalScore?: number;
  label?: "covered" | "partial" | "not_covered" | "contradicted";
  reasonCodes: string[];
  fallback?: {
    used: boolean;
    reason: SemanticFallbackReason;
    measurementMode: SemanticMeasurementMode;
  };
}) {
  const firstNli = options.nliDecisions?.[0];
  return createSemanticCueDebugEvent({
    eventId: `scue_dbg_${options.input.generation}_${Math.round(options.input.nowMs)}`,
    timestamp: options.input.nowMs,
    deckId: options.input.deckId || options.deckId,
    slideId: options.input.slideId,
    ...(options.input.slideTitle === undefined ? {} : { slideTitle: options.input.slideTitle }),
    transcript: {
      final: options.input.transcript,
      stableWindow: options.stableWindow
    },
    candidates: options.candidates.map((candidate) => ({
      cueId: candidate.cue.cueId,
      meaning: candidate.cue.meaning,
      lexicalScore: candidate.lexicalScore,
      conceptCoverage: candidate.conceptCoverage,
      embeddingScore: candidate.retrievalScore,
      selectedForNli: candidate.selectedForNli,
      ...(candidate.nliSkippedReason === undefined
        ? {}
        : { nliSkippedReason: candidate.nliSkippedReason })
    })),
    ...(firstNli === undefined
      ? {}
      : {
          nli: {
            provider: firstNli.provider,
            ...(firstNli.modelId === undefined ? {} : { modelId: firstNli.modelId }),
            premise: options.stableWindow,
            hypotheses:
              options.nliDecisions?.map((decision) => ({
                cueId: decision.cueId,
                hypothesis: decision.hypothesis,
                entailmentScore: decision.entailmentScore,
                neutralScore: decision.neutralScore,
                contradictionScore: decision.contradictionScore
              })) ?? [],
            latencyMs: firstNli.latencyMs ?? 0
          }
        }),
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
    decision: {
      ...(options.selectedCandidate === undefined
        ? {}
        : { cueId: options.selectedCandidate.cue.cueId }),
      finalScore: options.finalScore ?? 0,
      label: options.label ?? "no_candidate",
      reasonCodes: options.reasonCodes
    },
    actionGate: {
      allowed: false,
      blockedReasons: [
        "nli-cannot-advance-slide-alone",
        ...(options.fallback?.used ? ["semantic-fallback-manual-only"] : [])
      ]
    }
  });
}
