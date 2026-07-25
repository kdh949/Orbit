import {
  deckSchema,
  type Deck,
  type SemanticCapabilityEvent,
  type SemanticCue,
  type SemanticFallbackReason,
  type SemanticMeasurementMode,
  type RehearsalSemanticCueDecision
} from "@orbit/shared";

import type { E5EmbeddingService } from "../speech/e5EmbeddingService";
import {
  createSemanticCueEmbeddingIndex,
  type SemanticCueEmbeddingIndex
} from "../speech/semanticCueEmbeddingIndex";
import {
  selectSemanticCueCandidates,
  type SemanticCueCandidate
} from "../speech/semanticCueCandidateSelector";
import {
  createMockSemanticCueNliProvider,
  type MockSemanticCueNliScores
} from "../speech/mockSemanticCueNliProvider";
import type { SemanticCueDebugEvent } from "../speech/semanticCueDebugEvents";
import {
  SemanticCueNliProviderError,
  type SemanticCueNliProvider
} from "../speech/semanticCueNliProvider";
import {
  createSemanticCapabilityState,
  type SemanticCapabilityStatuses,
  type SemanticCapabilityTransition
} from "../speech/semanticCapabilityState";
import { createSemanticCueRuntime } from "../speech/semanticCueRuntime";
import {
  createSemanticCueDebugTimeline,
  serializeSemanticCueDebugTimeline,
  type SemanticCueDebugTimelineEntry
} from "../panel/semanticCueDebugTimeline";

/**
 * Dev/QA lab model.
 *
 * This module NEVER re-implements semantic cue judgement. Every cue decision,
 * candidate score, NLI score, fallback reason and action-gate `blockedReasons`
 * comes straight out of the production `createSemanticCueRuntime`. The lab only
 * (a) wires failure injections into the real runtime inputs/providers and
 * (b) classifies the runtime's own Decision + capability snapshot into the
 * covered/partial/missed/unmeasured outcome vocabulary so QA can compare
 * against expectations. The classification is a transparent dev-tool mapping,
 * not a second matcher.
 */

export type LabTranscriptSegment = {
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type LabProviderChoice = "mock" | "browser" | "none";

export type LabFailureInjection =
  | "stt_disabled"
  | "mic_permission_denied"
  | "embedding_unavailable"
  | "nli_disabled"
  | "nli_timeout"
  | "nli_provider_unavailable"
  | "runtime_exception"
  | "server_evaluation_unavailable"
  | "stale_cue"
  | "transcript_incomplete"
  | "queue_dropped";

export const labFailureInjections: readonly LabFailureInjection[] = [
  "stt_disabled",
  "mic_permission_denied",
  "embedding_unavailable",
  "nli_disabled",
  "nli_timeout",
  "nli_provider_unavailable",
  "runtime_exception",
  "server_evaluation_unavailable",
  "stale_cue",
  "transcript_incomplete",
  "queue_dropped"
];

export const labFailureInjectionLabels: Record<LabFailureInjection, string> = {
  stt_disabled: "STT 비활성",
  mic_permission_denied: "마이크 권한 거부",
  embedding_unavailable: "임베딩 사용 불가",
  nli_disabled: "NLI 비활성",
  nli_timeout: "NLI timeout",
  nli_provider_unavailable: "NLI provider 사용 불가",
  runtime_exception: "런타임 예외",
  server_evaluation_unavailable: "서버 평가 불가",
  stale_cue: "Stale cue",
  transcript_incomplete: "Transcript 불완전",
  queue_dropped: "Semantic queue drop"
};

export type LabOutcomeStatus =
  | "covered"
  | "partial"
  | "missed"
  | "unmeasured";

export type LabCueOutcome = {
  cueId: string;
  reportLabel: string;
  importance: SemanticCue["importance"];
  status: LabOutcomeStatus;
  measurementMode: SemanticMeasurementMode;
  fallbackReason?: SemanticFallbackReason;
  unmeasuredReason?: SemanticFallbackReason;
  matchedKeywords: string[];
  matchedAliases: string[];
  coveredConcepts: string[];
  missingConcepts: string[];
  finalScore?: number;
};

export type LabActionKind = "auto-advance" | "reveal" | "animation";

export type LabActionGateView = {
  autoAdvance: boolean;
  reveal: boolean;
  animation: boolean;
  allowed: boolean;
  blockedReasons: string[];
  requiredCueCoverage: number;
  minimumDwellMs: number;
  cooldownMs: number;
  capabilityState: "full" | "degraded" | "unavailable";
};

export type LabCandidateRow = {
  cueId: string;
  reportLabel: string;
  lexicalScore: number;
  conceptCoverage: number;
  retrievalScore: number;
  candidateScore: number;
  selectedForNli: boolean;
  nliSkippedReason?: string;
  matchedKeywords: string[];
  matchedAliases: string[];
  matchedConcepts: string[];
  finalScore?: number;
  decision: "covered" | "partial" | "not_covered" | "contradicted" | "none";
};

export type LabPipelineStep = {
  id: string;
  label: string;
  status: "ok" | "skipped" | "fallback" | "blocked";
  detail: string;
};

export type LabEvaluationResult = {
  slideId: string;
  transcript: string;
  measurementMode: SemanticMeasurementMode;
  evaluationState: "succeeded" | "partial" | "unavailable";
  decisions: RehearsalSemanticCueDecision[];
  debugEvent: SemanticCueDebugEvent;
  capabilityEvents: SemanticCapabilityEvent[];
  capabilitySnapshot: SemanticCapabilityStatuses;
  outcomes: LabCueOutcome[];
  candidateRows: LabCandidateRow[];
  actionGate: LabActionGateView;
  pipeline: LabPipelineStep[];
  timeline: SemanticCueDebugTimelineEntry[];
  providerLoadError?: string;
  runtimeError?: string;
};

export type LabEvaluationConfig = {
  deck: Deck;
  slideId: string;
  segments: readonly LabTranscriptSegment[];
  injections: readonly LabFailureInjection[];
  provider: SemanticCueNliProvider | undefined;
  nliEnabled: boolean;
  providerLoadError?: string;
  useRealEmbedding?: boolean;
  embeddingServiceOverride?: E5EmbeddingService;
  nliTimeoutMs?: number;
  now?: () => number;
};

const REQUIRED_CUE_COVERAGE = 0.7;
const MINIMUM_DWELL_MS = 1_200;
const COOLDOWN_MS = 2_500;

const injectionReason: Record<LabFailureInjection, SemanticFallbackReason> = {
  stt_disabled: "user_disabled",
  mic_permission_denied: "permission_denied",
  embedding_unavailable: "runtime_error",
  nli_disabled: "user_disabled",
  nli_timeout: "timeout",
  nli_provider_unavailable: "provider_unavailable",
  runtime_exception: "runtime_error",
  server_evaluation_unavailable: "server_evaluation_failed",
  stale_cue: "stale_cue",
  transcript_incomplete: "transcript_incomplete",
  queue_dropped: "queue_dropped"
};

export type ParseDeckResult = { deck: Deck } | { error: string };

/** Parse + validate pasted/uploaded deck JSON through the real `deckSchema`. */
export function parseDeckInput(text: string): ParseDeckResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { error: `JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = deckSchema.safeParse(json);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "deck"}: ${issue.message}`).join("\n") };
  }
  return { deck: parsed.data };
}

