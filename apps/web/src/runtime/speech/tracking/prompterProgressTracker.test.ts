import { describe, expect, it } from "vitest";

import { createPrompterProgressTracker } from "./prompterProgressTracker";

const sentences = [
  {
    sentenceId: "sentence_1",
    index: 0,
    matchable: true,
    isFinalTrigger: false
  },
  {
    sentenceId: "sentence_ignored",
    index: 1,
    matchable: false,
    isFinalTrigger: false
  },
  {
    sentenceId: "sentence_2",
    index: 2,
    matchable: true,
    isFinalTrigger: true
  }
] as const;

describe("createPrompterProgressTracker", () => {
  it("matchable한 첫 문장을 current로 시작하고 evidence만으로 commit하지 않는다", () => {
    const tracker = createTracker();

    expect(tracker.acceptEvidence(evidence())).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      phase: "candidate",
      currentSentenceId: "sentence_1",
      candidateSentenceId: "sentence_1",
      hasCurrentLexicalEvidence: true,
      committedSentenceIds: []
    });
  });

  it("lexical evidence 시작 여부를 candidate 해제 뒤에도 유지한다", () => {
    const tracker = createTracker();

    tracker.acceptEvidence(evidence());
    tracker.acceptEvidence(evidence({ candidate: false, atMs: 1_100 }));

    expect(tracker.snapshot()).toMatchObject({
      phase: "tracking",
      currentSentenceId: "sentence_1",
      candidateSentenceId: null,
      hasCurrentLexicalEvidence: true,
      committedSentenceIds: []
    });
  });

  it("다른 문장과 이전 revision evidence를 거부한다", () => {
    const tracker = createTracker();

    expect(tracker.acceptEvidence(evidence({ sentenceId: "sentence_2" }))).toBe(false);
    tracker.manualNext(1_100);
    expect(
      tracker.acceptEvidence(evidence({ sentenceId: "sentence_2", revision: 0, atMs: 1_200 }))
    ).toBe(false);
  });

  it("신선한 candidate를 boundary에서 한 문장만 commit한다", () => {
    const tracker = createTracker();
    tracker.acceptEvidence(evidence());

    expect(tracker.acceptBoundary({ type: "stt-final", atMs: 1_100 })).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      revision: 1,
      phase: "tracking",
      currentSentenceId: "sentence_2",
      candidateSentenceId: null,
      candidateSinceMs: null,
      committedSentenceIds: ["sentence_1"],
      lastCommittedSentenceId: "sentence_1",
      lastCommitSource: "lexical"
    });
    expect(tracker.acceptBoundary({ type: "stt-final", atMs: 1_200 })).toBe(false);
  });

  it("commit 후 새 revision으로 승계한 evidence는 다음 boundary에서만 commit한다", () => {
    const tracker = createTracker();
    tracker.acceptEvidence(evidence());

    expect(tracker.acceptBoundary({ type: "stt-final", atMs: 1_000 })).toBe(true);
    expect(
      tracker.acceptEvidence(evidence({ sentenceId: "sentence_2", revision: 1, atMs: 1_000 }))
    ).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      revision: 1,
      phase: "candidate",
      currentSentenceId: "sentence_2",
      candidateSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });

    expect(tracker.acceptBoundary({ type: "pause-started", atMs: 1_600 })).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      revision: 2,
      currentSentenceId: null,
      committedSentenceIds: ["sentence_1", "sentence_2"],
      finalSentenceCommitted: true
    });
  });

  it("다음 문장의 강한 evidence로 현재 위치를 한 문장만 복구한다", () => {
    const tracker = createTracker();

    expect(
      tracker.resyncForward(evidence({ sentenceId: "sentence_2", source: "semantic-assisted" }))
    ).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      currentSentenceId: "sentence_2",
      committedSentenceIds: [],
      skippedSentenceIds: ["sentence_1"],
      lastCommitSource: null
    });

    expect(tracker.acceptBoundary({ type: "stt-final", atMs: 1_100 })).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_2"],
      skippedSentenceIds: ["sentence_1"],
      lastCommitSource: "semantic-assisted"
    });
  });

  it("세 문장 앞의 강한 evidence까지 건너뛴 문장을 기록하며 복구한다", () => {
    const tracker = createPrompterProgressTracker({
      slideId: "slide_1",
      sentences: createForwardResyncSentences(),
      maxEvidenceAgeMs: 1_500,
      maxResyncDistance: 3
    });

    expect(
      tracker.resyncForward(
        evidence({ sentenceId: "sentence_4", source: "semantic-assisted" })
      )
    ).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      revision: 1,
      currentSentenceId: "sentence_4",
      committedSentenceIds: [],
      skippedSentenceIds: ["sentence_1", "sentence_2", "sentence_3"]
    });

    expect(tracker.acceptBoundary({ type: "stt-final", atMs: 1_100 })).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      currentSentenceId: "sentence_5",
      committedSentenceIds: ["sentence_4"],
      skippedSentenceIds: ["sentence_1", "sentence_2", "sentence_3"]
    });
  });

  it("세 문장을 넘는 evidence로는 현재 위치를 건너뛰지 않는다", () => {
    const tracker = createPrompterProgressTracker({
      slideId: "slide_1",
      sentences: createForwardResyncSentences(),
      maxResyncDistance: 3
    });

    expect(
      tracker.resyncForward(evidence({ sentenceId: "sentence_5" }))
    ).toBe(false);
    expect(tracker.snapshot()).toMatchObject({
      revision: 0,
      currentSentenceId: "sentence_1",
      committedSentenceIds: []
    });
    expect(tracker.snapshot()).not.toHaveProperty("skippedSentenceIds");
  });

  it("오래된 evidence와 boundary보다 나중인 evidence는 commit하지 않는다", () => {
    const tracker = createTracker();
    tracker.acceptEvidence(evidence());

    expect(tracker.acceptBoundary({ type: "pause-started", atMs: 2_501 })).toBe(false);
    expect(tracker.snapshot().phase).toBe("tracking");

    tracker.acceptEvidence(evidence({ atMs: 3_000 }));
    expect(tracker.acceptBoundary({ type: "stt-final", atMs: 2_999 })).toBe(false);
  });

  it("manual next는 한 문장만 이동하고 previous는 해당 commit만 되돌린다", () => {
    const tracker = createTracker();

    expect(tracker.manualNext(1_000)).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      phase: "tracking",
      currentSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"],
      lastCommittedSentenceId: "sentence_1",
      lastCommitSource: "manual"
    });

    expect(tracker.manualPrevious(1_100)).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      currentSentenceId: "sentence_1",
      committedSentenceIds: [],
      finalSentenceCommitted: false
    });
  });

  it("skip current는 현재 문장을 완료하지 않고 다음 문장으로 이동한다", () => {
    const tracker = createTracker();

    expect(tracker.skipCurrent(1_000)).toBe(true);
    expect(tracker.snapshot()).toMatchObject({
      phase: "tracking",
      currentSentenceId: "sentence_2",
      committedSentenceIds: [],
      skippedSentenceIds: ["sentence_1"],
      lastCommittedSentenceId: null,
      lastCommitSource: null,
      finalSentenceCommitted: false
    });
  });

  it("마지막 문장은 skip하지 않아 완료 상태를 만들지 않는다", () => {
    const tracker = createTracker();
    expect(tracker.skipCurrent(1_000)).toBe(true);

    expect(tracker.skipCurrent(1_100)).toBe(false);
    expect(tracker.snapshot()).toMatchObject({
      currentSentenceId: "sentence_2",
      committedSentenceIds: [],
      skippedSentenceIds: ["sentence_1"],
      finalSentenceCommitted: false
    });
  });

  it("마지막 문장 commit과 reset을 명시적으로 관리한다", () => {
    const tracker = createTracker();
    tracker.manualNext(1_000);
    tracker.manualNext(1_100);

    expect(tracker.snapshot()).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_1", "sentence_2"],
      finalSentenceCommitted: true
    });

    tracker.reset();
    expect(tracker.snapshot()).toMatchObject({
      currentSentenceId: "sentence_1",
      committedSentenceIds: [],
      finalSentenceCommitted: false,
      phase: "tracking"
    });
  });
});

function createTracker() {
  return createPrompterProgressTracker({
    slideId: "slide_1",
    sentences,
    maxEvidenceAgeMs: 1_500
  });
}

function createForwardResyncSentences() {
  return Array.from({ length: 5 }, (_, index) => ({
    sentenceId: `sentence_${index + 1}`,
    index,
    matchable: true,
    isFinalTrigger: index === 4
  }));
}

function evidence(
  override: Partial<Parameters<ReturnType<typeof createTracker>["acceptEvidence"]>[0]> = {}
) {
  return {
    sentenceId: "sentence_1",
    revision: 0,
    candidate: true,
    commitEligible: true,
    source: "lexical" as const,
    atMs: 1_000,
    ...override
  };
}
