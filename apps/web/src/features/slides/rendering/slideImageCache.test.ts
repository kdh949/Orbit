import { createDemoDeck } from "@orbit/editor-core";
import { describe, expect, it, vi } from "vitest";
import {
  collectSlideAssetUrls,
  createSlideImageCache,
  preloadSlideAssets,
  prepareSlideAssets
} from "./slideImageCache";

class FakeImage {
  complete = false;
  decoding: "async" | "auto" | "sync" = "auto";
  fetchPriority: "high" | "low" | "auto" = "auto";
  naturalHeight = 0;
  naturalWidth = 0;
  onerror: ((event: Event | string) => void) | null = null;
  onload: (() => void) | null = null;
  private value = "";

  readonly decode = vi.fn(async () => undefined);

  get src() {
    return this.value;
  }

  set src(value: string) {
    this.value = value;
  }

  resolve() {
    this.complete = true;
    this.naturalHeight = 100;
    this.naturalWidth = 100;
    this.onload?.();
  }

  reject() {
    this.onerror?.("load failed");
  }
}

function createHarness() {
  const images: FakeImage[] = [];
  const cache = createSlideImageCache({
    createImage: () => {
      const image = new FakeImage();
      images.push(image);
      return image as unknown as HTMLImageElement;
    }
  });

  return { cache, images };
}

describe("slideImageCache", () => {
  it("deduplicates concurrent loads and promotes an existing request to high priority", async () => {
    const { cache, images } = createHarness();

    const lowPriority = cache.load("project-1", "/asset.png", "low");
    const highPriority = cache.load("project-1", "/asset.png", "high");

    expect(images).toHaveLength(1);
    expect(images[0]?.fetchPriority).toBe("high");

    images[0]?.resolve();

    await expect(lowPriority).resolves.toBe(images[0]);
    await expect(highPriority).resolves.toBe(images[0]);
    expect(images[0]?.decode).toHaveBeenCalledOnce();
    expect(cache.getReady("project-1", "/asset.png")).toBe(images[0]);
  });

  it("evicts failed entries so a later request can retry", async () => {
    const { cache, images } = createHarness();

    const failed = cache.load("project-1", "/asset.png", "high");
    images[0]?.reject();
    await expect(failed).rejects.toThrow("Failed to load slide image");

    const retried = cache.load("project-1", "/asset.png", "high");
    expect(images).toHaveLength(2);
    images[1]?.resolve();
    await expect(retried).resolves.toBe(images[1]);
  });

  it("retains only the requested slide window and clears a project cache", async () => {
    const { cache, images } = createHarness();
    const loaded = ["/previous.png", "/current.png", "/next.png"].map((src) =>
      cache.load("project-1", src, "low")
    );
    images.forEach((image) => image.resolve());
    await Promise.all(loaded);

    cache.retain("project-1", new Set(["/current.png", "/next.png"]));

    expect(cache.has("project-1", "/previous.png")).toBe(false);
    expect(cache.has("project-1", "/current.png")).toBe(true);
    expect(cache.has("project-1", "/next.png")).toBe(true);

    cache.clearProject("project-1");
    expect(cache.has("project-1", "/current.png")).toBe(false);
    expect(cache.has("project-1", "/next.png")).toBe(false);
  });

  it("reports failed assets so navigation can continue with a placeholder", async () => {
    const { cache, images } = createHarness();
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      elements: [],
      thumbnailUrl: "/failed-thumbnail.png"
    };

    const preparation = preloadSlideAssets(deck, slide, "high", cache);
    images[0]?.reject();

    await expect(preparation).resolves.toEqual({
      failedUrls: ["/failed-thumbnail.png"],
      loadedUrls: [],
      timedOut: false
    });
  });

  it("stops waiting after the preparation timeout", async () => {
    const { cache } = createHarness();
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      elements: [],
      thumbnailUrl: "/slow-thumbnail.png"
    };

    await expect(
      prepareSlideAssets(deck, slide, 10, cache)
    ).resolves.toEqual({
      failedUrls: [],
      loadedUrls: [],
      timedOut: true
    });
  });
});

describe("collectSlideAssetUrls", () => {
  it("collects and deduplicates image, svg, and background assets", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      thumbnailUrl: "/thumbnail.png",
      style: {
        ...deck.slides[0]!.style,
        backgroundImage: {
          src: "/shared.png",
          alt: "background",
          fit: "cover" as const,
          opacity: 1
        }
      },
      elements: [
        {
          elementId: "image-1",
          type: "image" as const,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          locked: false,
          visible: true,
          zIndex: 1,
          props: {
            src: "/shared.png",
            alt: "shared",
            fit: "contain" as const,
            focusX: 0.5,
            focusY: 0.5
          }
        },
        {
          elementId: "svg-1",
          type: "svg" as const,
          x: 100,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          locked: false,
          visible: true,
          zIndex: 2,
          props: {
            src: "/diagram.svg",
            alt: "diagram",
            fit: "contain" as const,
            focusX: 0.5,
            focusY: 0.5
          }
        }
      ]
    };

    expect(collectSlideAssetUrls({ ...deck, slides: [slide] }, slide)).toEqual([
      "/shared.png",
      "/diagram.svg"
    ]);
  });

  it("uses the thumbnail only when the slide has no renderable elements", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      elements: [],
      thumbnailUrl: "/thumbnail.png"
    };

    expect(collectSlideAssetUrls({ ...deck, slides: [slide] }, slide)).toEqual([
      "/thumbnail.png"
    ]);
  });
});
