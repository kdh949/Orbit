export type NormalizedPronunciationText = {
  boundaryText: string;
  compactText: string;
};

type NormalizedPronunciationTextWithMap = NormalizedPronunciationText & {
  compactMap: Array<{ start: number; end: number }>;
};

const separatorPattern = /[\s./_+#\-]+/u;

export function normalizePronunciationText(
  text: string,
): NormalizedPronunciationText {
  const normalized = normalizePronunciationTextWithMap(text);
  return {
    boundaryText: normalized.boundaryText,
    compactText: normalized.compactText,
  };
}

export function normalizePronunciationTextWithMap(
  text: string,
): NormalizedPronunciationTextWithMap {
  const boundaryParts: string[] = [];
  const compactParts: string[] = [];
  const compactMap: Array<{ start: number; end: number }> = [];
  let previousWasSeparator = true;
  let sourceIndex = 0;

  for (const sourceCharacter of text) {
    const sourceStart = sourceIndex;
    sourceIndex += sourceCharacter.length;
    const normalizedCharacter = sourceCharacter
      .normalize("NFKC")
      .toLocaleLowerCase("en-US");

    for (const character of normalizedCharacter) {
      if (separatorPattern.test(character)) {
        if (!previousWasSeparator && boundaryParts.length > 0) {
          boundaryParts.push(" ");
        }
        previousWasSeparator = true;
        continue;
      }

      boundaryParts.push(character);
      compactParts.push(character);
      compactMap.push({ start: sourceStart, end: sourceIndex });
      previousWasSeparator = false;
    }
  }

  return {
    boundaryText: boundaryParts.join("").trim(),
    compactText: compactParts.join(""),
    compactMap,
  };
}