export function getSlideCues(deck: Deck, slideId: string): SemanticCue[] {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  return slide ? [...slide.semanticCues] : [];
}

export function getSlideTitle(deck: Deck, slideId: string): string {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  return slide?.title ?? slideId;
}

/**
 * A fully offline, deterministic embedding service used as the default lab
 * embedding backend. It reuses the production `createSemanticCueEmbeddingIndex`
 * cosine-similarity retrieval; only the vector source is a lightweight bigram
 * hash so the page works with no downloaded model.
 */
export function createLabMockEmbeddingService(options?: {
  fail?: boolean;
}): E5EmbeddingService {
  const dimensions = 96;
  function embed(text: string): Float32Array {
    if (options?.fail) {
      throw new Error("lab embedding service unavailable");
    }
    const vector = new Float32Array(dimensions);
    const normalized = text.normalize("NFC").toLowerCase();
    for (let index = 0; index < normalized.length - 1; index += 1) {
      const bigram = normalized.charCodeAt(index) * 131 + normalized.charCodeAt(index + 1);
      vector[bigram % dimensions] += 1;
    }
    let magnitude = 0;
    for (const value of vector) {
      magnitude += value * value;
    }
    magnitude = Math.sqrt(magnitude) || 1;
    for (let index = 0; index < dimensions; index += 1) {
      vector[index] = vector[index]! / magnitude;
    }
    return vector;
  }

  return {
    async embedQuery(text) {
      return embed(text);
    },
    async embedPassages(texts) {
      return texts.map((text) => embed(text));
    }
  };
}

/**
 * Lazily load the production E5 embedding service. Only invoked when the dev
 * explicitly opts into real embeddings so the page works fully offline.
 */
async function loadRealE5EmbeddingService(): Promise<E5EmbeddingService> {
  const module = await import("../speech/e5EmbeddingService");
  return module.getE5EmbeddingService();
}

/**
 * Build the mock NLI provider for the given injections. Real browser NLI is
 * resolved by the page (dynamic import) and passed in via `LabEvaluationConfig`.
 */
export function createLabMockProvider(options: {
  injections: readonly LabFailureInjection[];
  scoresByCueId?: Record<string, MockSemanticCueNliScores>;
  now?: () => number;
}): SemanticCueNliProvider {
  const base = createMockSemanticCueNliProvider({
    ...(options.scoresByCueId ? { scoresByCueId: options.scoresByCueId } : {}),
    ...(options.now ? { now: options.now } : {})
  });
  const has = (injection: LabFailureInjection) =>
    options.injections.includes(injection);

  if (has("nli_timeout")) {
    return {
      load: base.load,
      evaluate: (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => {
            reject(new SemanticCueNliProviderError("timeout", "lab injected timeout"));
          });
        })
    };
  }
  if (has("runtime_exception")) {
    return {
      load: base.load,
      evaluate: async () => {
        throw new Error("lab injected semantic runtime exception");
      }
    };
  }
  if (has("nli_provider_unavailable")) {
    return {
      load: base.load,
      evaluate: async () => []
    };
  }
  return base;
}

