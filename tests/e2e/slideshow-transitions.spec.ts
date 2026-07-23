import { expect, test, type Page } from "@playwright/test";
import { deckSchema, type Deck, type Slide } from "@orbit/shared";
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

const imageAssetUrls = {
  slide1: "https://slide-assets.example/slide-1.png",
  slide2: "https://slide-assets.example/slide-2.png"
} as const;

const morphAssetUrls = {
  source: "https://slide-assets.example/morph-source.png",
  destination: "https://slide-assets.example/morph-destination.png"
} as const;

const imageCacheDeck = {
  ...transitionDeck,
  deckId: "deck_image_cache_e2e",
  title: "슬라이드 이미지 캐시 E2E",
  slides: [
    createImageSlide(1, imageAssetUrls.slide1),
    createImageSlide(2, imageAssetUrls.slide2)
  ]
} satisfies Deck;

const morphPerformanceDeck = deckSchema.parse({
  ...transitionDeck,
  deckId: "deck_morph_performance_e2e",
  title: "객체 모핑 성능 E2E",
  slides: [
    createMorphSlide(1, false),
    {
      ...createMorphSlide(2, true),
      transition: {
        type: "morph",
        durationMs: 1_000,
        mode: "object"
      }
    }
  ]
});

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
    await expect(renderer).toHaveAttribute("data-transition-active", "false");
    await expect(renderer).toHaveAttribute("data-transition-kind", "none");
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

  test("reuses decoded slide assets and does not render a hidden next-slide canvas", async ({
    page
  }) => {
    const requestCounts = new Map<string, number>();
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    await page.route("https://slide-assets.example/**", async (route) => {
      const url = route.request().url();
      requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1);
      await route.fulfill({
        body: onePixelPng,
        contentType: "image/png",
        headers: { "access-control-allow-origin": "*" }
      });
    });

    await openRehearsal(page, "transition-image-cache", imageCacheDeck);
    const renderer = page.locator(
      ".rehearsal-stage-surface .slideshow-renderer"
    );

    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_image_cache_1"
    );
    await expect
      .poll(() => ({
        slide1: requestCounts.get(imageAssetUrls.slide1) ?? 0,
        slide2: requestCounts.get(imageAssetUrls.slide2) ?? 0
      }))
      .toEqual({ slide1: 1, slide2: 1 });
    await expect(
      page.locator(".rehearsal-next-slide-preview canvas")
    ).toHaveCount(0);

    await page.getByRole("button", { name: "다음 슬라이드" }).click();
    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_image_cache_2"
    );
    await page.getByRole("button", { name: "이전 슬라이드" }).click();
    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_image_cache_1"
    );
    await page.getByRole("button", { name: "다음 슬라이드" }).click();
    await expect(renderer).toHaveAttribute(
      "data-slide-id",
      "slide_image_cache_2"
    );

    expect(Object.fromEntries(requestCounts)).toEqual({
      [imageAssetUrls.slide1]: 1,
      [imageAssetUrls.slide2]: 1
    });
    await expect(
      page.locator(".rehearsal-next-slide-preview canvas")
    ).toHaveCount(0);
  });
});

