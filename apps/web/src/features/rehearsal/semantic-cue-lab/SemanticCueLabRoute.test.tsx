import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SemanticCueLabRoute, isSemanticCueLabRouteEnabled } from "./SemanticCueLabRoute";

describe("SemanticCueLabRoute", () => {
  it("enables the route only for dev, test, or explicit flag", () => {
    expect(isSemanticCueLabRouteEnabled({ DEV: true, MODE: "development" })).toBe(true);
    expect(isSemanticCueLabRouteEnabled({ DEV: false, MODE: "test" })).toBe(true);
    expect(
      isSemanticCueLabRouteEnabled({ DEV: false, MODE: "production", VITE_SEMANTIC_CUE_LAB_ENABLED: "true" })
    ).toBe(true);
    expect(
      isSemanticCueLabRouteEnabled({ DEV: false, MODE: "production", VITE_SEMANTIC_CUE_LAB_ENABLED: true })
    ).toBe(true);
    expect(isSemanticCueLabRouteEnabled({ DEV: false, MODE: "production" })).toBe(false);
    expect(
      isSemanticCueLabRouteEnabled({ DEV: false, MODE: "production", VITE_SEMANTIC_CUE_LAB_ENABLED: "false" })
    ).toBe(false);
  });

  it("renders the lazy lab page behind a suspense fallback", () => {
    const html = renderToStaticMarkup(<SemanticCueLabRoute />);
    expect(html).toContain("Semantic Cue Lab");
  });
});
