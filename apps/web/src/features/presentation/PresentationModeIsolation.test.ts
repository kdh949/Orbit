import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const presentationWorkspaceSource = read("./PresentationWorkspace.tsx");
const presentationApiSource = read("./presentationApi.ts");
const presentationProcessorSource = read(
  "../../../../worker/src/presentation-analysis.processor.ts",
);

describe("presentation mode isolation", () => {
  it("keeps live presentation persistence away from rehearsal endpoints", () => {
    expect(presentationApiSource).toContain("/presentation-sessions/${segment(sessionId)}/runs");
    expect(presentationApiSource).not.toContain("/rehearsals");
    expect(presentationApiSource).not.toContain("rehearsal-stt");
    expect(presentationWorkspaceSource).not.toContain("createRehearsalRun");
    expect(presentationWorkspaceSource).not.toContain("completeRehearsalAudioUpload");
  });

  it("keeps activity slides, exit protection, and reports on one presentation session", () => {
    expect(presentationWorkspaceSource).toContain(
      "presentationSession={presenterSessionRef.current ?? undefined}",
    );
    expect(presentationWorkspaceSource).toContain(
      "await ensurePresentationSession()",
    );
    expect(presentationWorkspaceSource).toContain('window.addEventListener("beforeunload"');
    expect(presentationWorkspaceSource).toContain("completePresentationWithoutAudio");
    expect(presentationWorkspaceSource).toContain("uploadPresentationRecording");
    expect(presentationWorkspaceSource).toContain("navigateToPresentationReport");
  });

  it("stores analysis only on presentation runs", () => {
    expect(presentationProcessorSource).toContain("UPDATE presentation_runs");
    expect(presentationProcessorSource).not.toContain("UPDATE rehearsal_runs");
    expect(presentationProcessorSource).not.toContain("INSERT INTO rehearsal_runs");
    expect(presentationProcessorSource).not.toContain("FocusedPractice");
    expect(presentationProcessorSource).not.toContain("projectSummary");
  });
});

function read(relativePath: string) {
  return fs.readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}
