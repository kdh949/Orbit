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

import {
  ActivityRealtimeMetricsService,
  type ActivityRealtimeEventName,
  type ActivityRealtimeRoomRole,
} from "./activity-realtime-metrics.service";

const RESULTS_UPDATE_COALESCE_WINDOW_MS = 100;

type PendingResultsUpdate = {
  sessionId: string;
  runId: string;
  revision: number;
  timer: ReturnType<typeof setTimeout>;
};

@Injectable()
export class ActivityRealtimePublisher {
  private server: Server | null = null;
  private readonly pendingResultsUpdates = new Map<string, PendingResultsUpdate>();

  constructor(private readonly metrics: ActivityRealtimeMetricsService) {}

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
    if (!this.server) return;
    const key = `${input.sessionId}\0${input.runId}`;
    const pending = this.pendingResultsUpdates.get(key);
    if (pending) {
      pending.revision = Math.max(pending.revision, input.revision);
      return;
    }

    const timer = setTimeout(() => {
      const latest = this.pendingResultsUpdates.get(key);
      if (!latest) return;
      this.pendingResultsUpdates.delete(key);
      this.emitResultsUpdated(latest);
    }, RESULTS_UPDATE_COALESCE_WINDOW_MS);
    timer.unref?.();
    this.pendingResultsUpdates.set(key, { ...input, timer });
  }

  private emitResultsUpdated(input: {
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
    eventName: ActivityRealtimeEventName,
    createEvent: (roomId: string) => unknown
  ): void {
    if (!this.server) return;
    const presenterRoom = presentationPresenterRoomId(sessionId);
    const audienceRoom = presentationAudienceRoomId(sessionId);
    for (const [roomRole, roomId] of [
      ["presenter", presenterRoom],
      ["audience", audienceRoom],
    ] as const satisfies readonly (readonly [
      ActivityRealtimeRoomRole,
      string,
    ])[]) {
      const event = createEvent(roomId);
      const recipientCount =
        this.server.sockets.adapter.rooms.get(roomId)?.size ?? 0;
      this.server.to(roomId).emit(eventName, event);
      this.metrics.recordEmit({
        event: eventName,
        roomRole,
        payloadBytes: Buffer.byteLength(JSON.stringify(event), "utf8"),
        recipientCount,
      });
    }
  }
}
