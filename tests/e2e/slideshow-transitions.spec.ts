import { expect, test, type Page } from "@playwright/test";
import type { Deck, Slide } from "@orbit/shared";
import { createAuthenticatedProject } from "./authenticatedProject";

const transitionDeck = {
  deckId: "deck_transition_e2e",
  projectId: "project_transition_e2e",
  title: "슬라이드 전환 E2E",
  version: 1,
  targetDurationMinutes: 3,
  metadata: { language: "ko", locale: "ko-KR", sourceType: "manual" },
  canvas: {
    preset: "wide-16-9",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9"
  },
  theme: {
    fontFamily: "Inter",
    backgroundColor: "#ffffff",
    textColor: "#111827",
    accentColor: "#2563eb"
  },
  slides: [
    createSlide(1, "#fee2e2"),
    createSlide(2, "#dcfce7", { type: "fade", durationMs: 1_200 }),
    createSlide(3, "#dbeafe", { type: "fade", durationMs: 1_200 })
  ]
} satisfies Deck;

test.describe("destination slide cross-fade", () => {
  test("cross-fades and converges on the latest slide during rapid navigation", async ({
    page
  }) => {
    await openRehearsal(page, "transition-rapid");
    const renderer = page.locator(
      ".rehearsal-stage-surface .slideshow-renderer"
    );

    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_transition_1"
    );
    await expect(renderer).toHaveAttribute("data-transition-active", "false");

    await page.getByRole("button", { name: "다음 슬라이드" }).click();
    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_transition_2"
    );
    await expect(renderer).toHaveAttribute("data-transition-active", "true");
    await expect(
      renderer.locator(
        '[data-cross-fade-layer="outgoing"][data-slide-id="slide_transition_1"]'
      )
    ).toHaveCount(1);
    await expect(
      renderer.locator(
        '[data-cross-fade-layer="incoming"][data-slide-id="slide_transition_2"]'
      )
    ).toHaveCount(1);

    await page.getByRole("button", { name: "다음 슬라이드" }).click();
    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_transition_3"
    );
    await expect(renderer).toHaveAttribute("data-transition-active", "true");
    await expect(
      renderer.locator(
        '[data-cross-fade-layer="incoming"][data-slide-id="slide_transition_3"]'
      )
    ).toHaveCount(1);
    await expect(
      renderer.locator(
        '[data-cross-fade-layer="outgoing"][data-slide-id="slide_transition_1"]'
      )
    ).toHaveCount(0);

    await expect(renderer).toHaveAttribute("data-transition-active", "false", {
      timeout: 3_000
    });
    await expect(
      renderer.locator('[data-cross-fade-layer="outgoing"]')
    ).toHaveCount(0);
    await expect(
      renderer.locator('[data-cross-fade-layer="incoming"]')
    ).toHaveCSS("opacity", "1");
  });

  test("shows the destination immediately when reduced motion is enabled", async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openRehearsal(page, "transition-reduced-motion");
    const renderer = page.locator(
      ".rehearsal-stage-surface .slideshow-renderer"
    );

    await page.getByRole("button", { name: "다음 슬라이드" }).click();

    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_transition_2"
    );
    await expect(renderer).toHaveAttribute("data-transition-active", "false");
    await expect(
      renderer.locator('[data-cross-fade-layer="outgoing"]')
    ).toHaveCount(0);
    await expect(
      renderer.locator('[data-cross-fade-layer="incoming"]')
    ).toHaveCSS("opacity", "1");
  });
});

async function openRehearsal(page: Page, label: string) {
  const { project } = await createAuthenticatedProject(page, {
    deck: transitionDeck,
    label
  });
  const deckResponse = await page.request.get(
    `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck`
  );
  expect(deckResponse.ok()).toBe(true);
  const { deck: storedDeck } = (await deckResponse.json()) as { deck: Deck };
  expect(storedDeck.slides[1]?.transition).toEqual({
    type: "fade",
    durationMs: 1_200
  });
  await page.goto(`/rehearsal/${project.projectId}`);
  await page.getByRole("button", { name: "음성 없이 연습하기" }).click();
  await expect(page.getByText("리허설 · 자동 따라가기")).toBeVisible();
}

function createSlide(
  index: number,
  backgroundColor: string,
  transition?: Slide["transition"]
): Slide {
  return {
    slideId: `slide_transition_${index}`,
    order: index,
    title: `Transition ${index}`,
    thumbnailUrl: "",
    estimatedSeconds: 60,
    style: {
      layout: "title-content",
      backgroundColor,
      textColor: "#111827",
      accentColor: "#2563eb"
    },
    speakerNotes: "",
    elements: [
      {
        elementId: `el_transition_${index}`,
        type: "text",
        x: 240,
        y: 300,
        width: 1_200,
        height: 200,
        rotation: 0,
        opacity: 1,
        locked: false,
        props: {
          text: `Transition ${index}`,
          fontSize: 72,
          fontFamily: "Inter",
          fontWeight: 700,
          color: "#111827",
          align: "center"
        }
      }
    ],
    keywords: [],
    animations: [],
    transition,
    aiNotes: { emphasisPoints: [], sourceEvidence: [] }
  };
}