function isNliEnabled(
  nliEnabled: boolean,
  injections: readonly LabFailureInjection[]
): boolean {
  if (injections.includes("nli_disabled")) {
    return false;
  }
  return nliEnabled;
}

function buildTranscript(
  segments: readonly LabTranscriptSegment[],
  injections: readonly LabFailureInjection[]
): { transcript: string; startMs?: number; endMs?: number } {
  const sttOff =
    injections.includes("stt_disabled") ||
    injections.includes("mic_permission_denied");
  if (sttOff) {
    return { transcript: "" };
  }
  const finals = segments
    .filter((segment) => segment.isFinal)
    .sort((left, right) => left.startMs - right.startMs);
  const usable = injections.includes("transcript_incomplete")
    ? finals.filter((_, index) => index < finals.length - 1)
    : finals;
  const transcript = usable.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  if (usable.length === 0) {
    return { transcript };
  }
  return {
    transcript,
    startMs: usable[0]!.startMs,
    endMs: usable[usable.length - 1]!.endMs
  };
}

function applyStaleInjection(
  cues: readonly SemanticCue[],
  injections: readonly LabFailureInjection[]
): SemanticCue[] {
  if (!injections.includes("stale_cue")) {
    return [...cues];
  }
  return cues.map((cue) =>
    cue.reviewStatus === "approved" ? { ...cue, freshness: "stale" } : cue
  );
}

export async function runLabEvaluation(
  config: LabEvaluationConfig
): Promise<LabEvaluationResult> {
  const now = config.now ?? (() => Date.now());
  const injections = config.injections;
  const slideCues = applyStaleInjection(getSlideCues(config.deck, config.slideId), injections);
  const approvedCues = slideCues.filter((cue) => cue.reviewStatus === "approved");

  const capabilityState = createSemanticCapabilityState({
    now,
    initial: { stt: "available", server_evaluation: "available" }
  });
  const capabilityEvents: SemanticCapabilityEvent[] = [];
  const pushTransition = (transition: SemanticCapabilityTransition) => {
    const event = capabilityState.transition(transition);
    if (event) {
      capabilityEvents.push(event);
    }
  };

  const embeddingUnavailable = injections.includes("embedding_unavailable");
  const embeddingService =
    embeddingUnavailable || !config.useRealEmbedding
      ? config.embeddingServiceOverride ?? createLabMockEmbeddingService({ fail: embeddingUnavailable })
      : config.embeddingServiceOverride ?? (await loadRealE5EmbeddingService());
  const embeddingIndex: SemanticCueEmbeddingIndex = createSemanticCueEmbeddingIndex({
    embeddingService
  });

  const nliEnabled = isNliEnabled(config.nliEnabled, injections);
  const runtime = createSemanticCueRuntime({
    ...(config.provider ? { provider: config.provider } : {}),
    enabled: nliEnabled,
    embeddingIndex,
    deckId: config.deck.deckId,
    now,
    ...(config.nliTimeoutMs ? { nliTimeoutMs: config.nliTimeoutMs } : {}),
    nliMode: "active"
  });

  const { transcript, startMs, endMs } = buildTranscript(config.segments, injections);

  let runtimeError: string | undefined;
  try {
    await runtime.prepareSlide({ slideId: config.slideId, cues: slideCues });
  } catch {
    // Embedding prepare failure surfaces later through retrieveScores fallback.
  }

  let result;
  try {
    result = await runtime.evaluateFinalResult({
      deckId: config.deck.deckId,
      slideId: config.slideId,
      slideTitle: getSlideTitle(config.deck, config.slideId),
      transcript,
      isFinal: true,
      cues: slideCues,
      coveredCueIds: new Set<string>(),
      phraseMatched: false,
      keywordCoverage: 0,
      semanticDecisionReason: "no_match",
      semanticMatchingEnabled: true,
      generation: 1,
      nowMs: now(),
      ...(startMs === undefined ? {} : { evidenceStartMs: startMs }),
      ...(endMs === undefined ? {} : { evidenceEndMs: endMs })
    });
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
    result = null;
  }

  // Capability transitions emitted by the real runtime.
  const runtimeTransitions = result?.capabilityUpdates ?? [];
  for (const transition of runtimeTransitions) {
    pushTransition(transition);
  }

  const affectedCueIds = approvedCues.map((cue) => cue.cueId);

  // Synthesized capability states the single-call runtime cannot emit on its own.
  if (injections.includes("stt_disabled")) {
    pushTransition(capabilityTransition("stt", "unavailable", "user_disabled", "none", affectedCueIds, false));
  }
  if (injections.includes("mic_permission_denied")) {
    pushTransition(capabilityTransition("stt", "unavailable", "permission_denied", "none", affectedCueIds, true));
  }
  if (injections.includes("transcript_incomplete")) {
    pushTransition(
      capabilityTransition("transcript_evidence", "degraded", "transcript_incomplete", "none", affectedCueIds, true)
    );
  }
  if (injections.includes("server_evaluation_unavailable")) {
    pushTransition(
      capabilityTransition("server_evaluation", "unavailable", "server_evaluation_failed", "none", affectedCueIds, true)
    );
  }
  if (injections.includes("stale_cue")) {
    const staleIds = slideCues
      .filter((cue) => cue.freshness === "stale")
      .map((cue) => cue.cueId);
    pushTransition(
      capabilityTransition("cue_freshness", "unavailable", "stale_cue", "none", staleIds, true)
    );
  }
  if (injections.includes("queue_dropped")) {
    pushTransition(
      capabilityTransition("semantic_runtime", "degraded", "queue_dropped", "basic", affectedCueIds, true)
    );
  }

  const capabilitySnapshot = capabilityState.snapshot();
  const debugEvent = result?.debugEvent ?? buildEmptyDebugEvent(config, now(), runtimeError);
  const evaluationMode = deriveEvaluationMode(
    runtimeTransitions,
    result?.decisions ?? [],
    injections,
    debugEvent.fallback?.measurementMode
  );

  const outcomes = deriveOutcomes({
    approvedCues,
    decisions: result?.decisions ?? [],
    debugEvent,
    evaluationMode,
    injections,
    hasTranscript: transcript.trim().length > 0,
    runtimeError
  });

  const actionGate = deriveActionGate({
    debugEvent,
    capabilitySnapshot,
    evaluationMode,
    injections,
    runtimeError
  });

  const pipeline = derivePipeline({
    transcript,
    debugEvent,
    evaluationMode,
    injections,
    nliEnabled,
    runtimeError,
    providerLoadError: config.providerLoadError
  });

  // Re-run the production candidate selector so the table can show the exact
  // candidateScore the runtime used (retrieval scores come from the same index).
  const stableWindow = debugEvent.transcript.stableWindow ?? "";
  let retrievalScoresByCueId: ReadonlyMap<string, number> = new Map();
  try {
    retrievalScoresByCueId = stableWindow
      ? await embeddingIndex.retrieveScores({ slideId: config.slideId, transcript: stableWindow })
      : new Map();
  } catch {
    retrievalScoresByCueId = new Map();
  }
  const scoredCandidates = stableWindow
    ? selectSemanticCueCandidates({
        slideId: config.slideId,
        transcript: stableWindow,
        cues: slideCues,
        coveredCueIds: new Set<string>(),
        retrievalScoresByCueId,
        maxCandidates: Math.max(approvedCues.length, 1)
      })
    : [];
  const candidateRows = buildCandidateRows({
    approvedCues,
    scoredCandidates,
    debugEvent,
    decisions: result?.decisions ?? []
  });

  const timeline = createSemanticCueDebugTimeline({
    capabilityEvents,
    decisionEvents: [debugEvent]
  });

  const measurementMode = evaluationMode;
  const evaluationState = deriveEvaluationState(evaluationMode, outcomes, runtimeError);

  return {
    slideId: config.slideId,
    transcript,
    measurementMode,
    evaluationState,
    decisions: result?.decisions ?? [],
    debugEvent,
    capabilityEvents,
    capabilitySnapshot,
    outcomes,
    candidateRows,
    actionGate,
    pipeline,
    timeline,
    ...(config.providerLoadError ? { providerLoadError: config.providerLoadError } : {}),
    ...(runtimeError ? { runtimeError } : {})
  };
}

