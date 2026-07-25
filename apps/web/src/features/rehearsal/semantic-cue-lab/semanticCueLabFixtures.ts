import { deckSchema, type Deck } from "@orbit/shared";

import type { LabFixture } from "./semanticCueLabModel";

/**
 * Self-contained fixture deck for the Semantic Cue Lab. Parsed through the real
 * `deckSchema` at module load so an invalid fixture fails fast. Two content
 * slides carry approved+current cues (RSP ordering, memcpy NULL check) plus one
 * suggested cue to exercise the reviewStatus filter.
 */
export const semanticCueLabFixtureDeckRaw = {
  deckId: "deck_semantic_cue_lab",
  projectId: "project_semantic_cue_lab",
  title: "Semantic Cue Lab 샘플 덱",
  version: 1,
  metadata: { language: "ko", locale: "ko-KR" },
  targetDurationMinutes: 10,
  canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
  slides: [
    {
      slideId: "slide_intro",
      order: 1,
      title: "도입",
      speakerNotes: "오늘은 저수준 메모리 안전성을 다룹니다.",
      semanticCues: []
    },
    {
      slideId: "slide_rsp",
      order: 2,
      title: "RSP 스택 공간 확보",
      speakerNotes: "RSP로 공간을 먼저 확보한 뒤 데이터를 복사해야 Out Of Bound를 막습니다.",
      semanticCues: [
        {
          cueId: "scue_rsp_order",
          slideId: "slide_rsp",
          meaning: "RSP로 스택 공간을 먼저 확보한 뒤 데이터를 복사해야 한다",
          reportLabel: "RSP 공간 확보 순서",
          presenterTag: "공간 확보 후 복사",
          cueType: "solution",
          importance: "core",
          reviewStatus: "approved",
          freshness: "current",
          origin: "ai",
          revision: 1,
          candidateKeywords: ["RSP", "공간 확보"],
          aliases: { RSP: ["알에스피", "레지스터 스택 포인터"] },
          requiredConcepts: ["공간 확보", "복사"],
          nliHypotheses: [
            "발표자는 RSP로 스택 공간을 먼저 확보한 뒤 데이터를 복사한다고 설명했다"
          ]
        },
        {
          cueId: "scue_rsp_extra",
          slideId: "slide_rsp",
          meaning: "스택 오버플로우가 발생하면 인접 메모리가 손상된다",
          reportLabel: "스택 오버플로우 영향",
          importance: "supporting",
          reviewStatus: "suggested",
          freshness: "current",
          origin: "ai",
          revision: 1,
          requiredConcepts: ["오버플로우"],
          nliHypotheses: ["발표자는 스택 오버플로우가 인접 메모리를 손상시킨다고 설명했다"]
        }
      ]
    },
    {
      slideId: "slide_memcpy",
      order: 3,
      title: "memcpy 안전성",
      speakerNotes: "memcpy 전에 NULL 포인터를 확인해야 합니다.",
      semanticCues: [
        {
          cueId: "scue_memcpy_null",
          slideId: "slide_memcpy",
          meaning: "memcpy 호출 전에 NULL 포인터를 확인해야 한다",
          reportLabel: "memcpy NULL 확인",
          presenterTag: "NULL 확인 먼저",
          cueType: "warning",
          importance: "core",
          reviewStatus: "approved",
          freshness: "current",
          origin: "ai",
          revision: 1,
          candidateKeywords: ["memcpy", "NULL 확인"],
          aliases: { memcpy: ["멤카피", "메모리 복사"] },
          requiredConcepts: ["NULL 확인", "포인터"],
          nliHypotheses: [
            "발표자는 memcpy 호출 전에 NULL 포인터를 확인한다고 설명했다"
          ]
        }
      ]
    }
  ]
} as const;

export function createSemanticCueLabFixtureDeck(): Deck {
  return deckSchema.parse(semanticCueLabFixtureDeckRaw);
}

const highEntailment = { entailmentScore: 0.95, neutralScore: 0.03, contradictionScore: 0.02 };
const lowEntailment = { entailmentScore: 0.08, neutralScore: 0.85, contradictionScore: 0.07 };

