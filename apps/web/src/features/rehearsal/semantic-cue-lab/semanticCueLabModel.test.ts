import { describe, expect, it } from "vitest";

import {
  createSemanticCueLabFixtureDeck,
  semanticCueLabFixtures
} from "./semanticCueLabFixtures";
import {
  createLabMockProvider,
  runLabEvaluation,
  runLabFixtures,
  serializeLabInput,
  serializeLabSnapshot,
  serializeLabTimeline,
  type LabTranscriptSegment
} from "./semanticCueLabModel";

const deck = createSemanticCueLabFixtureDeck();
const fixedNow = () => 1_000;

function segments(text: string): LabTranscriptSegment[] {
  return [{ text, isFinal: true, startMs: 0, endMs: 2000 }];
}

function evaluate(options: {
  slideId?: string;
  text?: string;
  injections?: Parameters<typeof runLabEvaluation>[0]["injections"];
  scores?: Record<string, { entailmentScore: number; neutralScore: number; contradictionScore: number }>;
  provider?: "mock" | "none";
  nliTimeoutMs?: number;
}) {
  const injections = options.injections ?? [];
  const provider =
    options.provider === "none"
      ? undefined
      : createLabMockProvider({
          injections,
          ...(options.scores ? { scoresByCueId: options.scores } : {}),
          now: fixedNow
        });
  return runLabEvaluation({
    deck,
    slideId: options.slideId ?? "slide_rsp",
    segments: segments(options.text ?? "RSP로 스택 공간 확보를 먼저 하고 데이터를 복사합니다"),
    injections,
    provider,
    nliEnabled: options.provider !== "none",
    ...(options.nliTimeoutMs ? { nliTimeoutMs: options.nliTimeoutMs } : {}),
    now: fixedNow
  });
}

describe("semanticCueLabModel", () => {
  it("produces a candidate score breakdown from the real runtime", async () => {
    const result = await evaluate({ text: "RSP로 스택 공간 확보 후 복사합니다" });
    const candidate = result.debugEvent.candidates.find((entry) => entry.cueId === "scue_rsp_order");
    expect(candidate).toBeDefined();
    expect(candidate?.lexicalScore).toBeGreaterThan(0);
    expect(candidate?.conceptCoverage).toBeGreaterThan(0);
  });

  it("shows alias as an any-of group without lowering concept coverage", async () => {
    const result = await evaluate({
      text: "알에스피로 스택 공간 확보를 먼저 하고 데이터를 복사합니다"
    });
    const outcome = result.outcomes.find((entry) => entry.cueId === "scue_rsp_order");
    expect(outcome?.matchedAliases).toContain("RSP");
    expect(outcome?.status).toBe("covered");
  });

  it("reports NLI skipped reason for an ineligible candidate", async () => {
    const result = await evaluate({ text: "오늘 날씨가 참 좋네요" });
    const candidate = result.debugEvent.candidates.find((entry) => entry.cueId === "scue_rsp_order");
    expect(candidate?.selectedForNli).toBe(false);
    expect(candidate?.nliSkippedReason).toBe("no-meaningful-candidate");
  });

  it("skips NLI when a basic match already covers the cue", async () => {
    const result = await evaluate({});
    expect(result.debugEvent.nli).toBeUndefined();
    const nliStep = result.pipeline.find((step) => step.id === "nli-result");
    expect(nliStep?.detail).toContain("기본 매칭");
  });

  it("keeps NLI timeout as a visible fallback", async () => {
    const result = await evaluate({
      text: "그 부분은 여유 있게 처리한 다음 값을 복사해 두었습니다",
      injections: ["nli_timeout"],
      nliTimeoutMs: 20,
      scores: { scue_rsp_order: { entailmentScore: 0.95, neutralScore: 0.03, contradictionScore: 0.02 } }
    });
    expect(result.measurementMode).toBe("basic");
    const outcome = result.outcomes.find((entry) => entry.cueId === "scue_rsp_order");
    expect(outcome?.status).toBe("unmeasured");
    expect(outcome?.unmeasuredReason).toBe("timeout");
    expect(result.capabilityEvents.some((event) => event.reason === "timeout")).toBe(true);
  });

  it("marks STT disabled cues as unmeasured, never missed", async () => {
    const result = await evaluate({ injections: ["stt_disabled"] });
    const outcome = result.outcomes.find((entry) => entry.cueId === "scue_rsp_order");
    expect(outcome?.status).toBe("unmeasured");
    expect(outcome?.unmeasuredReason).toBe("no_transcript");
    expect(result.capabilitySnapshot.stt).toBe("unavailable");
  });

  it("marks stale cues as unmeasured", async () => {
    const result = await evaluate({ injections: ["stale_cue"] });
    const outcome = result.outcomes.find((entry) => entry.cueId === "scue_rsp_order");
    expect(outcome?.status).toBe("unmeasured");
    expect(outcome?.unmeasuredReason).toBe("stale_cue");
  });

  it("surfaces a runtime exception as a visible state", async () => {
    const result = await evaluate({
      text: "그 부분은 여유 있게 처리한 다음 값을 복사해 두었습니다",
      injections: ["runtime_exception"],
      scores: { scue_rsp_order: { entailmentScore: 0.95, neutralScore: 0.03, contradictionScore: 0.02 } }
    });
    const outcome = result.outcomes.find((entry) => entry.cueId === "scue_rsp_order");
    expect(outcome?.status).toBe("unmeasured");
    expect(outcome?.unmeasuredReason).toBe("runtime_error");
    expect(result.capabilityEvents.some((event) => event.reason === "runtime_error")).toBe(true);
  });

  it("blocks semantic actions whenever a fallback is active", async () => {
    const result = await evaluate({
      text: "그 부분은 여유 있게 처리한 다음 값을 복사해 두었습니다",
      injections: ["nli_provider_unavailable"],
      scores: { scue_rsp_order: { entailmentScore: 0.95, neutralScore: 0.03, contradictionScore: 0.02 } }
    });
    expect(result.actionGate.allowed).toBe(false);
    expect(result.actionGate.blockedReasons).toContain("fallback-basic-only");
  });

  it("passes every batch fixture", async () => {
    const results = await runLabFixtures(deck, semanticCueLabFixtures, fixedNow);
    const failures = results.filter((result) => !result.pass);
    expect(
      failures.map((failure) => `${failure.fixture.id}: ${failure.failReasons.join("; ")}`)
    ).toEqual([]);
  });

  it("redacts sensitive text in snapshot/timeline export by default", async () => {
    const result = await evaluate({ text: "RSP로 스택 공간 확보 후 복사합니다" });
    const snapshot = serializeLabSnapshot(result);
    expect(snapshot).not.toContain("RSP로 스택 공간 확보");
    expect(snapshot).toContain("redacted");

    const sensitive = serializeLabSnapshot(result, { includeSensitive: true });
    expect(sensitive).toContain("RSP로 스택 공간 확보");

    const timeline = serializeLabTimeline(result);
    expect(timeline).not.toContain("RSP로 스택 공간 확보");

    const input = serializeLabInput({
      deckId: deck.deckId,
      slideId: "slide_rsp",
      segments: segments("RSP로 스택 공간 확보 후 복사합니다"),
      injections: [],
      provider: "mock"
    });
    expect(input).not.toContain("RSP로 스택 공간 확보");
  });
});