function capabilityTransition(
  capability: SemanticCapabilityTransition["capability"],
  toState: SemanticCapabilityTransition["toState"],
  reason: SemanticFallbackReason,
  measurementMode: SemanticMeasurementMode,
  cueIds: readonly string[],
  retryable: boolean
): SemanticCapabilityTransition {
  return { capability, toState, reason, measurementMode, retryable, cueIds };
}

function deriveEvaluationMode(
  transitions: readonly SemanticCapabilityTransition[],
  decisions: readonly RehearsalSemanticCueDecision[],
  injections: readonly LabFailureInjection[],
  fallbackMode?: SemanticMeasurementMode
): SemanticMeasurementMode {
  const runtimeTransition = [...transitions]
    .reverse()
    .find((transition) => transition.capability === "semantic_runtime");
  if (runtimeTransition) {
    return runtimeTransition.measurementMode;
  }
  if (injections.includes("stt_disabled") || injections.includes("mic_permission_denied")) {
    return "none";
  }
  if (fallbackMode !== undefined) {
    return fallbackMode;
  }
  if (decisions.some((decision) => decision.measurementMode === "full")) {
    return "full";
  }
  if (decisions.length > 0) {
    return "basic";
  }
  return "none";
}

function deriveOutcomes(options: {
  approvedCues: readonly SemanticCue[];
  decisions: readonly RehearsalSemanticCueDecision[];
  debugEvent: SemanticCueDebugEvent;
  evaluationMode: SemanticMeasurementMode;
  injections: readonly LabFailureInjection[];
  hasTranscript: boolean;
  runtimeError?: string;
}): LabCueOutcome[] {
  const dominantReason = dominantUnmeasuredReason(options.injections, options.runtimeError);
  return options.approvedCues.map((cue) => {
    const candidate = options.debugEvent.candidates.find((entry) => entry.cueId === cue.cueId);
    const matched = matchedTerms(cue, options.debugEvent.transcript.stableWindow ?? "");
    const base: Pick<
      LabCueOutcome,
      "cueId" | "reportLabel" | "importance" | "matchedKeywords" | "matchedAliases" | "coveredConcepts" | "missingConcepts"
    > = {
      cueId: cue.cueId,
      reportLabel: cue.reportLabel ?? cue.meaning,
      importance: cue.importance,
      matchedKeywords: matched.keywords,
      matchedAliases: matched.aliases,
      coveredConcepts: matched.coveredConcepts,
      missingConcepts: matched.missingConcepts
    };

    if (cue.freshness === "stale" || options.injections.includes("stale_cue")) {
      return { ...base, status: "unmeasured", measurementMode: "none", unmeasuredReason: "stale_cue" };
    }

    const decision = options.decisions.find(
      (entry) => entry.cueId === cue.cueId && (entry.label === "covered" || entry.label === "partial")
    );
    if (decision) {
      return {
        ...base,
        status: decision.label === "covered" ? "covered" : "partial",
        measurementMode: decision.measurementMode,
        finalScore: decision.finalScore,
        ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {})
      };
    }

    if (options.evaluationMode === "full" && options.hasTranscript && candidate) {
      return { ...base, status: "missed", measurementMode: "full" };
    }

    return {
      ...base,
      status: "unmeasured",
      measurementMode: "none",
      unmeasuredReason: dominantReason
    };
  });
}

