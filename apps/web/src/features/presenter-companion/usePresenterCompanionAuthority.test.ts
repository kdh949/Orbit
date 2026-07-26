import { describe, expect, it } from "vitest";
import type { PresenterSlideshowState } from "../../runtime/presentation/channel/presenterStateStore";
import {
  createCompanionOutputState,
  createPresenterNavigationAcknowledgement,
  createPresenterAuthorityLeaseController,
  createCompanionShareSurfaceId,
  createCompanionSurfaceId,
  presenterAuthorityHeartbeatIntervalMs,
  isCompanionAnnotationSurfaceActive,
  resolveCompanionSurface,
} from "./usePresenterCompanionAuthority";

describe("createCompanionOutputState", () => {
  const build = (
    state: PresenterSlideshowState,
    shareEpochId: string | null,
  ) =>
    createCompanionOutputState({
      authorityEpochId: "epoch_1",
      canGoNext: true,
      canGoPrevious: false,
      getSurfaceRevision: () => 4,
      outputRevision: 7,
      sessionId: "session_1",
      shareEpochId,
      state,
    });
  const slideshowState = (
    audienceOutputMode: PresenterSlideshowState["audienceOutputMode"],
  ): PresenterSlideshowState => ({
    audienceOutputMode,
    highlights: [],
    slideId: "slide_1",
    slideIndex: 0,
    stepIndex: 0,
  });

  it("publishes a screen share with its epoch", () => {
    expect(build(slideshowState("screen-share"), "share_1")).toMatchObject({
      outputMode: "screen-share",
      shareEpochId: "share_1",
      surfaceId: createCompanionShareSurfaceId("share_1"),
      surfaceRevision: 4,
    });
  });

  it("falls back to the slide surface when the share epoch is missing", () => {
    expect(build(slideshowState("screen-share"), null)).toMatchObject({
      outputMode: "slide",
      surfaceId: createCompanionSurfaceId("slide_1"),
      surfaceRevision: 4,
    });
  });

  it("keeps black output free of a drawable surface", () => {
    const output = build(slideshowState("black"), null);

    expect(output).toMatchObject({ outputMode: "black" });
    expect(output).not.toHaveProperty("surfaceId");
  });

  it("returns null instead of throwing on an unpublishable state", () => {
    expect(
      build({ ...slideshowState("slide"), slideIndex: -1 }, null),
    ).toBeNull();
  });
});

describe("createCompanionSurfaceId", () => {
  it("creates a stable bounded opaque surface id", () => {
    const first = createCompanionSurfaceId(
      "slide:with spaces/and-a-very-long-identifier-that-needs-bounding",
    );
    const second = createCompanionSurfaceId(
      "slide:with spaces/and-a-very-long-identifier-that-needs-bounding",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("does not collapse distinct unsafe slide ids to the same surface", () => {
    expect(createCompanionSurfaceId("slide:a")).not.toBe(
      createCompanionSurfaceId("slide/a"),
    );
  });

  it("isolates screen-share annotation by share epoch", () => {
    const first = createCompanionShareSurfaceId("share_1");
    const restarted = createCompanionShareSurfaceId("share_2");

    expect(first).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(first).not.toBe(restarted);
    expect(createCompanionShareSurfaceId("share_1")).toBe(first);
  });

  it("does not expose a drawable surface for black output", () => {
    const state = {
      audienceOutputMode: "black" as const,
      highlights: [],
      slideId: "slide_1",
      slideIndex: 0,
      stepIndex: 0,
    };
    expect(
      resolveCompanionSurface(state, null),
    ).toBeNull();
    expect(
      isCompanionAnnotationSurfaceActive({
        output: {
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          outputRevision: 2,
          outputMode: "black",
          slideId: "slide_1",
          slideIndex: 0,
          animationStep: 0,
          canGoNext: false,
          canGoPrevious: false,
        },
        state,
        surfaceId: "surface_slide_1",
      }),
    ).toBe(false);
  });
});

describe("createPresenterNavigationAcknowledgement", () => {
  const output = {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    outputRevision: 3,
    outputMode: "slide" as const,
    slideId: "slide_1",
    slideIndex: 0,
    animationStep: 0,
    canGoNext: true,
    canGoPrevious: false,
    surfaceRevision: 0,
    surfaceId: "surface_1",
  };

  it("accepts a current command within the navigation boundary", () => {
    expect(
      createPresenterNavigationAcknowledgement({
        command: {
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          clientOperationId: "nav_1",
          expectedOutputRevision: 3,
          action: "next-step",
        },
        output,
      }),
    ).toMatchObject({ accepted: true, reason: "accepted" });
  });

  it("rejects stale and boundary commands without changing state", () => {
    expect(
      createPresenterNavigationAcknowledgement({
        command: {
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          clientOperationId: "nav_2",
          expectedOutputRevision: 2,
          action: "next-step",
        },
        output,
      }).reason,
    ).toBe("stale-output");
    expect(
      createPresenterNavigationAcknowledgement({
        command: {
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          clientOperationId: "nav_3",
          expectedOutputRevision: 3,
          action: "previous-slide",
        },
        output,
      }).reason,
    ).toBe("at-boundary");
  });
});

describe("presenter authority lease takeover", () => {
  it("uses the planned heartbeat interval", () => {
    expect(presenterAuthorityHeartbeatIntervalMs).toBe(3_000);
  });

  it("keeps one winner and lets a standby tab claim after expiry", () => {
    let activeEpoch: string | null = null;
    const firstStatuses: string[] = [];
    const secondStatuses: string[] = [];
    const createController = (
      epoch: string,
      statuses: string[],
    ) =>
      createPresenterAuthorityLeaseController({
        claim: (callback) => {
          const claimed = activeEpoch === null || activeEpoch === epoch;
          if (claimed) activeEpoch = epoch;
          callback({ claimed });
        },
        heartbeat: (callback) => {
          callback({ renewed: activeEpoch === epoch });
        },
        isConnected: () => true,
        onStatusChange: (status) => statuses.push(status),
        ownAuthorityEpochId: epoch,
      });
    const first = createController("epoch_1", firstStatuses);
    const second = createController("epoch_2", secondStatuses);

    first.claim();
    second.claim();

    expect(activeEpoch).toBe("epoch_1");
    expect(firstStatuses.at(-1)).toBe("active");
    expect(secondStatuses.at(-1)).toBe("standby");

    activeEpoch = null;
    second.tick();
    first.tick();

    expect(activeEpoch).toBe("epoch_2");
    expect(secondStatuses.at(-1)).toBe("active");
    expect(firstStatuses.at(-1)).toBe("standby");
  });

  it("reclaims unavailable authority and ignores late claims after disconnect or dispose", () => {
    const pendingClaims: Array<(response: unknown) => void> = [];
    const statuses: string[] = [];
    const controller = createPresenterAuthorityLeaseController({
      claim: (callback) => {
        pendingClaims.push(callback);
      },
      heartbeat: () => undefined,
      isConnected: () => true,
      onStatusChange: (status) => statuses.push(status),
      ownAuthorityEpochId: "epoch_1",
    });

    controller.handleAuthorityChanged(null);
    expect(statuses).toEqual(["standby", "claiming"]);

    controller.handleDisconnect();
    pendingClaims[0]?.({ claimed: true });
    expect(statuses.at(-1)).toBe("standby");

    controller.claim();
    controller.dispose();
    pendingClaims[1]?.({ claimed: true });

    expect(statuses).toEqual([
      "standby",
      "claiming",
      "standby",
      "claiming",
    ]);
  });
});
