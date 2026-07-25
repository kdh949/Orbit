import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SemanticCueModePreview } from "./SemanticCueModePreview";
import { SemanticCueLabPage } from "./SemanticCueLabPage";
import { createSemanticCueLabFixtureDeck } from "./semanticCueLabFixtures";
import {
  createLabMockProvider,
  parseDeckInput,
  runLabEvaluation,
  type LabTranscriptSegment
} from "./semanticCueLabModel";

const deck = createSemanticCueLabFixtureDeck();
const distinctiveTranscript = "레지스터스택포인터로공간확보먼저기밀문장";

function segments(text: string): LabTranscriptSegment[] {
  return [{ text, isFinal: true, startMs: 0, endMs: 2000 }];
}

describe("SemanticCueLabPage", () => {
  it("rejects invalid deck JSON with a validation error", () => {
    expect(parseDeckInput("{ not json")).toMatchObject({ error: expect.stringContaining("JSON 파싱 실패") });

    const invalidDeck = parseDeckInput(JSON.stringify({ deckId: "deck_x", slides: [] }));
    expect(invalidDeck).toHaveProperty("error");

    const valid = parseDeckInput(JSON.stringify(deck));
    expect(valid).toHaveProperty("deck");
  });

  it("renders the deck and slide detail statically", () => {
    const html = renderToStaticMarkup(<SemanticCueLabPage initialDeck={deck} />);
    expect(html).toContain("Semantic Cue Lab");
    expect(html).toContain("scue_rsp_order");
    expect(html).toContain("RSP 공간 확보 순서");
    // the suggested cue must be visible in the slide inspector
    expect(html).toContain("suggested");
  });

  it("never exposes transcript in the live presenter preview", async () => {
    const result = await runLabEvaluation({
      deck,
      slideId: "slide_rsp",
      segments: segments(distinctiveTranscript),
      injections: [],
      provider: createLabMockProvider({ injections: [] }),
      nliEnabled: true
    });
    const html = renderToStaticMarkup(<SemanticCueModePreview result={result} />);
    expect(html).toContain("실전 발표자 화면");
    expect(html).toContain("청중 화면 비노출");
    // The presenter/audience previews must not leak the transcript text.
    const livePreviewStart = html.indexOf('data-testid="live-presenter-preview"');
    const livePreviewEnd = html.indexOf('data-testid="report-preview"');
    const livePreviewHtml = html.slice(livePreviewStart, livePreviewEnd);
    expect(livePreviewHtml).not.toContain(distinctiveTranscript);
    expect(html).not.toContain(distinctiveTranscript);
  });

  it("shows a presenter-only offline chip when STT is disabled", async () => {
    const result = await runLabEvaluation({
      deck,
      slideId: "slide_rsp",
      segments: segments(distinctiveTranscript),
      injections: ["stt_disabled"],
      provider: createLabMockProvider({ injections: ["stt_disabled"] }),
      nliEnabled: true
    });
    const html = renderToStaticMarkup(<SemanticCueModePreview result={result} />);
    // production capability copy for a user-disabled STT capability
    expect(html).toContain("음성 인식 꺼짐");
    expect(html).not.toContain(distinctiveTranscript);
  });
});
