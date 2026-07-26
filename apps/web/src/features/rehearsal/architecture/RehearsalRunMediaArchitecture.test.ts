import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceSourcePath = fileURLToPath(
  new URL("../RehearsalWorkspaceController.tsx", import.meta.url),
);
const lifecycleSourcePath = fileURLToPath(
  new URL("../hooks/useRehearsalRunLifecycle.ts", import.meta.url),
);

describe("rehearsal run and media boundaries", () => {
  it("invalidates a previous upload when a new recording starts", () => {
    const workspaceSource = fs.readFileSync(workspaceSourcePath, "utf8");
    const lifecycleSource = fs.readFileSync(lifecycleSourcePath, "utf8");

    expect(workspaceSource).toContain("runLifecycle.beginRecordingAttempt()");
    expect(lifecycleSource).toContain("submissionVersionRef.current += 1");
    expect(lifecycleSource).toContain("const isCurrentSubmission =");
    expect(lifecycleSource).toContain("if (!isCurrentSubmission())");
  });

  it("pauses recorder and speech before disabling media tracks", () => {
    const source = fs.readFileSync(workspaceSourcePath, "utf8");
    const pauseStart = source.indexOf("async function pauseActiveRehearsal");
    const resumeStart = source.indexOf("async function resumePausedRehearsal");
    const actionStart = source.indexOf(
      "async function handleTimePrimaryAction",
    );
    const pauseBody = source.slice(pauseStart, resumeStart);
    const resumeBody = source.slice(resumeStart, actionStart);

    expect(
      pauseBody.indexOf("await mediaSession.pauseRecording()"),
    ).toBeLessThan(pauseBody.indexOf("await p3Session.pause()"));
    expect(pauseBody.indexOf("await p3Session.pause()")).toBeLessThan(
      pauseBody.indexOf('if (pauseResult.status === "paused")'),
    );
    expect(
      pauseBody.indexOf('if (pauseResult.status === "paused")'),
    ).toBeLessThan(pauseBody.indexOf("mediaSession.setStreamEnabled("));
    expect(resumeBody.indexOf("mediaSession.setStreamEnabled(")).toBeLessThan(
      resumeBody.indexOf("await mediaSession.resumeRecording()"),
    );
    expect(
      resumeBody.indexOf("await mediaSession.resumeRecording()"),
    ).toBeLessThan(resumeBody.indexOf("await p3Session.resume"));
  });

  it("prepares the run before P3 tracking and preserves stop metadata", () => {
    const source = fs.readFileSync(workspaceSourcePath, "utf8");
    const recordingStart = source.indexOf("async function startRecording");
    const recordingEnd = source.indexOf("async function startLiveDemo");
    const startRecordingBody = source.slice(recordingStart, recordingEnd);
    const stopStart = source.indexOf("function stopRecording");
    const stopEnd = source.indexOf("function handleTimePrimaryAction");
    const stopRecordingBody = source.slice(stopStart, stopEnd);

    expect(startRecordingBody).toContain(
      "await runLifecycle.prepareEvaluationSnapshot(activeDeck)",
    );
    expect(startRecordingBody).toContain(
      "void startP3Tracking(stream, evaluationSnapshot)",
    );
    expect(
      startRecordingBody.indexOf("prepareEvaluationSnapshot"),
    ).toBeLessThan(startRecordingBody.indexOf("startP3Tracking"));
    expect(startRecordingBody).not.toContain("startLiveStt(stream)");
    expect(stopRecordingBody).toContain(
      "const p3Session = p3SessionRef.current",
    );
    expect(stopRecordingBody).toContain(".stop()");
    expect(stopRecordingBody).toContain(".then((meta)");
    expect(stopRecordingBody).toContain(".catch(() => null)");
    expect(stopRecordingBody).toContain("setP3RunMeta(meta)");
  });

  it("reuses prepared snapshots across recording attempts", () => {
    const source = fs.readFileSync(lifecycleSourcePath, "utf8");

    expect(source).toContain(
      "preparedSlideSnapshotsRef.current ??\n      readPreparedRehearsalSlideSnapshots",
    );
    expect(source).toContain(
      "preparedSlideSnapshotsRef.current = slideSnapshots",
    );
  });

  it("continues upload when optional P3 run metadata is unavailable", () => {
    const workspaceSource = fs.readFileSync(workspaceSourcePath, "utf8");
    const lifecycleSource = fs.readFileSync(lifecycleSourcePath, "utf8");
    const stopStart = workspaceSource.indexOf("function stopRecording");
    const stopEnd = workspaceSource.indexOf(
      "function handleTimePrimaryAction",
      stopStart,
    );
    const stopRecordingBody = workspaceSource.slice(stopStart, stopEnd);

    expect(stopRecordingBody).toContain(".catch(() => null)");
    expect(workspaceSource).toContain("await pendingP3RunMetaRef.current");
    expect(lifecycleSource).toContain("runMeta: await options.getRunMeta()");
    expect(lifecycleSource).toContain("runRehearsalUploadFlow");
  });
});