function buildCandidateRows(options: {
  approvedCues: readonly SemanticCue[];
  scoredCandidates: readonly SemanticCueCandidate[];
  debugEvent: SemanticCueDebugEvent;
  decisions: readonly RehearsalSemanticCueDecision[];
}): LabCandidateRow[] {
  const stableWindow = options.debugEvent.transcript.stableWindow ?? "";
  return options.approvedCues.map((cue) => {
    const scored = options.scoredCandidates.find((entry) => entry.cue.cueId === cue.cueId);
    const debugCandidate = options.debugEvent.candidates.find((entry) => entry.cueId === cue.cueId);
    const decision = options.decisions.find((entry) => entry.cueId === cue.cueId);
    const matched = matchedTerms(cue, stableWindow);
    const decisionLabel = decision?.label ?? "none";
    return {
      cueId: cue.cueId,
      reportLabel: cue.reportLabel ?? cue.meaning,
      lexicalScore: scored?.lexicalScore ?? debugCandidate?.lexicalScore ?? 0,
      conceptCoverage: scored?.conceptCoverage ?? debugCandidate?.conceptCoverage ?? 0,
      retrievalScore: scored?.retrievalScore ?? debugCandidate?.embeddingScore ?? 0,
      candidateScore: scored?.score ?? 0,
      selectedForNli: scored?.selectedForNli ?? debugCandidate?.selectedForNli ?? false,
      ...(scored?.nliSkippedReason ?? debugCandidate?.nliSkippedReason
        ? { nliSkippedReason: scored?.nliSkippedReason ?? debugCandidate?.nliSkippedReason }
        : {}),
      matchedKeywords: matched.keywords,
      matchedAliases: matched.aliases,
      matchedConcepts: matched.coveredConcepts,
      ...(decision?.finalScore === undefined ? {} : { finalScore: decision.finalScore }),
      decision: decisionLabel === "none" ? "none" : decisionLabel
    };
  });
}

function dominantUnmeasuredReason(
  injections: readonly LabFailureInjection[],
  runtimeError?: string
): SemanticFallbackReason {
  if (runtimeError) {
    return "runtime_error";
  }
  const priority: LabFailureInjection[] = [
    "stt_disabled",
    "mic_permission_denied",
    "transcript_incomplete",
    "queue_dropped",
    "server_evaluation_unavailable",
    "nli_timeout",
    "nli_provider_unavailable",
    "runtime_exception",
    "embedding_unavailable",
    "nli_disabled"
  ];
  for (const injection of priority) {
    if (injections.includes(injection)) {
      if (injection === "stt_disabled" || injection === "mic_permission_denied") {
        return "no_transcript";
      }
      return injectionReason[injection];
    }
  }
  return "insufficient_evidence";
}

