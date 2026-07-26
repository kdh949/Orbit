import type {
  Deck,
  DeckPatch,
  SemanticCue,
  SemanticCueSourceRef,
  Slide,
} from "@orbit/shared/deck";

export type SemanticCueReviewChoice = "core" | "supporting" | "excluded";

export type SemanticCueEvidenceView = {
  kindLabel: string;
  refLabel: string;
  sourcePreview: string;
};

export type SemanticCueReviewItem = {
  cue: SemanticCue;
  displayLabel: string;
  evidence: SemanticCueEvidenceView[];
  isRegenerated: boolean;
  isStale: boolean;
  isVisualOnly: boolean;
  reviewChoice: SemanticCueReviewChoice | null;
  reviewLabel: string;
  warningLabels: string[];
};

export type SemanticCueReviewModel = {
  approvedCount: number;
  coreCount: number;
  cues: SemanticCueReviewItem[];
  excludedCount: number;
  expectedSeconds: number;
  suggestedCount: number;
  timingMessage: string | null;
};

const reviewChoices: SemanticCueReviewChoice[] = [
  "core",
  "supporting",
  "excluded"
];

export function buildSemanticCueReviewModel(slide: Slide): SemanticCueReviewModel {
  const cues = slide.semanticCues.map((cue) => cueReviewItem(slide, cue));
  const coreCount = slide.semanticCues.filter(
    (cue) => cue.reviewStatus !== "excluded" && cue.importance === "core"
  ).length;
  const expectedSeconds = slide.estimatedSeconds ?? 30;
  const estimatedCoreSeconds = coreCount * 8;

  return {
    approvedCount: slide.semanticCues.filter(
      (cue) => cue.reviewStatus === "approved"
    ).length,
    coreCount,
    cues,
    excludedCount: slide.semanticCues.filter(
      (cue) => cue.reviewStatus === "excluded"
    ).length,
    expectedSeconds,
    suggestedCount: slide.semanticCues.filter(
      (cue) => cue.reviewStatus === "suggested"
    ).length,
    timingMessage:
      estimatedCoreSeconds > expectedSeconds
        ? `핵심 메시지 ${coreCount}개를 전달하려면 약 ${estimatedCoreSeconds}초가 필요합니다. 이 슬라이드의 예상 ${expectedSeconds}초에 맞게 핵심을 줄여보세요.`
        : null
  };
}

export function applySemanticCueReviewChoice(
  cue: SemanticCue,
  choice: SemanticCueReviewChoice
): SemanticCue {
  if (choice === "core") {
    return {
      ...cue,
      importance: "core",
      reviewStatus: "approved",
      required: true,
      priority: 1
    };
  }
  if (choice === "supporting") {
    return {
      ...cue,
      importance: "supporting",
      reviewStatus: "approved",
      required: false,
      priority: 2
    };
  }
  return {
    ...cue,
    importance: "optional",
    reviewStatus: "excluded",
    required: false,
    priority: 3
  };
}

export function editSemanticCueMeaning(
  cue: SemanticCue,
  meaning: string
): SemanticCue {
  const normalized = meaning.trim();
  if (!normalized || normalized === cue.meaning) {
    return cue;
  }
  const importance = cue.importance === "optional" ? "supporting" : cue.importance;
  const reviewed = applySemanticCueReviewChoice(cue, importance);
  return {
    ...reviewed,
    meaning: normalized.slice(0, 240),
    reportLabel: normalized.slice(0, 80),
    presenterTag: normalized.slice(0, 40),
    origin: "manual",
    revision: cue.revision + 1,
    freshness: "current",
    requiredConcepts: [normalized.slice(0, 80)],
    nliHypotheses: [toSpeakerHypothesis(normalized)]
  };
}

export function createManualSemanticCue(input: {
  cueId?: string;
  meaning: string;
  slideId: string;
}): SemanticCue {
  const meaning = input.meaning.trim().slice(0, 240);
  return {
    cueId: input.cueId ?? createManualCueId(),
    slideId: input.slideId,
    meaning,
    reportLabel: meaning.slice(0, 80),
    presenterTag: meaning.slice(0, 40),
    importance: "supporting",
    reviewStatus: "approved",
    freshness: "current",
    origin: "manual",
    revision: 1,
    sourceRefs: [],
    qualityWarnings: [],
    required: false,
    priority: 2,
    candidateKeywords: [],
    aliases: {},
    requiredConcepts: [meaning.slice(0, 80)],
    nliHypotheses: [toSpeakerHypothesis(meaning)],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: []
  };
}

export function createSemanticCueReviewPatch(
  deck: Deck,
  slideId: string,
  semanticCues: SemanticCue[]
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "replace_semantic_cues",
        slideId,
        semanticCues
      }
    ]
  };
}

export function replaceSemanticCue(
  cues: readonly SemanticCue[],
  cueId: string,
  update: (cue: SemanticCue) => SemanticCue
): SemanticCue[] {
  return cues.map((cue) => (cue.cueId === cueId ? update(cue) : cue));
}

