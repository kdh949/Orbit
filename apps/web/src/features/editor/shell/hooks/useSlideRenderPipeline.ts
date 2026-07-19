import type { Deck } from "@orbit/shared";
import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  waitForSlideFonts,
  type FontLoadResult
} from "../../../fonts/fontRegistry";
import { uploadProjectAsset } from "../../../projects/ProjectAssetWorkspace";
import { getDeckThumbnailRefreshSlideIds } from "../utils/deckState";
import {
  createSlideRenderFile,
  createSlideScopedUploadFile,
  normalizeDeckAssetUrls,
  waitForAnimationFrame,
  waitForSlideAssets
} from "../utils/slideRenderUtils";

export async function waitForSlideCaptureAssets(args: {
  deck: Deck;
  loadFonts?: typeof waitForSlideFonts;
  loadSlideAssets?: typeof waitForSlideAssets;
  slide: Deck["slides"][number];
  waitForFrame?: typeof waitForAnimationFrame;
}) {
  const loadFonts = args.loadFonts ?? waitForSlideFonts;
  const loadAssets = args.loadSlideAssets ?? waitForSlideAssets;
  const waitForFrame = args.waitForFrame ?? waitForAnimationFrame;
  const [fontResults, missingAssetCount] = await Promise.all([
    loadFonts(args.deck, args.slide),
    loadAssets(args.slide)
  ]);
  await waitForFrame();
  await waitForFrame();
  return {
    missingAssetCount,
    missingFontCount: (fontResults as FontLoadResult[]).filter(
      (result) => result.status === "failed"
    ).length
  };
}

export function useSlideRenderPipeline(args: {
  persistedDeck: Deck | undefined;
  projectId: string;
}) {
  const { persistedDeck, projectId } = args;
  const stageRefs = useRef(new Map<string, Konva.Stage>());
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastThumbnailDeckRef = useRef<Deck | null>(null);
  const thumbnailObjectUrlsRef = useRef(new Map<string, string>());
  const [renderingDeck, setRenderingDeck] = useState<Deck | null>(null);
  const [slideThumbnailUrls, setSlideThumbnailUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!persistedDeck) return;
    refreshChangedSlideThumbnails(persistedDeck);
  }, [persistedDeck]);

  useEffect(() => {
    return () => {
      for (const url of thumbnailObjectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      thumbnailObjectUrlsRef.current.clear();
      lastThumbnailDeckRef.current = null;
    };
  }, [projectId]);

  async function renderSlideFiles(
    sourceDeck: Deck,
    slideIds?: readonly string[]
  ) {
    if (sourceDeck.slides.length === 0) {
      return {
        files: new Map<string, File>(),
        missingAssetCount: 0,
        missingFontCount: 0
      };
    }

    const nextDeck = structuredClone(normalizeDeckAssetUrls(sourceDeck));
    const targetSlideIds = slideIds ? new Set(slideIds) : null;
    if (targetSlideIds?.size === 0) {
      return {
        files: new Map<string, File>(),
        missingAssetCount: 0,
        missingFontCount: 0
      };
    }

    const files = new Map<string, File>();
    let missingAssetCount = 0;
    let missingFontCount = 0;
    stageRefs.current.clear();
    flushSync(() => setRenderingDeck(nextDeck));
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    try {
      for (let index = 0; index < nextDeck.slides.length; index += 1) {
        const slide = nextDeck.slides[index];
        if (targetSlideIds && !targetSlideIds.has(slide.slideId)) continue;

        const prepared = await waitForSlideCaptureAssets({
          deck: nextDeck,
          slide
        });
        missingAssetCount += prepared.missingAssetCount;
        missingFontCount += prepared.missingFontCount;

        const stage = stageRefs.current.get(slide.slideId);
        if (!stage) {
          throw new Error("슬라이드 렌더링 스테이지를 찾지 못했습니다.");
        }

        files.set(
          slide.slideId,
          await createSlideRenderFile({
            deck: nextDeck,
            slide,
            stage,
            stageScale: 1,
            slideNumber: slide.order || index + 1
          })
        );
      }
    } finally {
      flushSync(() => setRenderingDeck(null));
      stageRefs.current.clear();
    }

    return { files, missingAssetCount, missingFontCount };
  }

  function enqueueSlideRender<T>(render: () => Promise<T>) {
    const result = renderQueueRef.current.then(render, render);
    renderQueueRef.current = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function syncSlideThumbnailCache(
    sourceDeck: Deck,
    slideIds?: readonly string[]
  ) {
    return enqueueSlideRender(async () => {
      const renderResult = await renderSlideFiles(sourceDeck, slideIds);
      const nextUrls = new Map(thumbnailObjectUrlsRef.current);
      const retiredUrls: string[] = [];
      const latestDeck = lastThumbnailDeckRef.current ?? sourceDeck;
      const staleSlideIds = new Set(
        getDeckThumbnailRefreshSlideIds(sourceDeck, latestDeck)
      );

      for (const [slideId, file] of renderResult.files) {
        if (
          staleSlideIds.has(slideId) ||
          !latestDeck.slides.some((slide) => slide.slideId === slideId)
        ) {
          continue;
        }
        const previousUrl = nextUrls.get(slideId);
        if (previousUrl) retiredUrls.push(previousUrl);
        nextUrls.set(slideId, URL.createObjectURL(file));
      }

      const currentSlideIds = new Set(latestDeck.slides.map((slide) => slide.slideId));
      for (const [slideId, url] of nextUrls) {
        if (!currentSlideIds.has(slideId)) {
          retiredUrls.push(url);
          nextUrls.delete(slideId);
        }
      }

      thumbnailObjectUrlsRef.current = nextUrls;
      flushSync(() => setSlideThumbnailUrls(Object.fromEntries(nextUrls)));
      for (const url of retiredUrls) URL.revokeObjectURL(url);
      return renderResult;
    });
  }

  function refreshChangedSlideThumbnails(nextDeck: Deck) {
    const previousDeck = lastThumbnailDeckRef.current;
    const slideIds = getDeckThumbnailRefreshSlideIds(previousDeck, nextDeck);
    const hasRemovedSlides = Boolean(
      previousDeck?.slides.some(
        (slide) =>
          !nextDeck.slides.some((candidate) => candidate.slideId === slide.slideId)
      )
    );
    lastThumbnailDeckRef.current = nextDeck;

    if (slideIds.length > 0 || hasRemovedSlides) {
      void syncSlideThumbnailCache(nextDeck, slideIds).catch(() => undefined);
    }
  }

  async function uploadRehearsalSlideSnapshots(
    activeProjectId: string,
    sourceDeck: Deck
  ) {
    return enqueueSlideRender(async () => {
      const renderResult = await renderSlideFiles(sourceDeck);
      const snapshots: Array<{ fileId: string; slideId: string }> = [];

      for (const slide of sourceDeck.slides) {
        const file = renderResult.files.get(slide.slideId);
        if (!file) continue;

        const uploaded = await uploadProjectAsset(
          activeProjectId,
          createSlideScopedUploadFile(file, slide.order, "thumbnail"),
          "rehearsal-slide-snapshot"
        );
        snapshots.push({ fileId: uploaded.fileId, slideId: slide.slideId });
      }

      return snapshots;
    });
  }

  return {
    refreshChangedSlideThumbnails,
    renderingDeck,
    slideThumbnailUrls,
    stageRefs,
    uploadRehearsalSlideSnapshots
  };
}
