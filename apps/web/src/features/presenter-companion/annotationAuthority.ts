import {
  presentationCompanionAnnotationAckSchema,
  type PresentationCompanionAnnotationAck,
  type PresentationCompanionAnnotationCommand,
  type PresentationCompanionAnnotationSnapshot,
} from "@orbit/shared";
import {
  applyAnnotationCommand,
  createAnnotationSnapshot,
  createAnnotationSurfaceState,
  type AnnotationSurfaceState,
} from "./annotationReducer";

export type AcceptedAnnotationDelta = {
  command: PresentationCompanionAnnotationCommand;
  surfaceRevision: number;
};

export type AnnotationAuthorityResult = {
  acknowledgement: PresentationCompanionAnnotationAck;
  delta: AcceptedAnnotationDelta | null;
  snapshot: PresentationCompanionAnnotationSnapshot;
};

export class AnnotationAuthority {
  private readonly surfaces = new Map<string, AnnotationSurfaceState>();

  constructor(
    private readonly sessionId: string,
    private readonly authorityEpochId: string,
  ) {}

  getSnapshot(surfaceId: string): PresentationCompanionAnnotationSnapshot {
    return createAnnotationSnapshot({
      authorityEpochId: this.authorityEpochId,
      sessionId: this.sessionId,
      state: this.getSurface(surfaceId),
    });
  }

  releaseSurface(surfaceId: string): boolean {
    return this.surfaces.delete(surfaceId);
  }

  consume(
    command: PresentationCompanionAnnotationCommand,
    activeSurfaceId: string,
  ): AnnotationAuthorityResult {
    const state = this.getSurface(activeSurfaceId);
    const result =
      command.sessionId === this.sessionId &&
      command.authorityEpochId === this.authorityEpochId
        ? applyAnnotationCommand(state, command)
        : {
            accepted: false as const,
            reason: "not-authority" as const,
            state,
            surfaceRevision: state.revision,
          };
    if (result.accepted && result.changed) {
      this.surfaces.set(activeSurfaceId, result.state);
    }
    const reason = result.accepted ? "accepted" : result.reason;
    const acknowledgement = presentationCompanionAnnotationAckSchema.parse({
      sessionId: this.sessionId,
      authorityEpochId: this.authorityEpochId,
      clientOperationId: command.clientOperationId,
      accepted: result.accepted,
      reason,
      surfaceRevision: result.surfaceRevision,
    });
    return {
      acknowledgement,
      delta:
        result.accepted && result.changed
          ? {
              command,
              surfaceRevision: result.surfaceRevision,
            }
          : null,
      snapshot: this.getSnapshot(activeSurfaceId),
    };
  }

  private getSurface(surfaceId: string): AnnotationSurfaceState {
    const existing = this.surfaces.get(surfaceId);
    if (existing) return existing;
    const created = createAnnotationSurfaceState(surfaceId);
    this.surfaces.set(surfaceId, created);
    return created;
  }
}
