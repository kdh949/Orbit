import {
  presentationCompanionAnnotationSnapshotSchema,
  presentationCompanionMaxSurfacePoints,
  presentationCompanionMaxSurfaceStrokes,
  presentationCompanionMaxStrokePoints,
  type PresentationCompanionAnnotationCommand,
  type PresentationCompanionAnnotationSnapshot,
  type PresentationCompanionStroke,
} from "@orbit/shared";

export type AnnotationSurfaceState = {
  appliedOperations: Record<string, number>;
  revision: number;
  strokes: PresentationCompanionStroke[];
  surfaceId: string;
};

export type AnnotationCommandResult =
  | {
      accepted: true;
      changed: boolean;
      state: AnnotationSurfaceState;
      surfaceRevision: number;
    }
  | {
      accepted: false;
      reason: "invalid-surface" | "limit-exceeded" | "stale-revision";
      state: AnnotationSurfaceState;
      surfaceRevision: number;
    };

export function createAnnotationSurfaceState(
  surfaceId: string,
): AnnotationSurfaceState {
  return {
    appliedOperations: {},
    revision: 0,
    strokes: [],
    surfaceId,
  };
}

export function applyAnnotationCommand(
  state: AnnotationSurfaceState,
  command: PresentationCompanionAnnotationCommand,
): AnnotationCommandResult {
  if (command.surfaceId !== state.surfaceId) {
    return rejected(state, "invalid-surface");
  }
  const appliedRevision =
    state.appliedOperations[command.clientOperationId];
  if (appliedRevision !== undefined) {
    return {
      accepted: true,
      changed: false,
      state,
      surfaceRevision: appliedRevision,
    };
  }
  if (command.baseRevision !== state.revision) {
    return rejected(state, "stale-revision");
  }

  const strokes = applyStrokeMutation(state.strokes, command);
  if (!strokes) {
    return rejected(state, "invalid-surface");
  }
  if (!isWithinAnnotationLimits(strokes)) {
    return rejected(state, "limit-exceeded");
  }
  const revision = state.revision + 1;
  return {
    accepted: true,
    changed: true,
    state: {
      appliedOperations: pruneAppliedOperations({
        ...state.appliedOperations,
        [command.clientOperationId]: revision,
      }),
      revision,
      strokes,
      surfaceId: state.surfaceId,
    },
    surfaceRevision: revision,
  };
}

export function createAnnotationSnapshot(input: {
  authorityEpochId: string;
  sessionId: string;
  state: AnnotationSurfaceState;
}): PresentationCompanionAnnotationSnapshot {
  return presentationCompanionAnnotationSnapshotSchema.parse({
    sessionId: input.sessionId,
    authorityEpochId: input.authorityEpochId,
    surfaceId: input.state.surfaceId,
    surfaceRevision: input.state.revision,
    strokes: input.state.strokes,
  });
}

export function restoreAnnotationSurface(
  snapshot: PresentationCompanionAnnotationSnapshot,
): AnnotationSurfaceState {
  return {
    appliedOperations: {},
    revision: snapshot.surfaceRevision,
    strokes: snapshot.strokes,
    surfaceId: snapshot.surfaceId,
  };
}

function applyStrokeMutation(
  strokes: PresentationCompanionStroke[],
  command: PresentationCompanionAnnotationCommand,
): PresentationCompanionStroke[] | null {
  switch (command.kind) {
    case "stroke-begin":
      if (strokes.some((stroke) => stroke.strokeId === command.strokeId)) {
        return null;
      }
      return [
        ...strokes,
        {
          strokeId: command.strokeId,
          tool: command.tool,
          color: command.color,
          width: command.width,
          points: [command.point],
        },
      ];
    case "stroke-points": {
      const index = strokes.findIndex(
        (stroke) => stroke.strokeId === command.strokeId,
      );
      if (index < 0) return null;
      return strokes.map((stroke, strokeIndex) =>
        strokeIndex === index
          ? { ...stroke, points: [...stroke.points, ...command.points] }
          : stroke,
      );
    }
    case "stroke-end":
      return strokes.some((stroke) => stroke.strokeId === command.strokeId)
        ? strokes
        : null;
    case "stroke-delete":
      return strokes.some((stroke) => stroke.strokeId === command.strokeId)
        ? strokes.filter((stroke) => stroke.strokeId !== command.strokeId)
        : null;
    case "undo":
      return strokes.slice(0, -1);
    case "clear-surface":
      return [];
  }
}

function isWithinAnnotationLimits(
  strokes: PresentationCompanionStroke[],
): boolean {
  if (strokes.length > presentationCompanionMaxSurfaceStrokes) return false;
  let pointCount = 0;
  for (const stroke of strokes) {
    if (stroke.points.length > presentationCompanionMaxStrokePoints) {
      return false;
    }
    pointCount += stroke.points.length;
    if (pointCount > presentationCompanionMaxSurfacePoints) return false;
  }
  return true;
}

function rejected(
  state: AnnotationSurfaceState,
  reason: "invalid-surface" | "limit-exceeded" | "stale-revision",
): AnnotationCommandResult {
  return {
    accepted: false,
    reason,
    state,
    surfaceRevision: state.revision,
  };
}

function pruneAppliedOperations(
  operations: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(operations);
  if (entries.length <= 4_096) return operations;
  return Object.fromEntries(entries.slice(entries.length - 2_048));
}
