import {
  activitySlideSchema,
  activityResultsSlideSchema,
  deckSchema
} from "@orbit/shared";
import type {
  ActivityDefinition,
  ActivityAppearance,
  ActivityResultsSlide,
  ActivitySlide,
  ActivityTemplate,
  Deck,
  DeckElement,
  DeckPatch,
  Slide
} from "@orbit/shared";

import {
  createActivityDesignPreset,
  type ActivityDesignPresetId
} from "../activity-layouts/activityDesignPresets";

type CreateActivitySlideOptions = {
  title?: string;
  description?: string;
  preset?: ActivityDesignPresetId;
};

export function createActivitySlide(
  deck: Deck,
  template: ActivityTemplate,
  options: CreateActivitySlideOptions = {}
): ActivitySlide {
  assertWideDeck(deck);

  const ids = collectActivityIds(deck);
  const slideId = nextId("slide_", new Set(deck.slides.map((slide) => slide.slideId)));
  const activityId = nextId("activity_", ids.activityIds);
  const questionId = nextId("question_", ids.questionIds);
  const optionIds = ids.optionIds;

  const definition = createDefinition(
    template,
    activityId,
    questionId,
    ids.questionIds,
    optionIds,
    options
  );
  const design = options.preset
    ? createActivityDesignPreset(deck, activityId, options.preset)
    : {
        activityAppearance: { mode: "system" as const },
        style: {},
        elements: []
      };

  return activitySlideSchema.parse({
    kind: "activity",
    slideId,
    order: nextSlideOrder(deck),
    title: definition.title,
    thumbnailUrl: "",
    style: design.style,
    speakerNotes: "",
    elements: design.elements,
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
    activity: definition,
    activityAppearance: design.activityAppearance
  });
}

export function createActivityResultsSlide(
  deck: Deck,
  sourceActivityId: string,
  layout: ActivityResultsSlide["activityResult"]["layout"] = "summary"
): ActivityResultsSlide {
  assertWideDeck(deck);
  const source = deck.slides.find(
    (slide): slide is ActivitySlide =>
      slide.kind === "activity" && slide.activity.activityId === sourceActivityId
  );
  if (!source) {
    throw new Error(`Activity source not found: ${sourceActivityId}`);
  }

  return activityResultsSlideSchema.parse({
    kind: "activity-results",
    slideId: nextId("slide_", new Set(deck.slides.map((slide) => slide.slideId))),
    order: nextSlideOrder(deck),
    title: `${source.title || source.activity.title} 결과`,
    thumbnailUrl: "",
    style: {},
    speakerNotes: "",
    elements: [],
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
    activityResult: {
      sourceActivityId,
      display: "live",
      layout
    }
  });
}

export function createUpdateActivityDefinitionPatch(
  deck: Deck,
  slideId: string,
  activity: ActivityDefinition
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [{ type: "update_activity_definition", slideId, activity }]
  };
}

export function createUpdateActivityResultDefinitionPatch(
  deck: Deck,
  slideId: string,
  activityResult: ActivityResultsSlide["activityResult"]
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "update_activity_result_definition",
        slideId,
        activityResult
      }
    ]
  };
}

export function createReplaceActivityDesignPatch(
  deck: Deck,
  slideId: string,
  design: {
    activityAppearance: ActivityAppearance;
    style: Slide["style"];
    elements: DeckElement[];
  }
): DeckPatch {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  if (slide?.kind !== "activity") {
    throw new Error(`Activity slide not found: ${slideId}`);
  }

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "replace_activity_design",
        slideId,
        activityAppearance: design.activityAppearance,
        style: design.style,
        elements: design.elements
      }
    ]
  };
}

export function createApplyActivityDesignPresetPatch(
  deck: Deck,
  slideId: string,
  presetId: ActivityDesignPresetId
): DeckPatch {
  const slide = deck.slides.find(
    (candidate): candidate is ActivitySlide =>
      candidate.slideId === slideId && candidate.kind === "activity"
  );
  if (!slide) {
    throw new Error(`Activity slide not found: ${slideId}`);
  }

  return createReplaceActivityDesignPatch(
    deck,
    slideId,
    createActivityDesignPreset(deck, slide.activity.activityId, presetId)
  );
}

export function duplicateActivitySlide(
  deck: Deck,
  sourceSlideId: string
): ActivitySlide {
  assertWideDeck(deck);
  const source = deck.slides.find(
    (slide): slide is ActivitySlide =>
      slide.slideId === sourceSlideId && slide.kind === "activity"
  );
  if (!source) {
    throw new Error(`Activity slide not found: ${sourceSlideId}`);
  }

  const ids = collectActivityIds(deck);
  const cloned = cloneJson(source);
  const previousActivityId = cloned.activity.activityId;
  cloned.slideId = nextId(
    "slide_",
    new Set(deck.slides.map((slide) => slide.slideId))
  );
  cloned.order = nextSlideOrder(deck);
  cloned.activity.activityId = nextId("activity_", ids.activityIds);
  remapQuestionAndOptionIds(cloned.activity, ids.questionIds, ids.optionIds);
  for (const element of cloned.elements) {
    if (
      (element.type === "activity-qr" ||
        element.type === "activity-copy") &&
      element.props.activityId === previousActivityId
    ) {
      element.props.activityId = cloned.activity.activityId;
    }
  }

  return activitySlideSchema.parse(cloned);
}

