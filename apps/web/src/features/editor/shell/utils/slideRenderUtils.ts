import type { Deck, Slide } from "@orbit/shared/deck";
import type Konva from "konva";

import { getRenderableSlideElements } from "../../canvas/EditorCanvas";
import {
  normalizeEditorAssetUrl,
  resolveEditorAssetUrl
} from "../../shared/editorAssetUrl";
import { clampBackgroundOverlayOpacity } from "./editorLayout";

export function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function getSlideRenderBackgroundColor(slide: Slide, deck: Deck) {
  return slide.style.backgroundColor ?? deck.theme.backgroundColor;
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType = "image/png") {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("슬라이드 이미지를 생성하지 못했습니다."));
        return;
      }

      resolve(blob);
    }, mimeType);
  });
}

export async function createSlideRenderFile(args: {
  deck: Deck;
  slide: Slide;
  stage: Konva.Stage;
  stageScale: number;
  slideNumber: number;
}) {
  const pixelRatio = Math.max(1, 1 / args.stageScale);
  const stageCanvas = args.stage.toCanvas({ pixelRatio }) as HTMLCanvasElement;
  const canvas = document.createElement("canvas");
  canvas.width = args.deck.canvas.width;
  canvas.height = args.deck.canvas.height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("슬라이드 렌더링용 캔버스를 초기화하지 못했습니다.");
  }

  context.fillStyle = getSlideRenderBackgroundColor(args.slide, args.deck);
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (
    args.slide.thumbnailUrl &&
    (args.slide.importRenderMode === "snapshot" ||
      (getRenderableSlideElements(args.slide, args.deck.canvas).length === 0 &&
        (args.deck.metadata.sourceType === "import" ||
          args.deck.metadata.thumbnailSource === "import-render"))
    )
  ) {
    await drawSlideRenderFallbackImage(context, args.slide.thumbnailUrl, canvas);
  } else {
    await drawSlideRenderBackgroundImage(context, args.slide, canvas);
    context.drawImage(stageCanvas, 0, 0, canvas.width, canvas.height);
  }

  const blob = await canvasToBlob(canvas);

  return new File(
    [blob],
    `slide-${String(args.slideNumber).padStart(2, "0")}-thumbnail-v${args.deck.version}.png`,
    { type: "image/png" }
  );
}

async function drawSlideRenderFallbackImage(
  context: CanvasRenderingContext2D,
  imageUrl: string,
  canvas: HTMLCanvasElement
) {
  const image = await loadCanvasImage(imageUrl);
  if (!image) return;

  const frame = getBackgroundImageDrawFrame({
    canvasHeight: canvas.height,
    canvasWidth: canvas.width,
    fit: "contain",
    imageHeight: image.naturalHeight || image.height,
    imageWidth: image.naturalWidth || image.width
  });
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);
}

async function drawSlideRenderBackgroundImage(
  context: CanvasRenderingContext2D,
  slide: Slide,
  canvas: HTMLCanvasElement
) {
  const backgroundImage = slide.style.backgroundImage;

  if (!backgroundImage?.src) return;

  const image = await loadCanvasImage(backgroundImage.src);
  if (!image) return;

  const frame = getBackgroundImageDrawFrame({
    canvasHeight: canvas.height,
    canvasWidth: canvas.width,
    fit: backgroundImage.fit,
    imageHeight: image.naturalHeight || image.height,
    imageWidth: image.naturalWidth || image.width
  });

  context.save();
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);
  context.fillStyle = `rgba(255,255,255,${clampBackgroundOverlayOpacity(backgroundImage.opacity)})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

async function loadCanvasImage(url: string) {
  if (!url || typeof window === "undefined") return null;

  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = resolveEditorAssetUrl(url);

    if (image.complete && image.naturalWidth > 0) resolve(image);
  });
}

function getBackgroundImageDrawFrame(args: {
  canvasHeight: number;
  canvasWidth: number;
  fit: NonNullable<Slide["style"]["backgroundImage"]>["fit"];
  imageHeight: number;
  imageWidth: number;
}) {
  const { canvasHeight, canvasWidth, fit, imageHeight, imageWidth } = args;

  if (fit === "stretch" || imageWidth <= 0 || imageHeight <= 0) {
    return { height: canvasHeight, width: canvasWidth, x: 0, y: 0 };
  }

  const scale =
    fit === "contain"
      ? Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight)
      : Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    height,
    width,
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2
  };
}

async function loadImageAsset(url: string) {
  if (!url || typeof window === "undefined") return true;

  return new Promise<boolean>((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = resolveEditorAssetUrl(url);

    if (image.complete && image.naturalWidth > 0) resolve(true);
  });
}

function collectSlideAssetUrls(slide: Slide) {
  const urls = new Set<string>();

  if (slide.importRenderMode === "snapshot" && slide.thumbnailUrl) {
    return [slide.thumbnailUrl];
  }

  if (slide.style.backgroundImage?.src) {
    urls.add(slide.style.backgroundImage.src);
  }

  for (const element of slide.elements) {
    if (element.type === "image" && element.props.src) {
      urls.add(element.props.src);
    }
  }

  return [...urls];
}

export async function waitForSlideAssets(slide: Slide) {
  const assetUrls = collectSlideAssetUrls(slide);
  const results = await Promise.all(assetUrls.map((url) => loadImageAsset(url)));
  return results.filter((result) => !result).length;
}

export function normalizeDeckAssetUrls(deck: Deck) {
  return {
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      thumbnailUrl: slide.thumbnailUrl
        ? normalizeEditorAssetUrl(slide.thumbnailUrl)
        : slide.thumbnailUrl,
      style: slide.style.backgroundImage?.src
        ? {
            ...slide.style,
            backgroundImage: {
              ...slide.style.backgroundImage,
              src: normalizeEditorAssetUrl(slide.style.backgroundImage.src)
            }
          }
        : slide.style,
      elements: slide.elements.map((element) =>
        element.type === "image"
          ? {
              ...element,
              props: {
                ...element.props,
                src: normalizeEditorAssetUrl(element.props.src)
              }
            }
          : element
      )
    }))
  } satisfies Deck;
}

export function createSlideScopedUploadFile(
  file: File,
  slideNumber: number,
  kind: "image" | "thumbnail"
) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const label = kind === "thumbnail" ? "thumbnail" : "image";

  return new File(
    [file],
    `slide-${String(slideNumber).padStart(2, "0")}-${label}.${extension}`,
    { type: file.type, lastModified: file.lastModified }
  );
}
