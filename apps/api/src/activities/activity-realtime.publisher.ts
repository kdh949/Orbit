import {
  presentationAudienceRoomId,
  presentationPresenterRoomId
} from "@orbit/realtime";
import {
  activeActivityChangedEventSchema,
  activityResultsUpdatedEventSchema,
  activityStateChangedEventSchema,
} from "@orbit/shared/realtime";
import type { ActivityRuntimeStatus } from "@orbit/shared/activities";
import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";

@Injectable()
export class ActivityRealtimePublisher {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  publishActiveActivityChanged(input: {
    sessionId: string;
    activityId: string;
    runId: string;
    revision: number;
  }): void {
    this.emitToBoth(input.sessionId, "active-activity-changed", (roomId) =>
      activeActivityChangedEventSchema.parse({
        type: "active-activity-changed",
        roomId,
        sessionId: input.sessionId,
        userId: "system",
        sentAt: new Date().toISOString(),
        payload: {
          sessionId: input.sessionId,
          activityId: input.activityId,
          activityRunId: input.runId,
          revision: input.revision
        }
      })
    );
  }

  publishStateChanged(input: {
    sessionId: string;
    activityId: string;
    runId: string;
    status: ActivityRuntimeStatus;
    revision: number;
  }): void {
    this.emitToBoth(input.sessionId, "activity-state-changed", (roomId) =>
      activityStateChangedEventSchema.parse({
        type: "activity-state-changed",
        roomId,
        sessionId: input.sessionId,
        userId: "system",
        sentAt: new Date().toISOString(),
        payload: {
          sessionId: input.sessionId,
          activityId: input.activityId,
          activityRunId: input.runId,
          status: input.status,
          revision: input.revision
        }
      })
    );
  }

  publishResultsUpdated(input: {
    sessionId: string;
    runId: string;
    revision: number;
  }): void {
    this.emitToBoth(input.sessionId, "activity-results-updated", (roomId) =>
      activityResultsUpdatedEventSchema.parse({
        type: "activity-results-updated",
        roomId,
        sessionId: input.sessionId,
        userId: "system",
        sentAt: new Date().toISOString(),
        payload: {
          sessionId: input.sessionId,
          activityRunId: input.runId,
          revision: input.revision,
          refetch: true
        }
      })
    );
  }

  private emitToBoth(
    sessionId: string,
    eventName: string,
    createEvent: (roomId: string) => unknown
  ): void {
    if (!this.server) return;
    const presenterRoom = presentationPresenterRoomId(sessionId);
    const audienceRoom = presentationAudienceRoomId(sessionId);
    this.server.to(presenterRoom).emit(eventName, createEvent(presenterRoom));
    this.server.to(audienceRoom).emit(eventName, createEvent(audienceRoom));
  }
}
