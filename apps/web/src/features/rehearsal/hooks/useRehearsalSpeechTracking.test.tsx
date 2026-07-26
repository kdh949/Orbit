import { createDemoDeck } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyLiveTranscriptEvent } from "../../../runtime/speech/tracking/liveTranscriptAnalysis";
import { useRehearsalSpeechTracking } from "./useRehearsalSpeechTracking";

describe("useRehearsalSpeechTracking", () => {
  it("captures one transcript snapshot per active slide visit", () => {
    const deck = createDemoDeck();
    let tracking: ReturnType<typeof useRehearsalSpeechTracking> | null = null;

    function Harness() {
      tracking = useRehearsalSpeechTracking();
      return null;
    }

    renderToStaticMarkup(<Harness />);
    tracking!.resetSlideTranscriptSnapshots(deck, 0);
    tracking!.sessionTranscriptBufferRef.current = applyLiveTranscriptEvent(
      tracking!.sessionTranscriptBufferRef.current,
      {
        isFinal: true,
        transcript: "첫 번째 발표 문장",
      },
    );
    tracking!.captureSlideTranscriptSnapshot(
      "slide-change",
      "2026-07-26T00:00:01.000Z",
    );
    tracking!.captureSlideTranscriptSnapshot(
      "rehearsal-end",
      "2026-07-26T00:00:02.000Z",
    );

    expect(tracking!.getSlideTranscriptSnapshots()).toEqual([
      expect.objectContaining({
        reason: "slide-change",
        slideId: deck.slides[0]?.slideId,
        transcript: "첫 번째 발표 문장",
        visitedVer: 1,
      }),
    ]);
  });
});