function deriveActionGate(options: {
  debugEvent: SemanticCueDebugEvent;
  capabilitySnapshot: SemanticCapabilityStatuses;
  evaluationMode: SemanticMeasurementMode;
  injections: readonly LabFailureInjection[];
  runtimeError?: string;
}): LabActionGateView {
  const blocked = new Set<string>(options.debugEvent.actionGate?.blockedReasons ?? []);
  const degraded = Object.values(options.capabilitySnapshot).some(
    (state) => state !== "available"
  );
  const capabilityState = allUnavailable(options.capabilitySnapshot)
    ? "unavailable"
    : degraded
      ? "degraded"
      : "full";

  if (options.evaluationMode !== "full") {
    blocked.add("fallback-basic-only");
  }
  if (options.capabilitySnapshot.stt !== "available") {
    blocked.add("capability-unavailable");
  }
  if (options.injections.includes("stale_cue")) {
    blocked.add("stale-cue");
  }
  if (
    options.injections.includes("transcript_incomplete") ||
    options.capabilitySnapshot.transcript_evidence === "degraded"
  ) {
    blocked.add("transcript-incomplete");
  }
  if (options.injections.includes("nli_timeout")) {
    blocked.add("provider-timeout");
  }
  if (options.runtimeError) {
    blocked.add("runtime-error");
  }
  // Semantic cue results alone never auto-advance a slide.
  blocked.add("nli-cannot-advance-slide-alone");

  const allowed = false;
  return {
    autoAdvance: allowed,
    reveal: allowed,
    animation: allowed,
    allowed,
    blockedReasons: [...blocked],
    requiredCueCoverage: REQUIRED_CUE_COVERAGE,
    minimumDwellMs: MINIMUM_DWELL_MS,
    cooldownMs: COOLDOWN_MS,
    capabilityState
  };
}

function allUnavailable(snapshot: SemanticCapabilityStatuses): boolean {
  return (
    snapshot.semantic_runtime === "unavailable" &&
    snapshot.nli === "unavailable"
  );
}

function derivePipeline(options: {
  transcript: string;
  debugEvent: SemanticCueDebugEvent;
  evaluationMode: SemanticMeasurementMode;
  injections: readonly LabFailureInjection[];
  nliEnabled: boolean;
  runtimeError?: string;
  providerLoadError?: string;
}): LabPipelineStep[] {
  const candidates = options.debugEvent.candidates;
  const selected = candidates.filter((candidate) => candidate.selectedForNli);
  const nli = options.debugEvent.nli;
  const decision = options.debugEvent.decision;
  const hasTranscript = options.transcript.trim().length > 0;

  const steps: LabPipelineStep[] = [
    {
      id: "normalization",
      label: "Transcript normalization",
      status: hasTranscript ? "ok" : "skipped",
      detail: hasTranscript
        ? `정규화된 창: “${truncate(options.debugEvent.transcript.stableWindow ?? "", 60)}”`
        : "정규화할 transcript 없음"
    },
    {
      id: "keyword",
      label: "keyword/alias match",
      status: candidates.some((candidate) => (candidate.lexicalScore ?? 0) > 0) ? "ok" : "skipped",
      detail: `lexical>0 cue ${candidates.filter((c) => (c.lexicalScore ?? 0) > 0).length}개`
    },
    {
      id: "concept",
      label: "concept coverage",
      status: candidates.some((candidate) => (candidate.conceptCoverage ?? 0) > 0) ? "ok" : "skipped",
      detail: `concept 부분충족 cue ${candidates.filter((c) => (c.conceptCoverage ?? 0) > 0).length}개`
    },
    {
      id: "lexical-score",
      label: "lexical score",
      status: candidates.length > 0 ? "ok" : "skipped",
      detail: `${candidates.length}개 cue 채점`
    },
    {
      id: "retrieval",
      label: "cue E5 retrieval",
      status: options.injections.includes("embedding_unavailable")
        ? "fallback"
        : candidates.some((candidate) => (candidate.embeddingScore ?? 0) > 0)
          ? "ok"
          : "skipped",
      detail: options.injections.includes("embedding_unavailable")
        ? "embedding 사용 불가 → 검색 생략"
        : `retrieval 점수 존재 cue ${candidates.filter((c) => (c.embeddingScore ?? 0) > 0).length}개`
    },
    {
      id: "topk",
      label: "top-k candidate selection",
      status: selected.length > 0 ? "ok" : "skipped",
      detail: `NLI 대상 후보 ${selected.length}개`
    },
    {
      id: "nli-policy",
      label: "NLI policy",
      status: options.nliEnabled ? "ok" : "skipped",
      detail: options.providerLoadError
        ? `provider 오류: ${options.providerLoadError}`
        : options.nliEnabled
          ? "NLI 활성"
          : "NLI 비활성"
    },
    {
      id: "nli-result",
      label: nli ? "NLI result" : "NLI skipped",
      status: nli
        ? "ok"
        : decision.label === "covered" || decision.label === "partial"
          ? "skipped"
          : selected.length === 0
            ? "skipped"
            : "fallback",
      detail: nli
        ? `${nli.provider} · ${nli.latencyMs}ms`
        : nliSkipDetail(candidates, decision.label, options)
    },
    {
      id: "combine",
      label: "score combination",
      status: decision.cueId ? "ok" : "skipped",
      detail: `finalScore ${decision.finalScore.toFixed(3)}`
    },
    {
      id: "decision",
      label: "final decision",
      status: decision.label === "no_candidate" ? "skipped" : "ok",
      detail: `${decision.label} · ${decision.reasonCodes.join(", ") || "없음"}`
    },
    {
      id: "capability",
      label: "capability/fallback state",
      status: options.evaluationMode === "full" ? "ok" : options.evaluationMode === "basic" ? "fallback" : "blocked",
      detail: `measurementMode=${options.evaluationMode}${options.debugEvent.fallback?.reason ? ` · ${options.debugEvent.fallback.reason}` : ""}`
    },
    {
      id: "action-gate",
      label: "action gate",
      status: "blocked",
      detail: `semantic 기반 action 차단 (${options.debugEvent.actionGate?.blockedReasons.length ?? 0} reasons)`
    }
  ];
  return steps;
}

