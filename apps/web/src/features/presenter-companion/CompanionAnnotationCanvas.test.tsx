import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CompanionAnnotationCanvas,
  createCompanionStrokeStart,
} from "./CompanionAnnotationCanvas";

const output = {
  sessionId: "session_1",
  authorityEpochId: "epoch_1",
  outputRevision: 1,
  surfaceRevision: 0,
  surfaceId: "surface_1",
  outputMode: "slide" as const,
  slideId: "slide_1",
  slideIndex: 0,
  animationStep: 0,
};

describe("CompanionAnnotationCanvas", () => {
  it("renders touch canvas and disables tools while read-only", () => {
    const html = renderToStaticMarkup(
      <CompanionAnnotationCanvas
        annotation={null}
        canWrite
        connected={false}
        lastAcknowledgement={null}
        output={output}
        sendCommand={vi.fn()}
        sendLaser={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="iPad 주석 입력"');
    expect(html).toContain('aria-label="iPad 주석 도구"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("speakerNotes");
    expect(html).not.toContain("transcript");
  });

  it("removes drawing and toolbar surfaces in black mode", () => {
    const html = renderToStaticMarkup(
      <CompanionAnnotationCanvas
        annotation={null}
        canWrite
        connected
        lastAcknowledgement={null}
        output={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          outputRevision: 2,
          outputMode: "black",
          slideId: "slide_1",
          slideIndex: 0,
          animationStep: 0,
        }}
        sendCommand={vi.fn()}
        sendLaser={vi.fn()}
      />,
    );

    expect(html).toBe("");
  });

  it("limits screen-share pointer input to the source contain rect", () => {
    const html = renderToStaticMarkup(
      <CompanionAnnotationCanvas
        annotation={null}
        canWrite
        connected
        lastAcknowledgement={null}
        output={{
          ...output,
          outputMode: "screen-share",
          shareEpochId: "share_1",
        }}
        sendCommand={vi.fn()}
        sendLaser={vi.fn()}
        surfaceRect={{ height: 900, width: 1200, x: 200, y: 0 }}
      />,
    );

    expect(html).toContain('data-content-rect="contain"');
    expect(html).toContain("left:200px");
    expect(html).toContain("width:1200px");
    expect(html).toContain("height:900px");
  });

  it("uses the selected width for both the command and local echo", () => {
    const start = createCompanionStrokeStart({
      clientOperationId: "operation_1",
      color: "ink-yellow",
      point: { x: 0.25, y: 0.5, pressure: 0.8, t: 10 },
      strokeId: "stroke_1",
      tool: "highlighter",
      width: 0.05,
    });

    expect(start.command).toMatchObject({
      kind: "stroke-begin",
      width: 0.05,
    });
    expect(start.localStroke.width).toBe(0.05);
    expect(start.localStroke.points).toEqual([
      { x: 0.25, y: 0.5, pressure: 0.8, t: 10 },
    ]);
  });
});
