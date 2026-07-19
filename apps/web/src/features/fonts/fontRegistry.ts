import {
  fontAssetCatalog,
  fontAssetCatalogByFamily,
  type FontAssetDefinition,
  type FontAssetFace,
} from "@orbit/font-assets";
import type { Deck, Slide } from "@orbit/shared";

export type FontLoadStatus = "failed" | "loaded" | "unsupported";
export type FontLoadResult = { family: string; status: FontLoadStatus };

type FontRequest = {
  family: string;
  style?: "italic" | "normal";
  text?: string;
  weight?: number;
};

const loadedFacePromises = new Map<string, Promise<FontFace>>();
const defaultKoreanSample = "한글 Aa 123";
const defaultLatinSample = "Aa 123";

export const supportedEditorFonts = fontAssetCatalog;

export function resolveWebFontFamily(family: string | undefined) {
  const normalized = family?.trim();
  if (!normalized) return '"Pretendard", Arial, sans-serif';
  const known = fontAssetCatalogByFamily.get(normalized);
  const primary = known?.family ?? normalized;
  const fallback = known?.category === "serif" ? "serif" : "sans-serif";
  return `${quoteFontFamily(primary)}, "Pretendard", Arial, ${fallback}`;
}

export async function ensureFontLoaded(
  request: FontRequest,
): Promise<FontLoadResult> {
  const definition = fontAssetCatalogByFamily.get(request.family.trim());
  if (!definition) return { family: request.family, status: "unsupported" };
  if (typeof FontFace === "undefined" || typeof document === "undefined") {
    return { family: definition.family, status: "loaded" };
  }

  const text = request.text ||
    (definition.supportsKorean ? defaultKoreanSample : defaultLatinSample);
  const faces = selectFontFaces(definition, {
    style: request.style ?? "normal",
    text,
    weight: request.weight ?? 400,
  });
  try {
    await Promise.all(faces.map((face) => loadFace(definition.family, face)));
    await document.fonts.load(
      `${request.style ?? "normal"} ${request.weight ?? 400} 16px ${quoteFontFamily(definition.family)}`,
      text,
    );
    return { family: definition.family, status: "loaded" };
  } catch {
    return { family: definition.family, status: "failed" };
  }
}

export async function waitForSlideFonts(deck: Deck, slide: Slide) {
  return Promise.all(collectSlideFontRequests(deck, slide).map(ensureFontLoaded));
}

export async function waitForDeckFonts(deck: Deck) {
  return (await Promise.all(
    deck.slides.map((slide) => waitForSlideFonts(deck, slide)),
  )).flat();
}

export function collectSlideFontRequests(deck: Deck, slide: Slide): FontRequest[] {
  const slideText = collectStringsByKey(slide, "text").join(" ") || defaultKoreanSample;
  const requests = new Map<string, FontRequest>();
  const fallbackFamilies = [
    deck.theme.typography.headingFontFamily,
    deck.theme.typography.bodyFontFamily,
    slide.style.fontFamily,
  ];
  for (const family of fallbackFamilies) {
    if (family) addFontRequest(requests, { family, text: slideText, weight: 400 });
  }
  collectObjectFontRequests(slide, slideText, requests);
  return [...requests.values()];
}

export function selectFontFaces(
  definition: FontAssetDefinition,
  request: Required<Pick<FontRequest, "style" | "text" | "weight">>,
) {
  const subsets = new Map<string, FontAssetFace[]>();
  for (const face of definition.faces.filter((item) => faceSupportsText(item, request.text))) {
    const candidates = subsets.get(face.subset) ?? [];
    candidates.push(face);
    subsets.set(face.subset, candidates);
  }
  return [...subsets.values()].flatMap((faces) => {
    const styled = faces.filter((face) => face.style === request.style);
    return [nearestWeightFace(styled.length ? styled : faces, request.weight)].filter(
      (face): face is FontAssetFace => Boolean(face),
    );
  });
}

function loadFace(family: string, face: FontAssetFace) {
  const cached = loadedFacePromises.get(face.filename);
  if (cached) return cached;
  const descriptors: FontFaceDescriptors = { style: face.style, weight: face.weight };
  if (face.unicodeRange) descriptors.unicodeRange = face.unicodeRange;
  const font = new FontFace(
    family,
    `url(${JSON.stringify(face.url)}) format(${JSON.stringify(face.format)})`,
    descriptors,
  );
  document.fonts.add(font);
  const promise = font.load();
  loadedFacePromises.set(face.filename, promise);
  return promise;
}

function faceSupportsText(face: FontAssetFace, text: string) {
  if (!face.unicodeRange) {
    if (face.subset === "latin") return /[\u0000-\u024f]/u.test(text);
    return true;
  }
  const ranges = parseUnicodeRange(face.unicodeRange);
  return Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
  });
}

function parseUnicodeRange(value: string) {
  const ranges: Array<[number, number]> = [];
  for (const part of value.split(",")) {
    const match = part.trim().match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/iu);
    if (!match) continue;
    ranges.push([
      Number.parseInt(match[1].replaceAll("?", "0"), 16),
      Number.parseInt((match[2] ?? match[1]).replaceAll("?", "F"), 16),
    ]);
  }
  return ranges;
}

function nearestWeightFace(faces: readonly FontAssetFace[], weight: number) {
  return [...faces].sort(
    (left, right) =>
      weightDistance(left.weight, weight) - weightDistance(right.weight, weight),
  )[0];
}

function weightDistance(range: string, weight: number) {
  const [minimum, maximum = minimum] = range.split(" ").map(Number);
  if (weight >= minimum && weight <= maximum) return 0;
  return Math.min(Math.abs(weight - minimum), Math.abs(weight - maximum));
}

function collectObjectFontRequests(
  value: unknown,
  slideText: string,
  requests: Map<string, FontRequest>,
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectObjectFontRequests(item, slideText, requests);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.fontFamily === "string") {
    addFontRequest(requests, {
      family: record.fontFamily,
      style: record.italic === true ? "italic" : "normal",
      text: slideText,
      weight: normalizeWeight(record.fontWeight),
    });
  }
  for (const child of Object.values(record)) {
    collectObjectFontRequests(child, slideText, requests);
  }
}

function addFontRequest(requests: Map<string, FontRequest>, request: FontRequest) {
  const key = `${request.family}:${request.weight ?? 400}:${request.style ?? "normal"}`;
  requests.set(key, request);
}

function normalizeWeight(value: unknown) {
  if (typeof value === "number") return value;
  if (value === "bold") return 700;
  if (value === "semibold") return 600;
  if (value === "medium") return 500;
  return 400;
}

function collectStringsByKey(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectStringsByKey(item, key));
  return Object.entries(value as Record<string, unknown>).flatMap(([entryKey, child]) =>
    entryKey === key && typeof child === "string"
      ? [child]
      : collectStringsByKey(child, key),
  );
}

function quoteFontFamily(family: string) {
  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function resetFontRegistryForTests() {
  loadedFacePromises.clear();
}
