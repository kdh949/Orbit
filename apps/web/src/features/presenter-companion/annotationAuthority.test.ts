import { describe, expect, it } from "vitest";
import { AnnotationAuthority } from "./annotationAuthority";

describe("AnnotationAuthority", () => {
  it("returns an acknowledgement and authoritative snapshot", () => {
    const authority = new AnnotationAuthority("session_1", "epoch_1");
    const result = authority.consume(
      {
        sessionId: "session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        clientOperationId: "op_1",
        baseRevision: 0,
        sequence: 0,
        kind: "stroke-begin",
        strokeId: "stroke_1",
        tool: "pen",
        color: "ink-blue",
        width: 0.01,
        point: { x: 0.1, y: 0.2, pressure: 0.5, t: 0 },
      },
      "surface_1",
    );

    expect(result.acknowledgement).toMatchObject({
      accepted: true,
      reason: "accepted",
      surfaceRevision: 1,
    });
    expect(result.delta).not.toBeNull();
    expect(result.snapshot.strokes).toHaveLength(1);
  });

  it("rejects another epoch and never mutates the current surface", () => {
    const authority = new AnnotationAuthority("session_1", "epoch_2");
    const result = authority.consume(
      {
        sessionId: "session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        clientOperationId: "op_1",
        baseRevision: 0,
        sequence: 0,
        kind: "clear-surface",
      },
      "surface_1",
    );

    expect(result.acknowledgement).toMatchObject({
      accepted: false,
      reason: "not-authority",
    });
    expect(result.snapshot).toMatchObject({
      authorityEpochId: "epoch_2",
      surfaceRevision: 0,
      strokes: [],
    });
  });

  it("restores a slide surface within an epoch but starts empty in a new epoch", () => {
    const authority = new AnnotationAuthority("session_1", "epoch_1");
    authority.consume(
      {
        sessionId: "session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        clientOperationId: "op_1",
        baseRevision: 0,
        sequence: 0,
        kind: "stroke-begin",
        strokeId: "stroke_1",
        tool: "pen",
        color: "ink-red",
        width: 0.01,
        point: { x: 0.1, y: 0.2, pressure: 0.5, t: 0 },
      },
      "surface_1",
    );

    expect(authority.getSnapshot("surface_2").strokes).toEqual([]);
    expect(authority.getSnapshot("surface_1").strokes).toHaveLength(1);
    expect(
      new AnnotationAuthority("session_1", "epoch_2").getSnapshot(
        "surface_1",
      ).strokes,
    ).toEqual([]);
  });

  it("releases a finished share surface without clearing slide ink", () => {
    const authority = new AnnotationAuthority("session_1", "epoch_1");
    addStroke(authority, "surface_slide", "slide_stroke", 0);
    addStroke(authority, "surface_share_1", "share_stroke", 0);

    expect(authority.releaseSurface("surface_share_1")).toBe(true);
    expect(authority.getSnapshot("surface_share_1").strokes).toEqual(
      [],
    );
    expect(
      authority.getSnapshot("surface_slide").strokes.map(
        (stroke) => stroke.strokeId,
      ),
    ).toEqual(["slide_stroke"]);
  });
});

function addStroke(
  authority: AnnotationAuthority,
  surfaceId: string,
  strokeId: string,
  sequence: number,
) {
  authority.consume(
    {
      sessionId: "session_1",
      authorityEpochId: "epoch_1",
      surfaceId,
      clientOperationId: `op_${strokeId}`,
      baseRevision: 0,
      sequence,
      kind: "stroke-begin",
      strokeId,
      tool: "pen",
      color: "ink-blue",
      width: 0.01,
      point: { x: 0.5, y: 0.5, pressure: 0.5, t: 0 },
    },
    surfaceId,
  );
}
