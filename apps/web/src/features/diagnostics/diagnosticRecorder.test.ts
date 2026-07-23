import { describe, expect, it, vi } from "vitest";

import { OrbitDiagnosticRecorder } from "./diagnosticRecorder";
import type {
  DiagnosticEventWriter,
  DiagnosticSession,
  OrbitDiagnosticEvent
} from "./diagnosticTypes";

describe("OrbitDiagnosticRecorder", () => {
  it("records a deterministic append-only session", async () => {
    const writer = createWriter();
    const times = [
      new Date("2026-07-24T00:00:00.000Z"),
      new Date("2026-07-24T00:00:00.010Z"),
      new Date("2026-07-24T00:00:00.020Z"),
      new Date("2026-07-24T00:00:00.030Z")
    ];
    const recorder = new OrbitDiagnosticRecorder({
      createId: () => "session_test",
      monotonicNow: vi
        .fn()
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(20)
        .mockReturnValueOnce(30),
      now: () => times.shift() ?? new Date("2026-07-24T00:00:00.040Z"),
      writer
    });

    const first = recorder.start({
      mode: "full",
      surface: "presentation"
    });
    const duplicate = recorder.start({
      mode: "full",
      surface: "presentation"
    });
    recorder.emit({
      stage: "stt",
      name: "stt.result.normalized",
      outcome: "accepted",
      data: { text: "인공지능" }
    });
    await recorder.stop("presentation-ended");

    expect(duplicate).toBe(first);
    expect(writer.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(writer.events.map((event) => event.monotonicMs)).toEqual([10, 20, 30]);
    expect(writer.sessions[0]).toMatchObject({
      sessionId: "session_test",
      eventCount: 3,
      endedAt: "2026-07-24T00:00:00.030Z"
    });
    expect(writer.flush).toHaveBeenCalledOnce();
    expect(recorder.emit({ stage: "session", name: "ignored" })).toBeNull();
  });

  it("bounds recent in-memory events without dropping persisted events", () => {
    const writer = createWriter();
    const recorder = new OrbitDiagnosticRecorder({
      createId: () => "session_bounded",
      maxRecentEvents: 2,
      writer
    });
    recorder.start({ mode: "full", surface: "rehearsal" });
    recorder.emit({ stage: "audio", name: "audio.one" });
    recorder.emit({ stage: "audio", name: "audio.two" });

    expect(recorder.snapshot().recentEvents.map((event) => event.name)).toEqual([
      "audio.one",
      "audio.two"
    ]);
    expect(writer.events).toHaveLength(3);
  });

  it("creates stable speech trace ids from engine identity when available", () => {
    const recorder = new OrbitDiagnosticRecorder({
      createId: () => "session_trace"
    });
    recorder.start({ mode: "metadata", surface: "presentation" });

    expect(
      recorder.createTriggerTraceId({
        utteranceId: "item_3:0",
        resultRevision: 4
      })
    ).toBe("speech:item_3:0:4");
    expect(recorder.createTriggerTraceId()).toBe(
      "speech:session_trace:2"
    );
  });

  it("keeps full transcript only in full mode and always strips secrets", () => {
    const fullWriter = createWriter();
    const full = new OrbitDiagnosticRecorder({
      createId: () => "session_full",
      writer: fullWriter
    });
    full.start({ mode: "full", surface: "presentation" });
    full.emit({
      stage: "stt",
      name: "stt.transport.raw_event",
      data: {
        transcript: "민감한 발표 원문",
        clientSecret: "must-not-persist",
        nested: {
          Authorization: "Bearer must-not-persist",
          delta: "키워드"
        }
      }
    });

    expect(fullWriter.events.at(-1)?.data).toEqual({
      transcript: "민감한 발표 원문",
      nested: { delta: "키워드" }
    });

    const metadataWriter = createWriter();
    const metadata = new OrbitDiagnosticRecorder({
      createId: () => "session_metadata",
      writer: metadataWriter
    });
    metadata.start({ mode: "metadata", surface: "rehearsal" });
    metadata.emit({
      stage: "transcript",
      name: "transcript.source_revision",
      data: { transcript: "민감한 발표 원문" }
    });

    expect(metadataWriter.events.at(-1)?.data).toEqual({
      transcript: { redacted: true, length: 9 }
    });
  });
});

function createWriter() {
  const events: OrbitDiagnosticEvent[] = [];
  const sessions: DiagnosticSession[] = [];
  const flush = vi.fn(async () => {});
  const writer: DiagnosticEventWriter & {
    events: OrbitDiagnosticEvent[];
    sessions: DiagnosticSession[];
    flush: typeof flush;
  } = {
    events,
    sessions,
    append(event) {
      events.push(event);
    },
    finishSession(session) {
      sessions.push({ ...session });
    },
    flush,
    startSession() {}
  };
  return writer;
}
