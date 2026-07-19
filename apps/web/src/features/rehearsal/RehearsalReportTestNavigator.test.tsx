import { createDemoDeck } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RehearsalReportTestNavigator } from "./RehearsalReportTestNavigator";

describe("RehearsalReportTestNavigator", () => {
  it("places the overall item before every slide when there are more than eight slides", () => {
    const baseDeck = createDemoDeck();
    const sourceSlide = baseDeck.slides[0]!;
    const deck = {
      ...baseDeck,
      slides: Array.from({ length: 9 }, (_, index) => ({
        ...sourceSlide,
        order: index + 1,
        slideId: `slide_${index + 1}`,
        title: `슬라이드 ${index + 1}`,
      })),
    };

    const html = renderToStaticMarkup(
      <RehearsalReportTestNavigator
        deck={deck}
        onSelect={vi.fn()}
        selectedSlideId={null}
      />,
    );

    expect(html.indexOf(">전체<")).toBeLessThan(
      html.indexOf('aria-label="1번 슬라이드'),
    );
    expect(html).toContain("9장 한눈에 보기");
    expect(html).toContain('aria-label="9번 슬라이드 슬라이드 9"');
    expect(html).toContain(
      'class="rrd-test-filmstrip-all is-selected" aria-current="true"',
    );
  });

  it("keeps a short deck as a natural list without placeholder items", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportTestNavigator
        deck={deck}
        onSelect={vi.fn()}
        selectedSlideId={deck.slides[0]?.slideId ?? null}
      />,
    );

    expect(html).toContain(`${deck.slides.length}장 한눈에 보기`);
    expect(html).not.toContain("더보기");
    expect(html).not.toContain("placeholder");
  });
});
