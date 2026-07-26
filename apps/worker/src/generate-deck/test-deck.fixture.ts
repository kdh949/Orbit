import { deckSchema, type Deck } from "@orbit/shared/deck";

export function createTestDeck(projectId = "project-a"): Deck {
  return deckSchema.parse({
    deckId: "deck_ai_test",
    projectId,
    title: "AI deck test",
    version: 1,
    metadata: { language: "ko", locale: "ko-KR" },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_test_1",
        order: 1,
        title: "Test slide",
        elements: [
          {
            elementId: "el_test_1",
            type: "text",
            role: "body",
            x: 100,
            y: 100,
            width: 500,
            height: 120,
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            locked: false,
            visible: true,
            props: {
              text: "Test content",
              fontSize: 32,
              fontWeight: 400,
              color: "#111111",
              align: "left",
              verticalAlign: "top",
              lineHeight: 1.2,
            },
          },
        ],
      },
    ],
  });
}
