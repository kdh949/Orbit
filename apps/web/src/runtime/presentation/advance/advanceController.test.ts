import { describe, expect, it } from "vitest";

import {
  defaultAutoAdvanceConfig,
  defaultAutoAdvancePolicy
} from "./autoAdvanceConfig";
import {
  cancelAdvanceCountdown,
  createInitialAdvanceControllerState,
  evaluateAdvanceController,
  type AdvanceControllerSnapshot
} from "./advanceController";
import { createP4FixtureSnapshot } from "./__fixtures__/p4AutoAdvanceFixture";

describe("advanceController", () => {
  it("마지막 문장 commit과 기존 pause가 함께 있으면 countdown을 시작한다", () => {
    const result = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 0.7,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 900,
        finalSentenceSpoken: true,
        pause: { isPaused: true, silenceDurationMs: 900 }
      }),
      defaultAutoAdvanceConfig
    );

    expect(result.commands).toEqual([]);
    expect(result.state).toMatchObject({
      countdownStartedAtMs: 1000,
      status: "countdown"
    });
  });

  it("마지막 phrase가 covered돼도 문장이 commit되지 않았으면 tracking을 유지한다", () => {
    const result = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 1,
        finalSentenceCommitted: false,
        finalSentenceCommittedAtMs: null,
        finalSentenceSpoken: true,
        pause: { isPaused: true, silenceDurationMs: 3_000 }
      }),
      defaultAutoAdvanceConfig
    );

    expect(result.commands).toEqual([]);
    expect(result.state).toMatchObject({
      countdownStartedAtMs: null,
      status: "tracking"
    });
  });

  it("advances only after countdown completes without resumed speech", () => {
    const first = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        nowMs: 1000,
        pause: { isPaused: true, silenceDurationMs: 900 }
      }),
      defaultAutoAdvanceConfig
    );
    const beforeComplete = evaluateAdvanceController(
      first.state,
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        nowMs: 2999,
        pause: { isPaused: true, silenceDurationMs: 2899 }
      }),
      defaultAutoAdvanceConfig
    );
    const complete = evaluateAdvanceController(
      beforeComplete.state,
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        nowMs: 3000,
        pause: { isPaused: true, silenceDurationMs: 2900 }
      }),
      defaultAutoAdvanceConfig
    );

    expect(beforeComplete.commands).toEqual([]);
    expect(complete.commands).toEqual([
      { type: "advance-slide", slideId: "slide-1" }
    ]);
  });

  it("cancels countdown when speech resumes", () => {
    const countdown = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        pause: { isPaused: true, silenceDurationMs: 900 }
      }),
      defaultAutoAdvanceConfig
    );
    const resumed = evaluateAdvanceController(
      countdown.state,
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        nowMs: 1200,
        pause: { isPaused: false, silenceDurationMs: 0 }
      }),
      defaultAutoAdvanceConfig
    );

    expect(resumed.commands).toEqual([
      { type: "cancel-countdown", reason: "speech-resumed" }
    ]);
    expect(resumed.state.status).toBe("ready");
  });

  it("cancels countdown and returns tracking for manual next step", () => {
    const countdown = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        pause: { isPaused: true, silenceDurationMs: 900 }
      }),
      defaultAutoAdvanceConfig
    );

    expect(cancelAdvanceCountdown(countdown.state, "manual")).toEqual({
      commands: [{ type: "cancel-countdown", reason: "manual" }],
      state: {
        countdownStartedAtMs: null,
        manualGuidanceShown: false,
        remainingTriggerSteps: 0,
        slideId: "slide-1",
        status: "tracking"
      }
    });
  });

  it("semantic capability가 degraded이면 자동 전환만 차단한다", () => {
    const result = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 1,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        pause: { isPaused: true, silenceDurationMs: 3_000 },
        semanticAutoActionAllowed: false
      }),
      defaultAutoAdvanceConfig
    );

    expect(result.commands).toEqual([]);
    expect(result.state.status).toBe("tracking");
    expect(
      cancelAdvanceCountdown(result.state, "manual").state.status
    ).toBe("tracking");
  });

  it("blocks auto advance while trigger steps remain", () => {
    const result = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createP4FixtureSnapshot({
        effectiveCoverage: 0.95,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        slideIndex: 1
      }),
      defaultAutoAdvanceConfig
    );

    expect(result.commands).toContainEqual({
      type: "show-builds-remaining",
      remainingTriggerSteps: 2
    });
    expect(result.state.status).toBe("blocked-by-builds");
  });

  it("suggests finish on the last slide without countdown", () => {
    const result = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createP4FixtureSnapshot({
        effectiveCoverage: 0.95,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        isLastSlide: true,
        pause: { isPaused: true, silenceDurationMs: 2000 },
        slideIndex: 2
      }),
      defaultAutoAdvanceConfig
    );

    expect(result.commands).toEqual([
      { type: "suggest-finish", slideId: "p4-slide-final" }
    ]);
    expect(result.state).toMatchObject({
      countdownStartedAtMs: null,
      status: "finish-suggested"
    });
  });

  it("shows manual guidance after the final sentence remains ineligible", () => {
    const result = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 0.4,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 1000,
        nowMs: 6000
      }),
      defaultAutoAdvanceConfig
    );

    expect(result.commands).toEqual([{ type: "show-manual-guidance" }]);
    expect(result.state.manualGuidanceShown).toBe(true);
  });

  it("clears manual guidance when auto advance becomes eligible again", () => {
    const guided = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 0.4,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 1000,
        nowMs: 6000
      }),
      defaultAutoAdvanceConfig
    );

    const ready = evaluateAdvanceController(
      guided.state,
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 1000,
        nowMs: 6200
      }),
      defaultAutoAdvanceConfig
    );
    const countdown = evaluateAdvanceController(
      guided.state,
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 1000,
        nowMs: 6200,
        pause: { isPaused: true, silenceDurationMs: 900 }
      }),
      defaultAutoAdvanceConfig
    );
    const finish = evaluateAdvanceController(
      guided.state,
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 1000,
        isLastSlide: true,
        nowMs: 6200,
        pause: { isPaused: true, silenceDurationMs: 900 }
      }),
      defaultAutoAdvanceConfig
    );
    const disabled = evaluateAdvanceController(
      guided.state,
      createSnapshot({
        effectiveCoverage: 0.8,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 1000,
        nowMs: 6200,
        policy: {
          ...defaultAutoAdvancePolicy,
          rehearsal: false
        }
      }),
      defaultAutoAdvanceConfig
    );

    expect(ready.state).toMatchObject({
      manualGuidanceShown: false,
      status: "ready"
    });
    expect(countdown.state).toMatchObject({
      manualGuidanceShown: false,
      status: "countdown"
    });
    expect(finish.state).toMatchObject({
      manualGuidanceShown: false,
      status: "finish-suggested"
    });
    expect(disabled.state).toMatchObject({
      manualGuidanceShown: false,
      status: "disabled"
    });
  });

  it("respects mode-specific disabled policy", () => {
    const result = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 1,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        policy: {
          ...defaultAutoAdvancePolicy,
          rehearsal: false
        }
      }),
      defaultAutoAdvanceConfig
    );

    expect(result.commands).toEqual([]);
    expect(result.state.status).toBe("disabled");
  });

  it("respects live mode policy independently from rehearsal mode", () => {
    const disabledLive = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 1,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        mode: "live",
        policy: {
          ...defaultAutoAdvancePolicy,
          live: false,
          rehearsal: true
        }
      }),
      defaultAutoAdvanceConfig
    );
    const enabledLive = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      createSnapshot({
        effectiveCoverage: 1,
        finalSentenceCommitted: true,
        finalSentenceSpoken: true,
        mode: "live",
        policy: {
          ...defaultAutoAdvancePolicy,
          live: true,
          rehearsal: false
        }
      }),
      defaultAutoAdvanceConfig
    );

    expect(disabledLive.state.status).toBe("disabled");
    expect(enabledLive.state.status).toBe("ready");
  });
});

function createSnapshot(
  overrides: Partial<AdvanceControllerSnapshot> = {}
): AdvanceControllerSnapshot {
  return {
    effectiveCoverage: 0,
    finalSentenceCommitted: false,
    finalSentenceCommittedAtMs: null,
    finalSentenceSpoken: false,
    finalSentenceSpokenAtMs: null,
    isLastSlide: false,
    mode: "rehearsal",
    nowMs: 1000,
    pause: {
      isPaused: false,
      silenceDurationMs: 0
    },
    policy: defaultAutoAdvancePolicy,
    remainingTriggerSteps: 0,
    slideId: "slide-1",
    ...overrides
  };
}