test.describe("object morph transition", () => {
  test("morphs 40 objects in rehearsal and the slide window within the frame budget", async ({
    page
  }) => {
    const requestCounts = await routeMorphAssets(page);
    await openRehearsal(page, "morph-performance", morphPerformanceDeck);
    await expect
      .poll(() => ({
        destination: requestCounts.get(morphAssetUrls.destination) ?? 0,
        source: requestCounts.get(morphAssetUrls.source) ?? 0
      }))
      .toEqual({ destination: 1, source: 1 });

    const slideWindowPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "슬라이드 창 열기" }).click();
    const slideWindow = await slideWindowPromise;
    await slideWindow.waitForLoadState();
    await expect
      .poll(() => ({
        destination: requestCounts.get(morphAssetUrls.destination) ?? 0,
        source: requestCounts.get(morphAssetUrls.source) ?? 0
      }))
      .toEqual({ destination: 2, source: 2 });

    const rehearsalRenderer = page.locator(
      ".rehearsal-stage-surface .slideshow-renderer"
    );
    const slideWindowRenderer = slideWindow.locator(".slideshow-renderer");
    const measurementPromise = measureRendererTransition(page);

    await page.getByRole("button", { name: "다음 슬라이드" }).click();

    for (const renderer of [rehearsalRenderer, slideWindowRenderer]) {
      await expect(renderer).toHaveAttribute(
        "data-slide-id",
        "slide_morph_2"
      );
      await expect(renderer).toHaveAttribute("data-transition-kind", "morph");
      await expect(renderer).toHaveAttribute("data-morph-pair-count", "40");
      await expect(renderer).toHaveAttribute(
        "data-morph-updated-node-count",
        "40"
      );
    }

    const measurement = await measurementPromise;
    expect(measurement.sawMorph).toBe(true);
    expect(measurement.medianFrameMs).toBeLessThanOrEqual(22);
    expect(measurement.maxBlankMs).toBeLessThan(100);

    for (const renderer of [rehearsalRenderer, slideWindowRenderer]) {
      await expect(renderer).toHaveAttribute("data-transition-active", "false");
      await expect(renderer).toHaveAttribute("data-transition-kind", "none");
      await expect(
        renderer.locator('[data-cross-fade-layer="outgoing"]')
      ).toHaveCount(0);
      await expect(
        renderer.locator('[data-cross-fade-layer="incoming"]')
      ).toHaveCSS("opacity", "1");
    }
  });

  test("cancels an in-flight morph on reverse navigation and honors reduced motion", async ({
    page
  }) => {
    await routeMorphAssets(page);
    await openRehearsal(page, "morph-cancel", morphPerformanceDeck);
    const renderer = page.locator(
      ".rehearsal-stage-surface .slideshow-renderer"
    );

    await page.getByRole("button", { name: "다음 슬라이드" }).click();
    await expect(renderer).toHaveAttribute("data-transition-kind", "morph");
    await page.getByRole("button", { name: "이전 슬라이드" }).click();

    await expect(renderer).toHaveAttribute("data-slide-id", "slide_morph_1");
    await expect(renderer).toHaveAttribute("data-transition-active", "false");
    await expect(renderer).toHaveAttribute("data-transition-kind", "none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "다음 슬라이드" }).click();

    await expect(renderer).toHaveAttribute("data-slide-id", "slide_morph_2");
    await expect(renderer).toHaveAttribute("data-transition-active", "false");
    await expect(renderer).toHaveAttribute("data-transition-kind", "none");
    await expect(
      renderer.locator('[data-cross-fade-layer="incoming"]')
    ).toHaveCSS("opacity", "1");
  });
});

async function openRehearsal(
  page: Page,
  label: string,
  deck: Deck = transitionDeck
) {
  const { project } = await createAuthenticatedProject(page, {
    deck,
    label
  });
  const deckResponse = await page.request.get(
    `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck`
  );
  expect(deckResponse.ok()).toBe(true);
  const { deck: storedDeck } = (await deckResponse.json()) as { deck: Deck };
  expect(storedDeck.slides[1]?.transition).toEqual(deck.slides[1]?.transition);
  await page.goto(`/rehearsal/${project.projectId}`);
  await page.getByRole("button", { name: "음성 없이 연습하기" }).click();
  await expect(
    page.getByRole("button", { name: "다음 슬라이드" })
  ).toBeVisible();
}

async function routeMorphAssets(page: Page) {
  const requestCounts = new Map<string, number>();
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  await page.context().route(
    "https://slide-assets.example/morph-*.png",
    async (route) => {
      const url = route.request().url();
      requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1);
      await route.fulfill({
        body: onePixelPng,
        contentType: "image/png",
        headers: { "access-control-allow-origin": "*" }
      });
    }
  );
  return requestCounts;
}

async function measureRendererTransition(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        maxBlankMs: number;
        medianFrameMs: number;
        sawMorph: boolean;
      }>((resolve) => {
        const frameIntervals: number[] = [];
        const startedAt = performance.now();
        let blankStartedAt: number | null = null;
        let maxBlankMs = 0;
        let previousFrameAt = startedAt;
        let sawMorph = false;

        const tick = (now: number) => {
          frameIntervals.push(now - previousFrameAt);
          previousFrameAt = now;
          const renderer = document.querySelector(
            ".rehearsal-stage-surface .slideshow-renderer"
          );
          const transitionActive =
            renderer?.getAttribute("data-transition-active") === "true";
          sawMorph ||= renderer?.getAttribute("data-transition-kind") === "morph";
          const visibleContent = Array.from(
            renderer?.querySelectorAll<HTMLElement>(
              "[data-cross-fade-layer]"
            ) ?? []
          ).some((layer) => {
            const opacity = Number.parseFloat(
              window.getComputedStyle(layer).opacity
            );
            return (
              opacity > 0 &&
              layer.querySelector("canvas, img") !== null
            );
          });

          if (sawMorph && !visibleContent) {
            blankStartedAt ??= now;
          } else if (blankStartedAt !== null) {
            maxBlankMs = Math.max(maxBlankMs, now - blankStartedAt);
            blankStartedAt = null;
          }

          if (
            (sawMorph && !transitionActive) ||
            now - startedAt >= 2_500
          ) {
            if (blankStartedAt !== null) {
              maxBlankMs = Math.max(maxBlankMs, now - blankStartedAt);
            }
            const sortedIntervals = frameIntervals
              .slice(1)
              .sort((left, right) => left - right);
            const midpoint = Math.floor(sortedIntervals.length / 2);
            const medianFrameMs =
              sortedIntervals.length % 2 === 0
                ? ((sortedIntervals[midpoint - 1] ?? 0) +
                    (sortedIntervals[midpoint] ?? 0)) /
                  2
                : (sortedIntervals[midpoint] ?? 0);
            resolve({ maxBlankMs, medianFrameMs, sawMorph });
            return;
          }

          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      })
  );
}