function nliSkipDetail(
  candidates: SemanticCueDebugEvent["candidates"],
  decisionLabel: SemanticCueDebugEvent["decision"]["label"],
  options: { nliEnabled: boolean; injections: readonly LabFailureInjection[]; providerLoadError?: string }
): string {
  if (!options.nliEnabled) {
    return "feature disabled";
  }
  if (options.injections.includes("nli_timeout")) {
    return "timeout";
  }
  if (options.injections.includes("nli_provider_unavailable") || options.providerLoadError) {
    return "provider unavailable";
  }
  if (options.injections.includes("runtime_exception")) {
    return "runtime error";
  }
  if (decisionLabel === "covered" || decisionLabel === "partial") {
    return "기본 매칭으로 충족 · NLI 불필요";
  }
  const reasons = Array.from(
    new Set(candidates.flatMap((candidate) => (candidate.nliSkippedReason ? [candidate.nliSkippedReason] : [])))
  );
  return reasons.length > 0 ? reasons.join(", ") : "no candidate";
}

function deriveEvaluationState(
  mode: SemanticMeasurementMode,
  outcomes: readonly LabCueOutcome[],
  runtimeError?: string
): "succeeded" | "partial" | "unavailable" {
  if (runtimeError || mode === "none") {
    return "unavailable";
  }
  if (mode === "basic" || outcomes.some((outcome) => outcome.status === "unmeasured")) {
    return "partial";
  }
  return "succeeded";
}