const exactMatchSegments = [
  { text: "RSP로 스택 공간 확보를 먼저 하고 데이터를 복사합니다", isFinal: true, startMs: 0, endMs: 2600 }
];
const aliasMatchSegments = [
  { text: "알에스피로 스택 공간 확보를 먼저 하고 데이터를 복사합니다", isFinal: true, startMs: 0, endMs: 2600 }
];
const adLibSegments = [
  { text: "그 부분은 여유 있게 처리한 다음 값을 복사해 두었습니다", isFinal: true, startMs: 0, endMs: 2800 }
];
const insufficientSegments = [
  { text: "포인터를 다루는 함수라 조심해야 합니다", isFinal: true, startMs: 0, endMs: 2400 }
];

/**
 * Batch fixtures covering the ten required cases. Expected values document the
 * REAL runtime behaviour of this deck; the batch test asserts they still hold.
 */
export const semanticCueLabFixtures: LabFixture[] = [
  {
    id: "fx_exact_keyword",
    label: "1. exact keyword match",
    slideId: "slide_rsp",
    segments: exactMatchSegments,
    provider: "mock",
    expected: { cueId: "scue_rsp_order", status: "covered", measurementMode: "basic" }
  },
  {
    id: "fx_alias",
    label: "2. alias match",
    slideId: "slide_rsp",
    segments: aliasMatchSegments,
    provider: "mock",
    expected: { cueId: "scue_rsp_order", status: "covered", measurementMode: "basic" }
  },
  {
    id: "fx_adlib",
    label: "3. ad-lib (같은 의미, 다른 표현)",
    slideId: "slide_rsp",
    segments: adLibSegments,
    provider: "mock",
    scoresByCueId: { scue_rsp_order: highEntailment },
    expected: { cueId: "scue_rsp_order", status: "covered", measurementMode: "full" }
  },
  {
    id: "fx_related_insufficient",
    label: "4. 관련 단어만, 의미 부족",
    slideId: "slide_memcpy",
    segments: insufficientSegments,
    provider: "mock",
    scoresByCueId: { scue_memcpy_null: lowEntailment },
    expected: { cueId: "scue_memcpy_null", status: "missed", measurementMode: "full" }
  },
  {
    id: "fx_nli_timeout",
    label: "5. NLI timeout",
    slideId: "slide_rsp",
    segments: adLibSegments,
    provider: "mock",
    injections: ["nli_timeout"],
    nliTimeoutMs: 20,
    scoresByCueId: { scue_rsp_order: highEntailment },
    expected: {
      cueId: "scue_rsp_order",
      status: "unmeasured",
      measurementMode: "basic",
      fallbackReason: "timeout"
    }
  },
  {
    id: "fx_stt_disabled",
    label: "6. STT disabled",
    slideId: "slide_rsp",
    segments: exactMatchSegments,
    provider: "mock",
    injections: ["stt_disabled"],
    expected: {
      cueId: "scue_rsp_order",
      status: "unmeasured",
      measurementMode: "none",
      fallbackReason: "no_transcript"
    }
  },
  {
    id: "fx_stale_cue",
    label: "7. stale cue",
    slideId: "slide_rsp",
    segments: exactMatchSegments,
    provider: "mock",
    injections: ["stale_cue"],
    expected: {
      cueId: "scue_rsp_order",
      status: "unmeasured",
      measurementMode: "none",
      fallbackReason: "stale_cue"
    }
  },
  {
    id: "fx_transcript_incomplete",
    label: "8. transcript incomplete",
    slideId: "slide_rsp",
    segments: exactMatchSegments,
    provider: "mock",
    injections: ["transcript_incomplete"],
    expected: {
      cueId: "scue_rsp_order",
      status: "unmeasured",
      measurementMode: "none",
      fallbackReason: "transcript_incomplete"
    }
  },
  {
    id: "fx_runtime_exception",
    label: "9. runtime exception",
    slideId: "slide_rsp",
    segments: adLibSegments,
    provider: "mock",
    injections: ["runtime_exception"],
    scoresByCueId: { scue_rsp_order: highEntailment },
    expected: {
      cueId: "scue_rsp_order",
      status: "unmeasured",
      measurementMode: "basic",
      fallbackReason: "runtime_error"
    }
  },
  {
    id: "fx_fallback_action_blocked",
    label: "10. fallback 중 action 차단",
    slideId: "slide_rsp",
    segments: adLibSegments,
    provider: "mock",
    injections: ["nli_provider_unavailable"],
    scoresByCueId: { scue_rsp_order: highEntailment },
    expected: {
      cueId: "scue_rsp_order",
      status: "unmeasured",
      measurementMode: "basic",
      fallbackReason: "provider_unavailable",
      actionAllowed: false
    }
  }
];
