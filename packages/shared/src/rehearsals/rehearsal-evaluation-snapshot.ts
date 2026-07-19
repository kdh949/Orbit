import type { Deck } from "../deck/deck.schema";
import {
  rehearsalEvaluationSnapshotSchema,
  type RehearsalEvaluationSnapshot
} from "./rehearsal.schema";
import type { RehearsalEvaluationPlan } from "../coaching/evaluator-lens.schema";
import type { RehearsalFocusProfileSnapshot } from "../coaching/rehearsal-focus-profile.schema";
import { generatePronunciationLexicon } from "../pronunciation/generate-pronunciation-lexicon";

export function createRehearsalEvaluationSnapshot(
  deck: Deck,
  capturedAt: string = new Date().toISOString(),
  options: {
    deckContentHash?: string | null;
    evaluationPlan?: RehearsalEvaluationPlan | null;
    focusProfileSnapshot?: RehearsalFocusProfileSnapshot | null;
    slideThumbnailUrls?: ReadonlyMap<string, string>;
  } = {}
): RehearsalEvaluationSnapshot {
  const fallbackEstimatedSeconds = Math.max(
    1,
    Math.round((deck.targetDurationMinutes * 60) / deck.slides.length)
  );

  return rehearsalEvaluationSnapshotSchema.parse({
    deckId: deck.deckId,
    deckVersion: deck.version,
    deckContentHash: options.deckContentHash ?? null,
    evaluationPlan: options.evaluationPlan ?? null,
    focusProfileSnapshot: options.focusProfileSnapshot ?? null,
    pronunciationLexicon: generatePronunciationLexicon(deck),
    capturedAt,
    slides: deck.slides.map((slide) => ({
      slideId: slide.slideId,
      order: slide.order,
      title: slide.title.trim() || `슬라이드 ${slide.order}`,
      estimatedSeconds: slide.estimatedSeconds ?? fallbackEstimatedSeconds,
      thumbnailUrl: options.slideThumbnailUrls?.get(slide.slideId) ?? "",
      keywords: slide.keywords.map((keyword) => ({
        keywordId: keyword.keywordId,
        text: keyword.text,
        synonyms: keyword.synonyms,
        abbreviations: keyword.abbreviations,
        required: keyword.required
      })),
      semanticCues: slide.semanticCues.filter(
        (cue) => cue.reviewStatus === "approved" || cue.reviewStatus === "excluded"
      )
    }))
  });
}