export function duplicateActivityResultsSlide(
  deck: Deck,
  sourceSlideId: string
): ActivityResultsSlide {
  assertWideDeck(deck);
  const source = deck.slides.find(
    (slide): slide is ActivityResultsSlide =>
      slide.slideId === sourceSlideId && slide.kind === "activity-results"
  );
  if (!source) {
    throw new Error(`Activity results slide not found: ${sourceSlideId}`);
  }

  return activityResultsSlideSchema.parse({
    ...cloneJson(source),
    slideId: nextId(
      "slide_",
      new Set(deck.slides.map((slide) => slide.slideId))
    ),
    order: nextSlideOrder(deck)
  });
}

export function remapActivityDefinitionsForDeckDuplicate(
  sourceDeck: Deck,
  nextDeckId: Deck["deckId"],
  nextProjectId: string = sourceDeck.projectId
): Deck {
  const clone = cloneJson(sourceDeck);
  clone.deckId = nextDeckId;
  clone.projectId = nextProjectId;

  const ids = collectActivityIds(sourceDeck);
  const activityIdMap = new Map<string, string>();

  for (const slide of clone.slides) {
    if (slide.kind !== "activity") {
      continue;
    }
    const previousActivityId = slide.activity.activityId;
    const nextActivityId = nextId("activity_", ids.activityIds);
    activityIdMap.set(previousActivityId, nextActivityId);
    slide.activity.activityId = nextActivityId;
    remapQuestionAndOptionIds(slide.activity, ids.questionIds, ids.optionIds);
  }

  for (const slide of clone.slides) {
    if (slide.kind !== "activity-results") {
      continue;
    }
    slide.activityResult.sourceActivityId =
      activityIdMap.get(slide.activityResult.sourceActivityId) ??
      slide.activityResult.sourceActivityId;
  }

  for (const slide of clone.slides) {
    for (const element of slide.elements) {
      if (
        element.type !== "activity-qr" &&
        element.type !== "activity-copy"
      ) {
        continue;
      }
      element.props.activityId =
        activityIdMap.get(element.props.activityId) ?? element.props.activityId;
    }
  }

  return deckSchema.parse(clone);
}

function createDefinition(
  template: ActivityTemplate,
  activityId: string,
  questionId: string,
  questionIds: Set<string>,
  optionIds: Set<string>,
  options: CreateActivitySlideOptions
): ActivityDefinition {
  if (template === "pre-question") {
    return {
      activityId,
      template,
      title: options.title ?? "사전 질문",
      description: options.description ?? "발표 전에 궁금한 점을 남겨주세요.",
      allowDisplayName: true,
      hideResultsUntilReveal: true,
      questions: [
        {
          questionId,
          type: "free-text",
          prompt: "발표자에게 궁금한 점이 있나요?",
          required: true
        }
      ]
    };
  }

  if (template === "poll") {
    return {
      activityId,
      template,
      title: options.title ?? "실시간 투표",
      description: options.description ?? "한 가지를 선택해 주세요.",
      allowDisplayName: false,
      hideResultsUntilReveal: true,
      questions: [
        {
          questionId,
          type: "single-choice",
          prompt: "어떤 선택이 가장 적합한가요?",
          required: true,
          options: [
            { optionId: nextId("option_", optionIds), label: "선택 1" },
            { optionId: nextId("option_", optionIds), label: "선택 2" }
          ]
        }
      ]
    };
  }

  const freeTextQuestionId = nextId("question_", questionIds);
  return {
    activityId,
    template,
    title: options.title ?? "만족도 조사",
    description: options.description ?? "발표에 대한 의견을 알려주세요.",
    allowDisplayName: false,
    hideResultsUntilReveal: true,
    questions: [
      {
        questionId,
        type: "rating",
        prompt: "발표가 전반적으로 유익했나요?",
        required: true,
        leftLabel: "전혀 아니요",
        rightLabel: "매우 그래요"
      },
      {
        questionId: freeTextQuestionId,
        type: "free-text",
        prompt: "추가 의견이 있다면 알려주세요.",
        required: false
      }
    ]
  };
}

function remapQuestionAndOptionIds(
  definition: ActivityDefinition,
  questionIds: Set<string>,
  optionIds: Set<string>
): void {
  for (const question of definition.questions) {
    question.questionId = nextId("question_", questionIds);
    if (question.type === "single-choice" || question.type === "multiple-choice") {
      for (const option of question.options) {
        option.optionId = nextId("option_", optionIds);
      }
    }
  }
}

function collectActivityIds(deck: Deck) {
  const activityIds = new Set<string>();
  const questionIds = new Set<string>();
  const optionIds = new Set<string>();

  for (const slide of deck.slides) {
    if (slide.kind !== "activity") {
      continue;
    }
    activityIds.add(slide.activity.activityId);
    for (const question of slide.activity.questions) {
      questionIds.add(question.questionId);
      if (question.type === "single-choice" || question.type === "multiple-choice") {
        question.options.forEach((option) => optionIds.add(option.optionId));
      }
    }
  }

  return { activityIds, questionIds, optionIds };
}

function nextId(prefix: string, existing: Set<string>): string {
  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!existing.has(candidate)) {
      existing.add(candidate);
      return candidate;
    }
  }
  throw new Error(`No available ID for ${prefix}`);
}

function nextSlideOrder(deck: Deck): number {
  return Math.max(...deck.slides.map((slide) => slide.order), 0) + 1;
}

function assertWideDeck(deck: Deck): void {
  if (deck.canvas.preset !== "wide-16-9") {
    throw new Error("Activity slides require a wide-16-9 Deck");
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
