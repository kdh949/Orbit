import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";

import type { ActivityRealtimeMetricsService } from "./activity-realtime-metrics.service";
import { ActivityRealtimePublisher } from "./activity-realtime.publisher";

describe("ActivityRealtimePublisher", () => {
  it("publishes a complete state-change payload", () => {
    const emit = vi.fn();
    const metrics = { recordEmit: vi.fn() };
    const publisher = new ActivityRealtimePublisher(
      metrics as unknown as ActivityRealtimeMetricsService
    );
    publisher.attach({
      sockets: { adapter: { rooms: new Map() } },
      to: vi.fn().mockReturnValue({ emit })
    } as unknown as Server);

    publisher.publishStateChanged({
      sessionId: "session_1",
      activityId: "activity_1",
      runId: "activity_run_1",
      status: "open",
      revision: 2
    });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(metrics.recordEmit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]?.[1]).toMatchObject({
      payload: {
        activityId: "activity_1",
        activityRunId: "activity_run_1",
        status: "open",
        revision: 2
      }
    });
  });

  it("publishes revision-only refetch events to isolated presenter and audience rooms", () => {
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    const metrics = { recordEmit: vi.fn() };
    const publisher = new ActivityRealtimePublisher(
      metrics as unknown as ActivityRealtimeMetricsService
    );
    publisher.attach({
      sockets: {
        adapter: {
          rooms: new Map([
            ["presentation:session_1:presenter", new Set(["socket_1"])],
            [
              "presentation:session_1:audience",
              new Set(["socket_2", "socket_3"])
            ]
          ])
        }
      },
      to
    } as unknown as Server);

    publisher.publishResultsUpdated({
      sessionId: "session_1",
      runId: "activity_run_1",
      revision: 7
    });

    expect(to).toHaveBeenCalledWith("presentation:session_1:presenter");
    expect(to).toHaveBeenCalledWith("presentation:session_1:audience");
    expect(emit).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify(emit.mock.calls);
    expect(serialized).toContain('"revision":7');
    expect(serialized).toContain('"refetch":true');
    expect(serialized).not.toContain("audienceId");
    expect(serialized).not.toContain("displayName");
    expect(serialized).not.toContain("answers");
    expect(metrics.recordEmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: "activity-results-updated",
        roomRole: "presenter",
        recipientCount: 1,
        payloadBytes: expect.any(Number)
      })
    );
    expect(metrics.recordEmit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: "activity-results-updated",
        roomRole: "audience",
        recipientCount: 2,
        payloadBytes: expect.any(Number)
      })
    );
  });
});
