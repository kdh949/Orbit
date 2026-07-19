import type {
  Deck,
  EvaluationCriterion,
  PresentationBrief,
  RehearsalEvaluationPlan,
  RehearsalEvaluationSnapshot,
  RehearsalFocusProfile,
  RehearsalFocusProfileSnapshot,
} from "@orbit/shared";
import {
  canonicalJson,
  rehearsalEvaluationPlanSchema,
  rehearsalFocusProfileSnapshotSchema,
} from "@orbit/shared";
import { createHash } from "node:crypto";

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function deckContentHash(deck: Deck): string {
  return sha256Canonical(deck);
}

export function buildRehearsalEvaluationPlan(input: {
  deck: Deck;
  brief: PresentationBrief | null;
  sourceGoalSetRef: { goalSetId: string; revision: number } | null;
}): RehearsalEvaluationPlan {
  const evaluatorLensRef = input.brief?.evaluatorLensRef ?? {
    lensId: "general-novice" as const,
    revision: 1 as const,
  };
  const criteria: EvaluationCriterion[] = [
    ...briefCriteria(input.brief),
    ...cueCriteria(input.deck),
    ...timingCriteria(input.deck),
    ...deliveryCriteria(),
  ];

  return rehearsalEvaluationPlanSchema.parse({
    planVersion: 1,
    briefRef: input.brief
      ? {
          mode: "briefed",
          briefId: input.brief.briefId,
          revision: input.brief.revision,
        }
      : { mode: "generic" },
    evaluatorLensRef,
    targetDurationSeconds:
      (input.brief?.targetDurationMinutes ?? input.deck.targetDurationMinutes) *
      60,
    criteria,
    metricDefinitionVersions: { timing: 1, filler: 1, silence: 2, semantic: 1 },
    approvedReferences: input.brief?.approvedReferences ?? [],
    practiceGoalSetRef: input.sourceGoalSetRef,
  });
}

export function createRehearsalFocusProfileSnapshot(
  profile: RehearsalFocusProfile | null,
): RehearsalFocusProfileSnapshot | null {
  if (!profile) return null;

  return rehearsalFocusProfileSnapshotSchema.parse({
    profileRef: {
      profileId: profile.profileId,
      revision: profile.revision,
    },
    items: profile.items,
  });
}

export function assertFrozenRehearsalEvaluationSources(input: {
  snapshot: RehearsalEvaluationSnapshot;
  brief: PresentationBrief | null;
  focusProfile: RehearsalFocusProfile | null;
}): void {
  const plan = input.snapshot.evaluationPlan;
  if (!plan) {
    throw new Error("Rehearsal evaluation plan is missing from the snapshot.");
  }

  const expectedBriefRef = input.brief
    ? {
        mode: "briefed" as const,
        briefId: input.brief.briefId,
        revision: input.brief.revision,
      }
    : { mode: "generic" as const };
  const expectedLensRef = input.brief?.evaluatorLensRef ?? {
    lensId: "general-novice" as const,
    revision: 1 as const,
  };
  const expectedBriefCriteria = briefCriteria(input.brief);
  const actualBriefCriteria = plan.criteria.filter(
    (criterion) => criterion.source === "brief",
  );
  const expectedProfileSnapshot = createRehearsalFocusProfileSnapshot(
    input.focusProfile,
  );

  if (
    canonicalJson(plan.briefRef) !== canonicalJson(expectedBriefRef) ||
    canonicalJson(plan.evaluatorLensRef) !== canonicalJson(expectedLensRef) ||
    canonicalJson(plan.approvedReferences) !==
      canonicalJson(input.brief?.approvedReferences ?? []) ||
    canonicalJson(actualBriefCriteria) !==
      canonicalJson(expectedBriefCriteria) ||
    canonicalJson(input.snapshot.focusProfileSnapshot) !==
      canonicalJson(expectedProfileSnapshot)
  ) {
    throw new Error(
      "Rehearsal evaluation sources do not match the frozen snapshot.",
    );
  }
}

function briefCriteria(brief: PresentationBrief | null): EvaluationCriterion[] {
  if (!brief) return [];
  return brief.requirements
    .filter((requirement) => requirement.reviewStatus === "approved")
    .map((requirement) => ({
      criterionId:
        `criterion_brief_${requirement.requirementId}_r${requirement.revision}`.slice(
          0,
          128,
        ),
      revision: requirement.revision,
      category: requirement.kind === "must-cover" ? "semantic" : "structure",
      source: "brief",
      scope:
        requirement.kind === "must-cover"
          ? { type: "run" as const }
          : {
              type: "time-window" as const,
              window: requirement.kind as "opening" | "closing",
            },
      label: requirement.text,
      measurement: {
        type: "semantic-coverage" as const,
        expectedConceptIds: [`concept_${shortHash(requirement.text)}`],
      },
    }));
}

function cueCriteria(deck: Deck): EvaluationCriterion[] {
  return deck.slides.flatMap((slide) =>
    slide.semanticCues
      .filter((cue) => cue.reviewStatus === "approved")
      .map((cue) => ({
        criterionId: `criterion_cue_${cue.cueId}_r${cue.revision}`.slice(
          0,
          128,
        ),
        revision: cue.revision,
        category: "semantic" as const,
        source: "deck-cue" as const,
        scope: { type: "slide" as const, slideId: slide.slideId },
        label: cue.meaning,
        measurement: {
          type: "semantic-coverage" as const,
          expectedConceptIds: (cue.requiredConcepts.length > 0
            ? cue.requiredConcepts
            : [cue.meaning]
          ).map((concept) => `concept_${shortHash(concept)}`),
        },
      })),
  );
}

function timingCriteria(deck: Deck): EvaluationCriterion[] {
  const fallback = Math.max(
    1,
    Math.round((deck.targetDurationMinutes * 60) / deck.slides.length),
  );
  return deck.slides.map((slide) => ({
    criterionId: `criterion_timing_${shortHash(slide.slideId)}`,
    revision: 1,
    category: "timing" as const,
    source: "system" as const,
    scope: { type: "slide" as const, slideId: slide.slideId },
    label: `${slide.title} 목표 시간`,
    measurement: {
      type: "max-duration-seconds" as const,
      maximum: Math.round((slide.estimatedSeconds ?? fallback) * 1.2),
    },
  }));
}

function deliveryCriteria(): EvaluationCriterion[] {
  return [
    {
      criterionId: "criterion_system_filler_v1",
      revision: 1,
      category: "delivery",
      source: "system",
      scope: { type: "run" },
      label: "반복 말버릇",
      measurement: {
        type: "max-count",
        metric: "filler-word-count",
        maximum: 1,
      },
    },
    {
      criterionId: "criterion_system_long_silence_v2",
      revision: 2,
      category: "delivery",
      source: "system",
      scope: { type: "run" },
      label: "긴 침묵",
      measurement: {
        type: "max-count",
        metric: "long-silence-count",
        maximum: 0,
      },
    },
  ] as EvaluationCriterion[];
}

function shortHash(value: unknown) {
  return sha256Canonical(value).slice(0, 24);
}
