import { describe, expect, it } from "vitest";

import {
  applyTranscriptEvidence,
  createTranscriptEvidenceState,
} from "./transcriptEvidenceState";

describe("transcript evidence state", () => {
  it("holds the first partial and dispatches only its stable prefix", () => {
    const first = applyTranscriptEvidence(createTranscriptEvidenceState(), {
      isFinal: false,
      resultRevision: 1,
      text: "알파 베타",
      utteranceId: "u1",
    });
    const stable = applyTranscriptEvidence(first.state, {
      isFinal: false,
      resultRevision: 2,
      text: "알파 베타 감마",
      utteranceId: "u1",
    });

    expect(first).toMatchObject({
      currentTranscript: "",
      isDispatchable: false,
      kind: "pending",
      newSegment: "",
    });
    expect(stable).toMatchObject({
      currentTranscript: "알파베타",
      isDispatchable: true,
      kind: "stable-prefix",
      newSegment: "알파베타",
      previousTranscript: "",
    });
  });

  it("dispatches only the remaining final text after an emitted stable prefix", () => {
    const first = applyTranscriptEvidence(createTranscriptEvidenceState(), {
      isFinal: false,
      resultRevision: 1,
      text: "알파 베타",
      utteranceId: "u1",
    });
    const stable = applyTranscriptEvidence(first.state, {
      isFinal: false,
      resultRevision: 2,
      text: "알파 베타 감마",
      utteranceId: "u1",
    });
    const final = applyTranscriptEvidence(stable.state, {
      isFinal: true,
      resultRevision: 3,
      text: "알파 베타 감마 델타",
      utteranceId: "u1",
    });

    expect(final).toMatchObject({
      currentTranscript: "알파베타감마델타",
      isDispatchable: true,
      kind: "final",
      newSegment: "감마델타",
      previousTranscript: "알파베타",
    });
  });

  it("does not dispatch an unrevisioned interim result", () => {
    const partial = applyTranscriptEvidence(createTranscriptEvidenceState(), {
      isFinal: false,
      text: "알파",
    });

    expect(partial.isDispatchable).toBe(false);
    expect(partial.kind).toBe("pending");
  });
});
