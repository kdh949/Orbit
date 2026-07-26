import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceSourcePath = fileURLToPath(
  new URL("../RehearsalWorkspaceController.tsx", import.meta.url),
);

describe("RehearsalWorkspace controller hook boundaries", () => {
  it("delegates presentation and speech tracking state to dedicated hooks", () => {
    const source = fs.readFileSync(workspaceSourcePath, "utf8");

    expect(source).toContain("useRehearsalPresentation({");
    expect(source).toContain("useRehearsalSpeechTracking()");
    expect(source).toContain("requestPreparedSlideChange({");
    expect(source).toContain("speechTracking.captureSlideTranscriptSnapshot(");
    expect(source).not.toContain(
      "const liveTranscriptBufferRef = useRef<LiveTranscriptBuffer>",
    );
    expect(source).not.toContain(
      "const slideWindowRef = useRef<SlideWindowRef",
    );
  });
});
