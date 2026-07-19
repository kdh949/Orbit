import { createDemoDeck } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PrintDeckView } from "./PrintDeckView";

vi.mock("../../../slides/rendering/ReadOnlySlideCanvas", () => ({
  ReadOnlySlideCanvas: (props: {
    interactive: boolean;
    renderPixelRatio: number;
  }) => (
    <div
      data-interactive={String(props.interactive)}
      data-pixel-ratio={props.renderPixelRatio}
    />
  ),
}));

describe("PrintDeckView", () => {
  it("renders every slide with a DPR 1 non-interactive canvas", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <PrintDeckView deck={deck} onReady={vi.fn()} />,
    );

    expect(html.match(/class="editor-print-slide"/g)).toHaveLength(
      deck.slides.length,
    );
    expect(html.match(/data-pixel-ratio="1"/g)).toHaveLength(
      deck.slides.length,
    );
    expect(html).not.toContain('data-interactive="true"');
  });
});
