import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useRehearsalPresentation } from "./useRehearsalPresentation";

describe("useRehearsalPresentation", () => {
  it("commits and resets slide position through synchronized refs", () => {
    let presentation: ReturnType<typeof useRehearsalPresentation> | null = null;

    function Harness() {
      presentation = useRehearsalPresentation({
        deck: null,
        initialSlideIndex: 2,
        initialStepIndex: 3,
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    presentation!.commitSlidePosition(4, 5);
    expect(presentation!.currentSlideIndexRef.current).toBe(4);
    expect(presentation!.presenterStepIndexRef.current).toBe(5);

    presentation!.resetSlideDisplayToBeginning();
    expect(presentation!.currentSlideIndexRef.current).toBe(0);
    expect(presentation!.presenterStepIndexRef.current).toBe(0);
  });
});
