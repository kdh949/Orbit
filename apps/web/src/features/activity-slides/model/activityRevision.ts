import {
  presentationActivityEventSchema,
  type PresentationActivityEvent,
} from "@orbit/shared/realtime";

export type ActivityRevisionState<T> = {
  revision: number;
  value: T;
};

export type ActivityRevisionCursor = {
  revision: number;
  runId: string;
};

export function acceptActivityRevision<T>(
  current: ActivityRevisionState<T> | null,
  next: ActivityRevisionState<T>
): ActivityRevisionState<T> {
  return current && current.revision > next.revision ? current : next;
}

export function createActivityRevisionConsumer(input: {
  current: ActivityRevisionCursor | null;
  onRefetch: (event: PresentationActivityEvent) => void;
  sessionId: string;
}) {
  let current = input.current;

  return {
    consume(value: unknown): boolean {
      const parsed = presentationActivityEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.sessionId !== input.sessionId) return false;

      const event = parsed.data;
      const runId = event.payload.activityRunId;
      const revision = event.payload.revision;
      if (
        event.type !== "active-activity-changed" &&
        current &&
        current.runId !== runId
      ) {
        return false;
      }
      if (current?.runId === runId && current.revision >= revision) return false;

      current = { revision, runId };
      input.onRefetch(event);
      return true;
    },
    sync(next: ActivityRevisionCursor | null): void {
      if (
        next &&
        (current?.runId !== next.runId || current.revision < next.revision)
      ) {
        current = next;
      }
    }
  };
}
