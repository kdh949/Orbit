import type { PresentationCompanionOutputState } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  consumeCompanionOutputState,
  consumeCompanionAnnotationSnapshot,
  createCompanionAnnotationCommand,
  type CompanionOutputCursor,
} from "./useCompanionSocket";

describe("consumeCompanionOutputState", () => {
  it("ignores duplicate and lower output revisions", () => {
    const current = output(4);
    const cursor: CompanionOutputCursor = {
      output: current,
      snapshotPending: false,
    };

    expect(consumeCompanionOutputState(cursor, output(3))).toEqual({
      cursor,
      requestSnapshot: false,
    });
    expect(consumeCompanionOutputState(cursor, output(4))).toEqual({
      cursor,
      requestSnapshot: false,
    });
  });

  it("accepts the next revision and requests a snapshot for a gap", () => {
    const cursor: CompanionOutputCursor = {
      output: output(4),
      snapshotPending: false,
    };

    expect(
      consumeCompanionOutputState(cursor, output(5)).cursor.output
        ?.outputRevision,
    ).toBe(5);
    expect(consumeCompanionOutputState(cursor, output(7))).toEqual({
      cursor: { ...cursor, snapshotPending: true },
      requestSnapshot: true,
    });
  });

  it("accepts the authoritative state returned after a gap", () => {
    const cursor: CompanionOutputCursor = {
      output: output(4),
      snapshotPending: true,
    };

    expect(consumeCompanionOutputState(cursor, output(9))).toEqual({
      cursor: {
        output: output(9),
        snapshotPending: false,
      },
      requestSnapshot: false,
    });
  });

  it("accepts a complete black output across a revision gap without requesting a surface snapshot", () => {
    const cursor: CompanionOutputCursor = {
      output: output(4),
      snapshotPending: false,
    };
    const blackOutput: PresentationCompanionOutputState = {
      sessionId: "session_1",
      authorityEpochId: "epoch_1",
      outputRevision: 7,
      outputMode: "black",
      slideId: "slide_1",
      slideIndex: 0,
      animationStep: 0,
    };

    expect(consumeCompanionOutputState(cursor, blackOutput)).toEqual({
      cursor: { output: blackOutput, snapshotPending: false },
      requestSnapshot: false,
    });
  });

  it("resets the revision cursor for a new authority epoch", () => {
    const cursor: CompanionOutputCursor = {
      output: output(20),
      snapshotPending: false,
    };

    expect(
      consumeCompanionOutputState(cursor, {
        ...output(0),
        authorityEpochId: "epoch_2",
      }).cursor.output,
    ).toMatchObject({
      authorityEpochId: "epoch_2",
      outputRevision: 0,
    });
  });
});

describe("consumeCompanionAnnotationSnapshot", () => {
  const current = {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    surfaceId: "surface_1",
    surfaceRevision: 3,
    strokes: [],
  };

  it("ignores another authority, surface, and lower revision", () => {
    expect(
      consumeCompanionAnnotationSnapshot({
        authorityEpochId: "epoch_1",
        current,
        incoming: { ...current, authorityEpochId: "epoch_2" },
        surfaceId: "surface_1",
      }),
    ).toBe(current);
    expect(
      consumeCompanionAnnotationSnapshot({
        authorityEpochId: "epoch_1",
        current,
        incoming: { ...current, surfaceId: "surface_2" },
        surfaceId: "surface_1",
      }),
    ).toBe(current);
    expect(
      consumeCompanionAnnotationSnapshot({
        authorityEpochId: "epoch_1",
        current,
        incoming: { ...current, surfaceRevision: 2 },
        surfaceId: "surface_1",
      }),
    ).toBe(current);
  });

  it("accepts an authoritative correction snapshot", () => {
    const incoming = { ...current, surfaceRevision: 5 };
    expect(
      consumeCompanionAnnotationSnapshot({
        authorityEpochId: "epoch_1",
        current,
        incoming,
        surfaceId: "surface_1",
      }),
    ).toBe(incoming);
  });
});

describe("createCompanionAnnotationCommand", () => {
  it("adds the authoritative socket metadata and validates the command", () => {
    expect(
      createCompanionAnnotationCommand(
        {
          kind: "clear-surface",
          clientOperationId: "op_1",
        },
        {
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          surfaceId: "surface_1",
          baseRevision: 3,
          sequence: 4,
        },
      ),
    ).toMatchObject({
      kind: "clear-surface",
      baseRevision: 3,
      sequence: 4,
    });
  });

  it("rejects an invalid opaque operation id before socket emission", () => {
    expect(
      createCompanionAnnotationCommand(
        {
          kind: "undo",
          clientOperationId: "invalid operation id",
        },
        {
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          surfaceId: "surface_1",
          baseRevision: 0,
          sequence: 0,
        },
      ),
    ).toBeNull();
  });
});

function output(
  outputRevision: number,
): PresentationCompanionOutputState {
  return {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    outputRevision,
    surfaceRevision: 0,
    surfaceId: "surface_1",
    outputMode: "slide",
    slideId: "slide_1",
    slideIndex: 0,
    animationStep: 0,
  };
}
