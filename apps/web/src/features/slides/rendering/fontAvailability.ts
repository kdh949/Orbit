import {
  generateDeckFontCatalog,
  type Deck,
  type Slide,
} from "@orbit/shared/deck";

export type ImportedFontAvailabilityDiagnostic = {
  affectedSlideCount: number;
  fallbackFamily: string;
  fontFamily: string;
};

type FontAvailabilityOptions = {
  declaredFamilies?: Iterable<string>;
  fontFaceSet?: Pick<FontFaceSet, "check">;
};

const browserFallbackFamilies = new Set([
  "arial",
  "monospace",
  "sans-serif",
  "serif"
]);

export function diagnoseImportedDeckFonts(
  deck: Deck,
  options: FontAvailabilityOptions = {}
): ImportedFontAvailabilityDiagnostic[] {
  const fontFaceSet =
    options.fontFaceSet ??
    (typeof document === "undefined" ? undefined : document.fonts);
  const declaredFamilies = new Set(
    [...(options.declaredFamilies ?? browserDeclaredFontFamilies())].map(
      normalizeDeclaredFamily
    )
  );
  const affectedSlidesByFamily = new Map<string, Set<string>>();

  for (const slide of deck.slides) {
    for (const family of collectSlideFontFamilies(deck, slide)) {
      if (isFontAvailable(family, fontFaceSet, declaredFamilies)) continue;
      const slides = affectedSlidesByFamily.get(family) ?? new Set<string>();
      slides.add(slide.slideId);
      affectedSlidesByFamily.set(family, slides);
    }
  }

  return [...affectedSlidesByFamily.entries()]
    .map(([fontFamily, slideIds]) => ({
      affectedSlideCount: slideIds.size,
      fallbackFamily: fallbackFamilyFor(fontFamily),
      fontFamily
    }))
    .sort((left, right) => left.fontFamily.localeCompare(right.fontFamily));
}

function collectSlideFontFamilies(deck: Deck, slide: Slide) {
  const families = new Set<string>();
  const fallbackFamily =
    slide.style.fontFamily ?? deck.theme.fontFamily ?? deck.theme.typography.bodyFontFamily;

  for (const element of slide.elements) {
    if (element.type === "text") {
      families.add(primaryFontFamily(element.props.fontFamily ?? fallbackFamily));
      for (const run of element.props.runs ?? []) {
        families.add(primaryFontFamily(run.fontFamily ?? fallbackFamily));
      }
      for (const paragraph of element.props.paragraphs ?? []) {
        families.add(primaryFontFamily(paragraph.fontFamily ?? fallbackFamily));
        for (const run of paragraph.runs ?? []) {
          families.add(primaryFontFamily(run.fontFamily ?? fallbackFamily));
        }
      }
    }
    if (element.type === "table") {
      for (const row of element.props.rows) {
        for (const cell of row) {
          families.add(primaryFontFamily(cell.fontFamily ?? fallbackFamily));
        }
      }
    }
  }

  families.delete("");
  return families;
}

function isFontAvailable(
  fontFamily: string,
  fontFaceSet: Pick<FontFaceSet, "check"> | undefined,
  declaredFamilies: Set<string>
) {
  const normalized = fontFamily.toLocaleLowerCase();
  if (browserFallbackFamilies.has(normalized)) return true;
  if (!fontFaceSet || !declaredFamilies.has(normalized)) return false;
  const escapedFamily = fontFamily.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return fontFaceSet.check(`400 16px "${escapedFamily}"`, "가나다 Orbit");
}

function browserDeclaredFontFamilies() {
  if (typeof document === "undefined") return [];
  return [...document.fonts].map((face) => normalizeDeclaredFamily(face.family));
}

function normalizeDeclaredFamily(family: string) {
  return family.replaceAll('"', "").trim().toLocaleLowerCase();
}

function primaryFontFamily(fontFamily: string) {
  return fontFamily.split(",", 1)[0]?.replaceAll('"', "").trim() ?? "";
}

function fallbackFamilyFor(fontFamily: string) {
  const catalogFont = generateDeckFontCatalog.find(
    (font) =>
      font.name === fontFamily ||
      font.headingFontFamily === fontFamily ||
      font.bodyFontFamily === fontFamily
  );
  return catalogFont?.fallbackFamily ?? "Arial";
}