function createMorphSlide(index: number, destination: boolean): Slide {
  return {
    slideId: `slide_morph_${index}`,
    order: index,
    title: `Morph ${index}`,
    thumbnailUrl: "",
    estimatedSeconds: 60,
    style: {
      layout: "title-content",
      backgroundColor: destination ? "#eff6ff" : "#fff7ed",
      textColor: "#111827",
      accentColor: "#2563eb"
    },
    speakerNotes: "",
    elements: Array.from({ length: 40 }, (_, elementIndex) =>
      createMorphElement(elementIndex, destination)
    ),
    keywords: [],
    animations: [],
    aiNotes: { emphasisPoints: [], sourceEvidence: [] }
  };
}

function createMorphElement(
  index: number,
  destination: boolean
): Slide["elements"][number] {
  const sourceElementId = `el_morph_source_${index}`;
  const column = index % 8;
  const row = Math.floor(index / 8);
  const base = {
    elementId: destination ? `el_morph_destination_${index}` : sourceElementId,
    ...(destination ? { morphKey: sourceElementId } : {}),
    x: 100 + (destination ? 7 - column : column) * 210,
    y: 80 + (destination ? 4 - row : row) * 190,
    width: destination ? 160 : 140,
    height: destination ? 120 : 100,
    rotation: destination ? (index % 2 === 0 ? 25 : -20) : 0,
    opacity: 1,
    zIndex: index,
    locked: false,
    visible: true
  };

  if (index === 0) {
    return {
      ...base,
      type: "image",
      props: {
        src: destination
          ? morphAssetUrls.destination
          : morphAssetUrls.source,
        alt: destination ? "교체 이미지" : "원본 이미지",
        fit: "cover"
      }
    };
  }

  if (index === 1) {
    return {
      ...base,
      type: destination ? "rect" : "ellipse",
      props: {
        fill: destination ? "#2563eb" : "#f97316",
        stroke: "transparent",
        strokeWidth: 0,
        borderRadius: destination ? 12 : 0
      }
    };
  }

  if (index === 2) {
    return {
      ...base,
      type: "text",
      props: {
        text: destination ? "After" : "Before",
        fontSize: 28,
        fontWeight: "bold",
        color: destination ? "#1d4ed8" : "#c2410c",
        align: "center",
        verticalAlign: "middle"
      }
    };
  }

  return {
    ...base,
    type: "rect",
    props: {
      fill: destination ? "#93c5fd" : "#fdba74",
      stroke: "transparent",
      strokeWidth: 0,
      borderRadius: destination ? 20 : 4
    }
  };
}

function createImageSlide(index: number, src: string): Slide {
  return {
    slideId: `slide_image_cache_${index}`,
    order: index,
    title: `Image cache ${index}`,
    thumbnailUrl: "",
    estimatedSeconds: 60,
    style: {
      layout: "title-content",
      backgroundColor: "#ffffff",
      textColor: "#111827",
      accentColor: "#2563eb"
    },
    speakerNotes: "",
    elements: [
      {
        elementId: `el_image_cache_${index}`,
        type: "image",
        x: 160,
        y: 120,
        width: 1_600,
        height: 840,
        rotation: 0,
        opacity: 1,
        locked: false,
        props: {
          src,
          alt: `Slide image ${index}`,
          fit: "cover"
        }
      }
    ],
    keywords: [],
    animations: [],
    transition: { type: "fade", durationMs: 50 },
    aiNotes: { emphasisPoints: [], sourceEvidence: [] }
  };
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
