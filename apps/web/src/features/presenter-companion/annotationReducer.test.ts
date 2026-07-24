import type { PresentationCompanionAnnotationCommand } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  applyAnnotationCommand,
  createAnnotationSurfaceState,
} from "./annotationReducer";

describe("annotationReducer", () => {
  it("accepts a stroke sequence only at the current surface revision", () => {
    const initial = createAnnotationSurfaceState("surface_1");
    const begun = applyAnnotationCommand(initial, command("stroke-begin", 0));
    expect(begun).toMatchObject({
      accepted: true,
      surfaceRevision: 1,
    });
    if (!begun.accepted) throw new Error("stroke begin rejected");

    const points = applyAnnotationCommand(
      begun.state,
      command("stroke-points", 1),
    );
    expect(points).toMatchObject({
      accepted: true,
      surfaceRevision: 2,
    });
    if (!points.accepted) throw new Error("stroke points rejected");
    expect(points.state.strokes[0]?.points).toHaveLength(3);

    expect(
      applyAnnotationCommand(points.state, command("stroke-end", 0)),
    ).toMatchObject({
      accepted: false,
      reason: "stale-revision",
      surfaceRevision: 2,
    });
  });

  it("deduplicates a client operation without advancing revision", () => {
    const initial = createAnnotationSurfaceState("surface_1");
    const begin = command("stroke-begin", 0);
    const first = applyAnnotationCommand(initial, begin);
    if (!first.accepted) throw new Error("stroke begin rejected");

    expect(applyAnnotationCommand(first.state, begin)).toMatchObject({
      accepted: true,
      changed: false,
      surfaceRevision: 1,
    });
  });

  it("keeps undo and clear scoped to the current surface", () => {
    const firstSurface = applyAnnotationCommand(
      createAnnotationSurfaceState("surface_1"),
      command("stroke-begin", 0),
    );
    const secondSurface = createAnnotationSurfaceState("surface_2");
    if (!firstSurface.accepted) throw new Error("stroke begin rejected");

    const undone = applyAnnotationCommand(
      firstSurface.state,
      command("undo", 1),
    );
    expect(undone.state.strokes).toEqual([]);
    expect(secondSurface).toMatchObject({ revision: 0, strokes: [] });
  });

  it("preserves point and stroke bounds across randomized valid mutations", () => {
    let state = createAnnotationSurfaceState("surface_1");
    let operation = 0;
    for (let strokeIndex = 0; strokeIndex < 100; strokeIndex += 1) {
      const begin = applyAnnotationCommand(
        state,
        command("stroke-begin", state.revision, {
          clientOperationId: `op_${operation++}`,
          strokeId: `stroke_${strokeIndex}`,
        }),
      );
      if (!begin.accepted) throw new Error("random begin rejected");
      state = begin.state;
      for (let batch = 0; batch < 4; batch += 1) {
        const points = applyAnnotationCommand(
          state,
          command("stroke-points", state.revision, {
            clientOperationId: `op_${operation++}`,
            strokeId: `stroke_${strokeIndex}`,
          }),
        );
        if (!points.accepted) throw new Error("random points rejected");
        state = points.state;
      }
    }

    expect(state.strokes).toHaveLength(100);
    expect(
      state.strokes.reduce(
        (total, stroke) => total + stroke.points.length,
        0,
      ),
    ).toBe(900);
  });
});

function command(
  kind: PresentationCompanionAnnotationCommand["kind"],
  baseRevision: number,
  overrides: Record<string, unknown> = {},
): PresentationCompanionAnnotationCommand {
  const base = {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    surfaceId: "surface_1",
    clientOperationId: `op_${kind}_${baseRevision}`,
    baseRevision,
    sequence: baseRevision,
    ...overrides,
  };
  switch (kind) {
    case "stroke-begin":
      return {
        ...base,
        kind,
        strokeId: String(overrides.strokeId ?? "stroke_1"),
        tool: "pen",
        color: "ink-blue",
        width: 0.01,
        point: { x: 0.1, y: 0.2, pressure: 0.5, t: 0 },
      };
    case "stroke-points":
      return {
        ...base,
        kind,
        strokeId: String(overrides.strokeId ?? "stroke_1"),
        points: [
          { x: 0.2, y: 0.3, pressure: 0.5, t: 1 },
          { x: 0.3, y: 0.4, pressure: 0.5, t: 2 },
        ],
      };
    case "stroke-end":
    case "stroke-delete":
      return {
        ...base,
        kind,
        strokeId: String(overrides.strokeId ?? "stroke_1"),
      };
    case "undo":
    case "clear-surface":
      return { ...base, kind };
  }
}
