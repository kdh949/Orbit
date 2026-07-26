import { describe, expect, it } from "vitest";

import { createActivitySlide } from "./activities";
import { sanitizeCommunityTemplate } from "./community-templates";
import { createDemoDeck } from "./fixtures";
import { deriveKeywordOccurrences } from "./keywords";
import { applyDeckPatch } from "./patches";
import { createSlidePlaybackState } from "./playback";
import { createTableOperationPatch } from "./table";
import { normalizeRichTextProps } from "./text";

describe("@orbit/editor-core subpath exports", () => {
  it("publishes focused editor capabilities through stable entrypoints", () => {
    expect(createActivitySlide).toBeDefined();
    expect(sanitizeCommunityTemplate).toBeDefined();
    expect(createDemoDeck).toBeDefined();
    expect(deriveKeywordOccurrences).toBeDefined();
    expect(applyDeckPatch).toBeDefined();
    expect(createSlidePlaybackState).toBeDefined();
    expect(createTableOperationPatch).toBeDefined();
    expect(normalizeRichTextProps).toBeDefined();
  });
});