function matchedTerms(
  cue: SemanticCue,
  transcript: string
): { keywords: string[]; aliases: string[]; coveredConcepts: string[]; missingConcepts: string[] } {
  const normalized = normalizeForMatch(transcript);
  const keywords = cue.candidateKeywords.filter((keyword) =>
    normalized.includes(normalizeForMatch(keyword))
  );
  const aliases = Object.entries(cue.aliases)
    .filter(([canonical, values]) =>
      [canonical, ...values].some((term) => normalized.includes(normalizeForMatch(term)))
    )
    .map(([canonical]) => canonical);
  const coveredConcepts = cue.requiredConcepts.filter((concept) =>
    normalized.includes(normalizeForMatch(concept))
  );
  const missingConcepts = cue.requiredConcepts.filter(
    (concept) => !normalized.includes(normalizeForMatch(concept))
  );
  return { keywords, aliases, coveredConcepts, missingConcepts };
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

function truncate(value: string, max: number): string {
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function buildEmptyDebugEvent(
  config: LabEvaluationConfig,
  atMs: number,
  runtimeError?: string
): SemanticCueDebugEvent {
  return {
    eventId: `scue_lab_error_${Math.round(atMs)}`,
    timestamp: atMs,
    deckId: config.deck.deckId,
    slideId: config.slideId,
    transcript: { final: "", stableWindow: "" },
    candidates: [],
    decision: {
      finalScore: 0,
      label: "no_candidate",
      reasonCodes: [runtimeError ? "runtime-error" : "no-candidate"]
    },
    actionGate: {
      allowed: false,
      blockedReasons: ["runtime-error", "nli-cannot-advance-slide-alone"]
    }
  };
}

// --- Batch fixtures ---------------------------------------------------------

export type LabFixtureExpectation = {
  cueId?: string;
  status: LabOutcomeStatus;
  measurementMode: SemanticMeasurementMode;
  fallbackReason?: SemanticFallbackReason;
  actionAllowed?: boolean;
};

export type LabFixture = {
  id: string;
  label: string;
  slideId: string;
  segments: LabTranscriptSegment[];
  provider?: LabProviderChoice;
  injections?: LabFailureInjection[];
  scoresByCueId?: Record<string, MockSemanticCueNliScores>;
  nliTimeoutMs?: number;
  expected: LabFixtureExpectation;
};

export type LabFixtureResult = {
  fixture: LabFixture;
  evaluation: LabEvaluationResult;
  actual: {
    status: LabOutcomeStatus | "none";
    measurementMode: SemanticMeasurementMode;
    fallbackReason?: SemanticFallbackReason;
    actionAllowed: boolean;
  };
  pass: boolean;
  failReasons: string[];
};

export async function runLabFixture(
  deck: Deck,
  fixture: LabFixture,
  now?: () => number
): Promise<LabFixtureResult> {
  const injections = fixture.injections ?? [];
  const providerChoice = fixture.provider ?? "mock";
  const provider =
    providerChoice === "none"
      ? undefined
      : createLabMockProvider({
          injections,
          ...(fixture.scoresByCueId ? { scoresByCueId: fixture.scoresByCueId } : {}),
          ...(now ? { now } : {})
        });

  const evaluation = await runLabEvaluation({
    deck,
    slideId: fixture.slideId,
    segments: fixture.segments,
    injections,
    provider,
    nliEnabled: providerChoice !== "none",
    ...(fixture.nliTimeoutMs ? { nliTimeoutMs: fixture.nliTimeoutMs } : {}),
    ...(now ? { now } : {})
  });

  const outcome = fixture.expected.cueId
    ? evaluation.outcomes.find((entry) => entry.cueId === fixture.expected.cueId)
    : evaluation.outcomes[0];

  const fallbackReason =
    outcome?.unmeasuredReason ??
    outcome?.fallbackReason ??
    evaluation.debugEvent.fallback?.reason;
  const actual = {
    status: (outcome?.status ?? "none") as LabOutcomeStatus | "none",
    measurementMode: evaluation.measurementMode,
    ...(fallbackReason ? { fallbackReason } : {}),
    actionAllowed: evaluation.actionGate.allowed
  };

  const failReasons: string[] = [];
  if (actual.status !== fixture.expected.status) {
    failReasons.push(`status ${actual.status} ≠ ${fixture.expected.status}`);
  }
  if (actual.measurementMode !== fixture.expected.measurementMode) {
    failReasons.push(`mode ${actual.measurementMode} ≠ ${fixture.expected.measurementMode}`);
  }
  if (
    fixture.expected.fallbackReason !== undefined &&
    actual.fallbackReason !== fixture.expected.fallbackReason
  ) {
    failReasons.push(`reason ${actual.fallbackReason ?? "none"} ≠ ${fixture.expected.fallbackReason}`);
  }
  if (
    fixture.expected.actionAllowed !== undefined &&
    actual.actionAllowed !== fixture.expected.actionAllowed
  ) {
    failReasons.push(`action ${actual.actionAllowed} ≠ ${fixture.expected.actionAllowed}`);
  }

  return { fixture, evaluation, actual, pass: failReasons.length === 0, failReasons };
}

export async function runLabFixtures(
  deck: Deck,
  fixtures: readonly LabFixture[],
  now?: () => number
): Promise<LabFixtureResult[]> {
  const results: LabFixtureResult[] = [];
  for (const fixture of fixtures) {
    results.push(await runLabFixture(deck, fixture, now));
  }
  return results;
}

// --- Export / snapshot ------------------------------------------------------

export function serializeLabTimeline(result: LabEvaluationResult): string {
  return serializeSemanticCueDebugTimeline({
    capabilityEvents: result.capabilityEvents,
    decisionEvents: [result.debugEvent],
    includeTranscriptExcerpt: false
  });
}

export function serializeLabSnapshot(
  result: LabEvaluationResult,
  options?: { includeSensitive?: boolean }
): string {
  const includeSensitive = options?.includeSensitive ?? false;
  const snapshot = {
    slideId: result.slideId,
    measurementMode: result.measurementMode,
    evaluationState: result.evaluationState,
    transcript: includeSensitive ? result.transcript : redact(result.transcript),
    outcomes: result.outcomes,
    actionGate: result.actionGate,
    capabilitySnapshot: result.capabilitySnapshot,
    capabilityEvents: result.capabilityEvents,
    decisions: includeSensitive
      ? result.decisions
      : result.decisions.map((decision) => ({
          ...decision,
          ...(decision.premise ? { premise: redact(decision.premise) } : {}),
          ...(decision.hypothesis ? { hypothesis: redact(decision.hypothesis) } : {})
        })),
    debugEvent: includeSensitive ? result.debugEvent : redactDebugEvent(result.debugEvent)
  };
  return JSON.stringify(snapshot, null, 2);
}

export function serializeLabInput(config: {
  deckId: string;
  slideId: string;
  segments: readonly LabTranscriptSegment[];
  injections: readonly LabFailureInjection[];
  provider: LabProviderChoice;
  includeTranscript?: boolean;
}): string {
  const includeTranscript = config.includeTranscript ?? false;
  return JSON.stringify(
    {
      deckId: config.deckId,
      slideId: config.slideId,
      provider: config.provider,
      injections: config.injections,
      segments: config.segments.map((segment) => ({
        text: includeTranscript ? segment.text : redact(segment.text),
        isFinal: segment.isFinal,
        startMs: segment.startMs,
        endMs: segment.endMs,
        ...(segment.confidence === undefined ? {} : { confidence: segment.confidence })
      }))
    },
    null,
    2
  );
}

function redact(value: string): string {
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalized ? `[redacted ${normalized.length}자]` : "";
}

function redactDebugEvent(event: SemanticCueDebugEvent): SemanticCueDebugEvent {
  return {
    ...event,
    transcript: {
      ...(event.transcript.partial ? { partial: redact(event.transcript.partial) } : {}),
      ...(event.transcript.final ? { final: redact(event.transcript.final) } : {}),
      stableWindow: redact(event.transcript.stableWindow)
    },
    ...(event.nli
      ? {
          nli: {
            ...event.nli,
            premise: redact(event.nli.premise),
            hypotheses: event.nli.hypotheses.map((hypothesis) => ({
              ...hypothesis,
              hypothesis: redact(hypothesis.hypothesis)
            }))
          }
        }
      : {})
  };
}
