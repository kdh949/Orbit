import type { PresentationCompanionAnnotationCommand } from "@orbit/shared/realtime";

type AnnotationCommandBaseFields =
  | "authorityEpochId"
  | "baseRevision"
  | "sequence"
  | "sessionId"
  | "surfaceId";

export type CompanionAnnotationCommandInput =
  PresentationCompanionAnnotationCommand extends infer Command
    ? Command extends PresentationCompanionAnnotationCommand
      ? Omit<Command, AnnotationCommandBaseFields>
      : never
    : never;