export function nextSemanticCueReviewChoice(
  current: SemanticCueReviewChoice | null,
  key: "ArrowLeft" | "ArrowRight"
): SemanticCueReviewChoice {
  const currentIndex = current === null ? -1 : reviewChoices.indexOf(current);
  const offset = key === "ArrowRight" ? 1 : -1;
  const nextIndex =
    currentIndex < 0
      ? key === "ArrowRight"
        ? 0
        : reviewChoices.length - 1
      : (currentIndex + offset + reviewChoices.length) % reviewChoices.length;
  return reviewChoices[nextIndex];
}

function cueReviewItem(slide: Slide, cue: SemanticCue): SemanticCueReviewItem {
  return {
    cue,
    displayLabel: cue.reportLabel ?? cue.meaning,
    evidence: cue.sourceRefs.map((sourceRef) =>
      sourceEvidenceView(slide, sourceRef)
    ),
    isRegenerated: cue.revision > 1,
    isStale: cue.freshness === "stale",
    isVisualOnly:
      cue.sourceRefs.length > 0 &&
      cue.sourceRefs.every((sourceRef) => sourceRef.kind === "image-analysis"),
    reviewChoice: reviewChoiceForCue(cue),
    reviewLabel:
      cue.reviewStatus === "suggested"
        ? "검토 필요"
        : cue.reviewStatus === "excluded"
          ? "평가 제외"
          : cue.importance === "core"
            ? "핵심 승인"
            : "보조 승인",
    warningLabels: cue.qualityWarnings.map(
      (warning) => qualityWarningLabels[warning] ?? warning
    )
  };
}

function reviewChoiceForCue(
  cue: SemanticCue
): SemanticCueReviewChoice | null {
  if (cue.reviewStatus === "suggested") {
    return null;
  }
  if (cue.reviewStatus === "excluded") {
    return "excluded";
  }
  return cue.importance === "core" ? "core" : "supporting";
}

function sourceEvidenceView(
  slide: Slide,
  sourceRef: SemanticCueSourceRef
): SemanticCueEvidenceView {
  const sourcePreview = resolveSourcePreview(slide, sourceRef);
  return {
    kindLabel: sourceKindLabels[sourceRef.kind],
    refLabel: sourceRef.refId ?? sourceRef.sourceHash.slice(0, 8),
    sourcePreview
  };
}

function resolveSourcePreview(
  slide: Slide,
  sourceRef: SemanticCueSourceRef
): string {
  if (sourceRef.kind === "slide-title") {
    return slide.title || "제목 내용 없음";
  }
  if (sourceRef.kind === "speaker-notes") {
    return excerpt(slide.speakerNotes || "발표 메모 내용 없음");
  }
  const element = slide.elements.find(
    (candidate) => candidate.elementId === sourceRef.refId
  );
  if (!element) {
    return "현재 슬라이드에서 원본 요소를 찾을 수 없습니다.";
  }
  if (element.type === "text") {
    return excerpt(element.props.text || "텍스트 내용 없음");
  }
  if (element.type === "table") {
    return excerpt(
      element.props.rows
        .flat()
        .map((cell) => cell.text)
        .filter(Boolean)
        .join(" · ") || "표 내용 없음"
    );
  }
  if (element.type === "chart") {
    const labels = element.props.data
      .map((datum) => datum.label)
      .filter((label): label is string => Boolean(label));
    return excerpt(
      [element.props.title, ...labels].filter(Boolean).join(" · ") ||
        "차트 내용 없음"
    );
  }
  if (element.type === "image") {
    return excerpt(element.props.alt || "이미지 분석 근거");
  }
  return `${element.type} 요소`;
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

function createManualCueId(): string {
  const randomId = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return `scue_manual_${randomId ?? Date.now().toString(36)}`;
}

function toSpeakerHypothesis(meaning: string): string {
  const normalized = meaning.trim().slice(0, 280);
  return /^발표자(?:는|가|께서는)\s/.test(normalized)
    ? normalized
    : `발표자는 ${normalized}`;
}

const sourceKindLabels: Record<SemanticCueSourceRef["kind"], string> = {
  "slide-title": "슬라이드 제목",
  "speaker-notes": "발표 메모",
  element: "슬라이드 요소",
  table: "표",
  chart: "차트",
  "image-analysis": "이미지 분석"
};

const qualityWarningLabels: Record<string, string> = {
  "broad-cue": "한 메시지에 여러 주장이 섞여 있습니다.",
  "missing-technical-alias": "기술 용어의 발음·의미 별칭이 필요합니다.",
  "slide-centric-hypothesis": "발표자 중심 문장으로 다시 확인해야 합니다.",
  "hypothesis-missing-required-concept":
    "NLI 판단 문장에 필수 개념이 모두 포함되지 않았습니다.",
  "inconsistent-numeric-claim":
    "메시지와 NLI 판단 문장의 수치가 서로 일치하지 않습니다.",
  "weak-negative-hint": "반대 의미 예시가 완전한 문장이 아니거나 구별력이 약합니다.",
  "ungrounded-source": "확인 가능한 원본 근거가 없습니다.",
  "image-source-unverified": "이미지 분석 근거가 확인되지 않았습니다.",
  "all-cues-priority-one": "모든 메시지가 핵심으로 제안되었습니다.",
  "content-rich-slide-too-few-cues": "내용에 비해 메시지 후보가 적습니다.",
  "ambiguous-cue-identity": "이전 메시지와의 연결을 자동 확정하지 못했습니다."
};
