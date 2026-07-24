import { describe, expect, it } from "vitest";

import { deckSchema } from "./deck.schema";
import { deckPatchSchema } from "./patch.schema";

const wideCanvas = {
  preset: "wide-16-9" as const,
  width: 1920 as const,
  height: 1080 as const,
  aspectRatio: "16:9" as const,
};

function slideBase(slideId: string, order: number) {
  return {
    slideId,
    order,
    title: `Slide ${order}`,
    thumbnailUrl: "",
    style: {},
    speakerNotes: "",
    elements: [],
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
  };
}

function activityDefinition(activityId = "activity_1") {
  return {
    activityId,
    template: "satisfaction" as const,
    title: "만족도",
    description: "",
    questions: [
      {
        questionId: "question_1",
        type: "rating" as const,
        prompt: "발표가 유익했나요?",
        required: true,
        leftLabel: "아니요",
        rightLabel: "그래요",
      },
    ],
    allowDisplayName: false,
    hideResultsUntilReveal: true,
  };
}

function deckWith(slides: unknown[], canvas: unknown = wideCanvas) {
  return {
    deckId: "deck_activity_1",
    projectId: "project_1",
    title: "Activity Deck",
    version: 1,
    canvas,
    slides,
  };
}

describe("Activity slide Deck contract", () => {
  it("normalizes legacy slides without kind to content", () => {
    const deck = deckSchema.parse(deckWith([slideBase("slide_1", 1)]));

    expect(deck.slides[0]?.kind).toBe("content");
  });

  it("accepts an Activity slide only on a 16:9 Deck", () => {
    const activitySlide = {
      ...slideBase("slide_1", 1),
      kind: "activity",
      activity: activityDefinition(),
    };
    const standardCanvas = {
      preset: "standard-4-3",
      width: 1024,
      height: 768,
      aspectRatio: "4:3",
    };

    expect(deckSchema.safeParse(deckWith([activitySlide])).success).toBe(true);
    expect(
      deckSchema.safeParse(deckWith([activitySlide], standardCanvas)).success,
    ).toBe(false);
  });

  it("defaults legacy Activity slides to system appearance", () => {
    const deck = deckSchema.parse(
      deckWith([
        {
          ...slideBase("slide_1", 1),
          kind: "activity",
          activity: activityDefinition(),
        },
      ]),
    );

    expect(deck.slides[0]).toMatchObject({
      kind: "activity",
      activityAppearance: { mode: "system" },
    });
  });

  it("accepts editable Activity appearance and bound runtime elements", () => {
    const activity = activityDefinition();
    const result = deckSchema.safeParse(
      deckWith([
        {
          ...slideBase("slide_1", 1),
          kind: "activity",
          activity,
          activityAppearance: { mode: "editable" },
          elements: [
            {
              elementId: "el_activity_title",
              type: "activity-copy",
              x: 100,
              y: 100,
              width: 1000,
              height: 180,
              props: {
                activityId: activity.activityId,
                field: "title",
                fallbackText: "질문을 입력해 주세요",
                textStyle: {
                  fontSize: 72,
                  fontWeight: "bold",
                  align: "center",
                  verticalAlign: "middle",
                },
              },
            },
            {
              elementId: "el_presentation_passcode",
              type: "presentation-passcode",
              x: 1200,
              y: 600,
              width: 480,
              height: 220,
              props: {},
            },
          ],
        },
      ]),
    );

    expect(result.success).toBe(true);
  });

  it("rejects data and custom-shape elements on editable Activity slides", () => {
    for (const element of [
      {
        elementId: "el_chart",
        type: "chart",
        x: 100,
        y: 100,
        width: 800,
        height: 500,
        props: {
          type: "bar",
          data: [],
        },
      },
      {
        elementId: "el_table",
        type: "table",
        x: 100,
        y: 100,
        width: 800,
        height: 500,
        props: {},
      },
      {
        elementId: "el_custom_shape",
        type: "customShape",
        x: 100,
        y: 100,
        width: 800,
        height: 500,
        props: {
          pathData: "M 0 0 L 100 0 L 100 100 Z",
          viewBoxWidth: 100,
          viewBoxHeight: 100,
        },
      },
    ]) {
      const result = deckSchema.safeParse(
        deckWith([
          {
            ...slideBase("slide_1", 1),
            kind: "activity",
            activity: activityDefinition(),
            activityAppearance: { mode: "editable" },
            elements: [element],
          },
        ]),
      );

      expect(result.success).toBe(false);
    }
  });

  it("rejects duplicate Activity IDs", () => {
    const result = deckSchema.safeParse(
      deckWith([
        {
          ...slideBase("slide_1", 1),
          kind: "activity",
          activity: activityDefinition("activity_same"),
        },
        {
          ...slideBase("slide_2", 2),
          kind: "activity",
          activity: activityDefinition("activity_same"),
        },
      ]),
    );

    expect(result.success).toBe(false);
  });

  it("allows a dangling result source for visible recovery", () => {
    const result = deckSchema.safeParse(
      deckWith([
        {
          ...slideBase("slide_1", 1),
          kind: "activity-results",
          activityResult: {
            sourceActivityId: "activity_missing",
            display: "live",
            layout: "summary",
          },
        },
      ]),
    );

    expect(result.success).toBe(true);
  });

  it("requires a reusable QR element to reference an Activity in the same Deck", () => {
    const contentSlide = {
      ...slideBase("slide_content", 1),
      elements: [
        {
          elementId: "el_qr_1",
          type: "activity-qr",
          x: 100,
          y: 100,
          width: 240,
          height: 240,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: { activityId: "activity_1" },
        },
      ],
    };
    const activitySlide = {
      ...slideBase("slide_activity", 2),
      kind: "activity",
      activity: activityDefinition(),
    };

    expect(
      deckSchema.safeParse(deckWith([contentSlide, activitySlide])).success,
    ).toBe(true);
    expect(
      deckSchema.safeParse(
        deckWith([
          {
            ...contentSlide,
            elements: [
              {
                ...contentSlide.elements[0],
                props: { activityId: "activity_missing" },
              },
            ],
          },
          activitySlide,
        ]),
      ).success,
    ).toBe(false);
  });

  it("requires Activity copy elements to reference an Activity in the same Deck", () => {
    const slide = {
      ...slideBase("slide_activity", 1),
      kind: "activity",
      activity: activityDefinition(),
      activityAppearance: { mode: "editable" },
      elements: [
        {
          elementId: "el_activity_copy_orphan",
          type: "activity-copy",
          x: 100,
          y: 100,
          width: 800,
          height: 160,
          props: {
            activityId: "activity_missing",
            field: "title",
            textStyle: {},
          },
        },
      ],
    };

    expect(deckSchema.safeParse(deckWith([slide])).success).toBe(false);
  });

  it("migrates the temporary image marker to an activity-qr element", () => {
    const result = deckSchema.parse(
      deckWith([
        {
          ...slideBase("slide_content", 1),
          elements: [
            {
              elementId: "el_qr_legacy",
              type: "image",
              x: 100,
              y: 100,
              width: 240,
              height: 240,
              rotation: 0,
              opacity: 1,
              zIndex: 1,
              locked: false,
              visible: true,
              props: {
                src: "orbit-activity://activity_1/participant",
                alt: "참여 QR 코드",
              },
            },
          ],
        },
        {
          ...slideBase("slide_activity", 2),
          kind: "activity",
          activity: activityDefinition(),
        },
      ]),
    );

    expect(result.slides[0]?.elements[0]).toMatchObject({
      type: "activity-qr",
      props: { activityId: "activity_1" },
    });
  });

  it("keeps a legacy marker as an image when its source Activity was already removed", () => {
    const result = deckSchema.parse(
      deckWith([
        {
          ...slideBase("slide_content", 1),
          elements: [
            {
              elementId: "el_qr_orphaned_legacy",
              type: "image",
              x: 100,
              y: 100,
              width: 240,
              height: 240,
              rotation: 0,
              opacity: 1,
              zIndex: 1,
              locked: false,
              visible: true,
              props: {
                src: "orbit-activity://activity_removed/participant",
                alt: "참여 QR 코드",
              },
            },
          ],
        },
      ]),
    );

    expect(result.slides[0]?.elements[0]?.type).toBe("image");
  });

  it("rejects runtime data stored on Activity slides", () => {
    const result = deckSchema.safeParse(
      deckWith([
        {
          ...slideBase("slide_1", 1),
          kind: "activity",
          activity: activityDefinition(),
          responseCount: 12,
        },
      ]),
    );

    expect(result.success).toBe(false);
  });

  it("parses dedicated Activity definition patch operations", () => {
    expect(
      deckPatchSchema.safeParse({
        deckId: "deck_activity_1",
        baseVersion: 1,
        operations: [
          {
            type: "update_activity_definition",
            slideId: "slide_1",
            activity: activityDefinition(),
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("parses an atomic Activity design replacement operation", () => {
    expect(
      deckPatchSchema.safeParse({
        deckId: "deck_activity_1",
        baseVersion: 1,
        operations: [
          {
            type: "replace_activity_design",
            slideId: "slide_1",
            activityAppearance: { mode: "editable" },
            style: { backgroundColor: "#F7F7F2" },
            elements: [
              {
                elementId: "el_qr",
                type: "activity-qr",
                x: 100,
                y: 100,
                width: 320,
                height: 320,
                props: { activityId: "activity_1" }
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
  });

  it("rejects unsupported elements in an Activity design replacement", () => {
    expect(
      deckPatchSchema.safeParse({
        deckId: "deck_activity_1",
        baseVersion: 1,
        operations: [
          {
            type: "replace_activity_design",
            slideId: "slide_1",
            activityAppearance: { mode: "editable" },
            style: {},
            elements: [
              {
                elementId: "el_chart",
                type: "chart",
                x: 100,
                y: 100,
                width: 800,
                height: 500,
                props: {
                  type: "bar",
                  data: [],
                },
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
