import { describe, expect, it, vi } from "vitest";
import type { PresentationCompanionAnnotationCommand } from "@orbit/shared";
import {
  createCompanionAnnotationCommand,
  type CompanionAnnotationCommandInput,
} from "./useCompanionSocket";
import {
  AnnotationCommandQueue,
  companionAnnotationQueueLimit,
} from "./annotationCommandQueue";

describe("AnnotationCommandQueue", () => {
  it("keeps one command in flight and advances from authoritative ack revision", () => {
    const emitted: ReturnType<typeof createCommand>[] = [];
    const queue = createQueue((command) => emitted.push(command));

    queue.enqueue(clear("op_1"));
    queue.enqueue(clear("op_2"));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ baseRevision: 0, sequence: 0 });

    queue.acknowledge(ack("op_1", true, 1));
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ baseRevision: 1, sequence: 1 });
  });

  it("requests reconciliation on rejection and ack timeout", () => {
    vi.useFakeTimers();
    const onReconcile = vi.fn();
    const queue = createQueue(vi.fn(), onReconcile);
    queue.enqueue(clear("op_1"));
    queue.acknowledge(ack("op_1", false, 0));
    expect(onReconcile).toHaveBeenCalledWith("rejected");

    queue.reset(0);
    queue.enqueue(clear("op_2"));
    vi.advanceTimersByTime(1_500);
    expect(onReconcile).toHaveBeenCalledWith("ack-timeout");
    expect(queue.size).toBe(0);
    vi.useRealTimers();
  });

  it("bounds pending commands and reconciles instead of growing", () => {
    const onReconcile = vi.fn();
    const queue = createQueue(vi.fn(), onReconcile);
    for (let index = 0; index < companionAnnotationQueueLimit; index += 1) {
      expect(queue.enqueue(clear(`op_${index}`))).toBe(true);
    }
    expect(queue.enqueue(clear("op_overflow"))).toBe(false);
    expect(queue.size).toBe(0);
    expect(onReconcile).toHaveBeenCalledWith("overflow");
  });

  it("stays bounded through a ten-minute synthetic 60Hz drawing soak", () => {
    const queue = createQueue((command) => {
      queue.acknowledge(
        ack(command.clientOperationId, true, command.baseRevision + 1),
      );
    });

    for (let frame = 0; frame < 36_000; frame += 1) {
      expect(queue.enqueue(clear(`op_${frame}`))).toBe(true);
      expect(queue.size).toBeLessThanOrEqual(1);
    }
    expect(queue.size).toBe(0);
  });
});

function createQueue(
  emit: (command: PresentationCompanionAnnotationCommand) => void,
  onReconcile = vi.fn(),
) {
  return new AnnotationCommandQueue({
    createCommand,
    emit,
    onReconcile,
  });
}

function createCommand(
  input: CompanionAnnotationCommandInput,
  revision: number,
  sequence: number,
) {
  const command = createCompanionAnnotationCommand(input, {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    surfaceId: "surface_1",
    baseRevision: revision,
    sequence,
  });
  if (!command) throw new Error("invalid test command");
  return command;
}

function clear(clientOperationId: string) {
  return {
    kind: "clear-surface" as const,
    clientOperationId,
  };
}

function ack(
  clientOperationId: string,
  accepted: boolean,
  surfaceRevision: number,
) {
  return {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    clientOperationId,
    accepted,
    reason: accepted ? ("accepted" as const) : ("stale-revision" as const),
    surfaceRevision,
  };
}
