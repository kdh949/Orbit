import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudienceAnnotationOverlay } from "./AudienceAnnotationOverlay";
import { p0AnimationDeck } from "./__fixtures__/animationDeck";

const snapshot = {
  sessionId: "session_1",
  authorityEpochId: "epoch_1",
  surfaceId: "surface_1",
  surfaceRevision: 2,
  strokes: [
    {
      strokeId: "stroke_1",
      tool: "pen" as const,
      color: "ink-blue" as const,
      width: 0.01,
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5, t: 0 },
        { x: 0.3, y: 0.4, pressure: 0.5, t: 1 },
      ],
    },
  ],
};

describe("AudienceAnnotationOverlay", () => {
  it("renders an accepted normalized stroke at the audience scale", () => {
    const html = renderToStaticMarkup(
      <AudienceAnnotationOverlay
        canvas={p0AnimationDeck.canvas}
        mode="slide"
        scale={0.5}
        snapshot={snapshot}
      />,
    );

    expect(html).toContain('aria-label="청중 주석"');
    expect(html).toContain('data-surface-revision="2"');
    expect(html).toContain('d="M 0.1 0.2 L 0.3 0.4"');
    expect(html).toContain('width="960"');
    expect(html).toContain('height="540"');
  });

  it("removes all annotation markup in black mode and with an empty snapshot", () => {
    expect(
      renderToStaticMarkup(
        <AudienceAnnotationOverlay
          canvas={p0AnimationDeck.canvas}
          mode="black"
          scale={1}
          snapshot={snapshot}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <AudienceAnnotationOverlay
          canvas={p0AnimationDeck.canvas}
          mode="slide"
          scale={1}
          snapshot={{ ...snapshot, strokes: [] }}
        />,
      ),
    ).toBe("");
  });

  it("renders an ephemeral laser without a persisted stroke and hides it in black mode", () => {
    const laser = {
      sessionId: "session_1",
      authorityEpochId: "epoch_1",
      surfaceId: "surface_1",
      sequence: 3,
      kind: "move" as const,
      x: 0.25,
      y: 0.75,
    };
    const emptySnapshot = { ...snapshot, strokes: [] };
    const html = renderToStaticMarkup(
      <AudienceAnnotationOverlay
        canvas={p0AnimationDeck.canvas}
        laser={laser}
        mode="slide"
        scale={1}
        snapshot={emptySnapshot}
      />,
    );

    expect(html).toContain("audience-laser-point");
    expect(html).toContain('cx="0.25"');
    expect(html).toContain('cy="0.75"');
    expect(
      renderToStaticMarkup(
        <AudienceAnnotationOverlay
          canvas={p0AnimationDeck.canvas}
          laser={laser}
          mode="black"
          scale={1}
          snapshot={emptySnapshot}
        />,
      ),
    ).toBe("");
  });

  it("places screen-share ink inside the source contain rect", () => {
    const html = renderToStaticMarkup(
      <AudienceAnnotationOverlay
        canvas={p0AnimationDeck.canvas}
        containerSize={{ height: 900, width: 1600 }}
        contentSize={{ height: 768, width: 1024 }}
        mode="screen-share"
        scale={1}
        snapshot={snapshot}
      />,
    );

    expect(html).toContain('width="1200"');
    expect(html).toContain('height="900"');
    expect(html).toContain("left:200px");
    expect(html).toContain("top:0");
    expect(html).toContain("transform:none");
  });
});
