import type { Deck, Slide } from "@orbit/shared";
import { resolveEditorAssetUrl } from "../../editor/shared/editorAssetUrl";

export type SlideImagePriority = "high" | "low";

type SlideImageEntry = {
  image: HTMLImageElement;
  promise: Promise<HTMLImageElement>;
  ready: boolean;
};

type SlideImageCacheOptions = {
  createImage?: () => HTMLImageElement;
};

export type SlideAssetPreparationResult = {
  failedUrls: string[];
  loadedUrls: string[];
  timedOut: boolean;
};

const slideAssetPreparationTimeoutMs = 3_000;

export function createSlideImageCache(options: SlideImageCacheOptions = {}) {
  const projects = new Map<string, Map<string, SlideImageEntry>>();
  const createImage =
    options.createImage ??
    (() => {
      if (typeof window === "undefined") {
        throw new Error("Slide images can only be loaded in a browser.");
      }
      return new window.Image();
    });

  function getProject(projectId: string) {
    let project = projects.get(projectId);
    if (!project) {
      project = new Map();
      projects.set(projectId, project);
    }
    return project;
  }

  function load(projectId: string, src: string, priority: SlideImagePriority) {
    const project = getProject(projectId);
    const existing = project.get(src);
    if (existing) {
      if (priority === "high") {
        existing.image.fetchPriority = "high";
      }
      return existing.promise;
    }

    const image = createImage();
    image.decoding = "async";
    image.fetchPriority = priority;

    let resolvePromise!: (image: HTMLImageElement) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry: SlideImageEntry = { image, promise, ready: false };
    project.set(src, entry);

    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      if (project.get(src) === entry) {
        project.delete(src);
      }
      rejectPromise(new Error(`Failed to load slide image: ${src}`));
    };

    const finish = async () => {
      if (settled) return;
      settled = true;
      try {
        if (typeof image.decode === "function") {
          await image.decode();
        }
        entry.ready = true;
        resolvePromise(image);
      } catch {
        if (image.naturalWidth > 0) {
          entry.ready = true;
          resolvePromise(image);
          return;
        }
        if (project.get(src) === entry) {
          project.delete(src);
        }
        rejectPromise(new Error(`Failed to decode slide image: ${src}`));
      }
    };

    image.onload = () => {
      void finish();
    };
    image.onerror = fail;
    image.src = src;

    if (image.complete && image.naturalWidth > 0) {
      void finish();
    }
    return promise;
  }

  return {
    clearProject(projectId: string) {
      projects.delete(projectId);
    },
    getReady(projectId: string, src: string) {
      const entry = projects.get(projectId)?.get(src);
      return entry?.ready ? entry.image : null;
    },
    has(projectId: string, src: string) {
      return projects.get(projectId)?.has(src) ?? false;
    },
    load,
    retain(projectId: string, retainedUrls: Set<string>) {
      const project = projects.get(projectId);
      if (!project) return;
      for (const src of project.keys()) {
        if (!retainedUrls.has(src)) {
          project.delete(src);
        }
      }
      if (project.size === 0) {
        projects.delete(projectId);
      }
    }
  };
}

const sharedSlideImageCache = createSlideImageCache();

export function collectSlideAssetUrls(_deck: Deck, slide: Slide) {
  const urls = new Set<string>();

  if (slide.elements.length === 0 && slide.thumbnailUrl) {
    return [resolveEditorAssetUrl(slide.thumbnailUrl)];
  }

  const backgroundSrc = slide.style.backgroundImage?.src;
  if (backgroundSrc) {
    urls.add(resolveEditorAssetUrl(backgroundSrc));
  }

  for (const element of slide.elements) {
    if (element.type !== "image" && element.type !== "svg") continue;
    if (element.props.src) {
      urls.add(resolveEditorAssetUrl(element.props.src));
    }
  }

  return [...urls];
}

export function getReadySlideImage(projectId: string, src: string) {
  return sharedSlideImageCache.getReady(projectId, src);
}

export function loadSlideImage(
  projectId: string,
  src: string,
  priority: SlideImagePriority
) {
  return sharedSlideImageCache.load(projectId, src, priority);
}

export async function preloadSlideAssets(
  deck: Deck,
  slide: Slide,
  priority: SlideImagePriority,
  cache = sharedSlideImageCache
): Promise<SlideAssetPreparationResult> {
  const urls = collectSlideAssetUrls(deck, slide);
  const settled = await Promise.allSettled(
    urls.map((url) => cache.load(deck.projectId, url, priority))
  );
  const loadedUrls: string[] = [];
  const failedUrls: string[] = [];

  settled.forEach((result, index) => {
    const url = urls[index];
    if (!url) return;
    if (result.status === "fulfilled") loadedUrls.push(url);
    else failedUrls.push(url);
  });

  return { failedUrls, loadedUrls, timedOut: false };
}

export async function prepareSlideAssets(
  deck: Deck,
  slide: Slide,
  timeoutMs = slideAssetPreparationTimeoutMs,
  cache = sharedSlideImageCache
): Promise<SlideAssetPreparationResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<SlideAssetPreparationResult>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve({ failedUrls: [], loadedUrls: [], timedOut: true }),
      timeoutMs
    );
  });

  const result = await Promise.race([
    preloadSlideAssets(deck, slide, "high", cache),
    timeout
  ]);
  if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  return result;
}

export function retainSlideAssetWindow(deck: Deck, currentSlideIndex: number) {
  const retainedUrls = new Set<string>();
  for (
    let index = Math.max(0, currentSlideIndex - 1);
    index <= Math.min(deck.slides.length - 1, currentSlideIndex + 1);
    index += 1
  ) {
    const slide = deck.slides[index];
    if (!slide) continue;
    collectSlideAssetUrls(deck, slide).forEach((url) => retainedUrls.add(url));
  }
  sharedSlideImageCache.retain(deck.projectId, retainedUrls);
}

export function clearProjectSlideImageCache(projectId: string) {
  sharedSlideImageCache.clearProject(projectId);
}
