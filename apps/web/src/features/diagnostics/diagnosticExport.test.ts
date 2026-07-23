import { describe, expect, it } from "vitest";

import { OrbitDiagnosticRecorder } from "./diagnosticRecorder";
import {
  buildDiagnosticJsonl,
  createDiagnosticExport
} from "./diagnosticExport";

describe("diagnostic export", () => {
  it("writes ordered newline-delimited events", () => {
    const diagnostics = new OrbitDiagnosticRecorder({
      createId: () => "session:1",
      monotonicNow: () => 1,
      now: () => new Date("2026-07-24T00:00:00.000Z")
    });
    diagnostics.start({ mode: "metadata", surface: "presentation" });
    diagnostics.emit({ stage: "runtime", name: "runtime.intent.queued" });
    const events = diagnostics.snapshot().recentEvents;

    const jsonl = buildDiagnosticJsonl(events);

    expect(jsonl.endsWith("\n")).toBe(true);
    expect(jsonl.trim().split("\n").map((line) => JSON.parse(line).seq)).toEqual(
      [1, 2]
    );
  });

  it("falls back to plain JSONL when compression is unavailable", async () => {
    const file = await createDiagnosticExport([], "session:1", {
      compressionSupported: false
    });

    expect(file.fileName).toBe("orbit-diagnostics-session-1.jsonl");
    expect(file.mediaType).toBe("application/x-ndjson");
    expect(await file.blob.text()).toBe("");
  });

  it("creates a gzip stream when CompressionStream is available", async () => {
    if (
      typeof CompressionStream !== "function" ||
      typeof DecompressionStream !== "function"
    ) {
      return;
    }
    const diagnostics = new OrbitDiagnosticRecorder({
      createId: () => "session-1"
    });
    diagnostics.start({ mode: "full", surface: "rehearsal" });
    const events = diagnostics.snapshot().recentEvents;

    const file = await createDiagnosticExport(events, "session-1");
    const decompressed = file.blob
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));

    expect(file.fileName).toBe("orbit-diagnostics-session-1.jsonl.gz");
    expect(await new Response(decompressed).text()).toBe(
      buildDiagnosticJsonl(events)
    );
  });
});
