import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { p0AnimationDeck } from "./__fixtures__/animationDeck";
import { createPresenterSlideshowState } from "./presenterStateStore";
import {
  createPresenterCommandMessage,
  createPresenterRemoteHeartbeatMessage,
  createPresenterRemoteReadyMessage,
  createSlideWindowHeartbeatMessage,
  createSlideWindowReadyMessage,
  createScreenShareEndedMessage,
} from "./presentationChannel";
import {
  createPresentationPublisherController,
  isPresentationPeerStale,
  publishPresenterHeartbeat,
  type PresentationChannelStatus,
} from "./usePresentationChannelPublisher";

const identity = {
  deckId: p0AnimationDeck.deckId,
  sessionId: "session-presenter-1",
};
const publisherHookSourcePath = fileURLToPath(
  new URL("./usePresentationChannelPublisher.ts", import.meta.url),
);

describe("createPresentationPublisherController", () => {
  it("publishes owner heartbeat to both audience and presenter remote channels", () => {
    const slideWindowChannel = { postMessage: vi.fn() };
    const presenterRemoteChannel = { postMessage: vi.fn() };

    publishPresenterHeartbeat({
      identity,
      presenterRemoteChannel,
      slideWindowChannel,
    });

    expect(slideWindowChannel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "presenter-heartbeat" }),
    );
    expect(presenterRemoteChannel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "presenter-heartbeat" }),
    );
  });

  it("publishes sanitized deck and current annotation snapshots when the slide window becomes ready", () => {
    const posted: unknown[] = [];
    const statuses: PresentationChannelStatus[] = [];
    const channel = {
      close: vi.fn(),
      postMessage: (message: unknown) => posted.push(message),
    };
    const controller = createPresentationPublisherController({
      channel,
      getSnapshot: () => ({
        deck: {
          ...p0AnimationDeck,
          slides: p0AnimationDeck.slides.map((slide) => ({
            ...slide,
            keywords: [],
            speakerNotes: "",
          })),
        },
        deckId: identity.deckId,
        sentAt: 10,
        sessionId: identity.sessionId,
        state: createPresenterSlideshowState(p0AnimationDeck),
        triggerAnimationIds: ["anim_image_zoom_in"],
        type: "presenter-snapshot",
      }),
      getAnnotationSnapshot: () => ({
        sessionId: "persisted_session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        surfaceRevision: 2,
        strokes: [],
      }),
      getState: () => null,
      identity,
      onStatusChange: (status) => statuses.push(status),
    });

    controller.handleIncoming(createSlideWindowReadyMessage(identity, 20));

    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({
      deckId: "deck_p0_animation",
      sessionId: "session-presenter-1",
      type: "presenter-snapshot",
      triggerAnimationIds: ["anim_image_zoom_in"],
    });
    expect(JSON.stringify(posted[0])).not.toContain("첫 문장입니다");
    expect(posted[1]).toMatchObject({
      annotation: {
        surfaceId: "surface_1",
        surfaceRevision: 2,
      },
      type: "presenter-annotation-snapshot",
    });
    expect(statuses).toEqual(["connected"]);
  });

  it("publishes state updates without needing another ready event", () => {
    const posted: unknown[] = [];
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      slideId: "slide_p0_2",
      slideIndex: 1,
      stepIndex: 0,
    };
    const controller = createPresentationPublisherController({
      channel: {
        close: vi.fn(),
        postMessage: (message: unknown) => posted.push(message),
      },
      getSnapshot: () => null,
      getState: () => ({
        deckId: identity.deckId,
        sentAt: 30,
        sessionId: identity.sessionId,
        state,
        triggerAnimationIds: [],
        type: "presenter-state",
      }),
      identity,
    });

    controller.publishState();

    expect(posted).toEqual([
      {
        deckId: "deck_p0_animation",
        sentAt: 30,
        sessionId: "session-presenter-1",
        state,
        triggerAnimationIds: [],
        type: "presenter-state",
      },
    ]);
  });

  it("ignores messages from a different session", () => {
    const posted: unknown[] = [];
    const statuses: PresentationChannelStatus[] = [];
    const controller = createPresentationPublisherController({
      channel: {
        close: vi.fn(),
        postMessage: (message: unknown) => posted.push(message),
      },
      getSnapshot: () => {
        throw new Error("wrong session should not request a snapshot");
      },
      getState: () => null,
      identity,
      onStatusChange: (status) => statuses.push(status),
    });

    controller.handleIncoming(
      createSlideWindowReadyMessage(
        { ...identity, sessionId: "session-other" },
        40,
      ),
    );

    expect(posted).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it("marks the publisher connected on slide-window heartbeat", () => {
    const statuses: PresentationChannelStatus[] = [];
    const controller = createPresentationPublisherController({
      channel: {
        close: vi.fn(),
        postMessage: vi.fn(),
      },
      getSnapshot: () => null,
      getState: () => null,
      identity,
      onStatusChange: (status) => statuses.push(status),
    });

    controller.handleIncoming(createSlideWindowHeartbeatMessage(identity, 50));

    expect(statuses).toEqual(["connected"]);
  });

  it("publishes a snapshot when a presenter remote becomes ready", () => {
    const posted: unknown[] = [];
    const statuses: PresentationChannelStatus[] = [];
    const controller = createPresentationPublisherController({
      channel: {
        close: vi.fn(),
        postMessage: (message: unknown) => posted.push(message),
      },
      getSnapshot: () => ({
        deck: p0AnimationDeck,
        deckId: identity.deckId,
        sentAt: 10,
        sessionId: identity.sessionId,
        state: createPresenterSlideshowState(p0AnimationDeck),
        triggerAnimationIds: [],
        type: "presenter-snapshot",
      }),
      getState: () => null,
      identity,
      onStatusChange: (status) => statuses.push(status),
    });

    controller.handleIncoming(createPresenterRemoteReadyMessage(identity, 60));

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "presenter-snapshot" });
    expect(statuses).toEqual(["connected"]);
  });

  it("marks the publisher connected on presenter remote heartbeat", () => {
    const statuses: PresentationChannelStatus[] = [];
    const controller = createPresentationPublisherController({
      channel: {
        close: vi.fn(),
        postMessage: vi.fn(),
      },
      getSnapshot: () => null,
      getState: () => null,
      identity,
      onStatusChange: (status) => statuses.push(status),
    });

    controller.handleIncoming(
      createPresenterRemoteHeartbeatMessage(identity, 70),
    );

    expect(statuses).toEqual(["connected"]);
  });

  it("passes presenter remote commands to the owner without publishing state", () => {
    const commands: unknown[] = [];
    const postMessage = vi.fn();
    const statuses: PresentationChannelStatus[] = [];
    const controller = createPresentationPublisherController({
      channel: {
        close: vi.fn(),
        postMessage,
      },
      getSnapshot: () => {
        throw new Error("command should not request a snapshot");
      },
      getState: () => null,
      identity,
      onCommand: (command) => commands.push(command),
      onStatusChange: (status) => statuses.push(status),
    });

    controller.handleIncoming(
      createPresenterCommandMessage({
        command: { action: "next-step" },
        identity,
        sentAt: 80,
      }),
    );

    expect(commands).toEqual([{ action: "next-step" }]);
    expect(postMessage).not.toHaveBeenCalled();
    expect(statuses).toEqual(["connected"]);
  });

  it("reports ready and screen-share lifecycle events to the capture owner", () => {
    const onPeerReady = vi.fn();
    const onScreenShareEnded = vi.fn();
    const controller = createPresentationPublisherController({
      channel: { close: vi.fn(), postMessage: vi.fn() },
      getSnapshot: () => null,
      getState: () => null,
      identity,
      onPeerReady,
      onScreenShareEnded,
    });

    controller.handleIncoming(createSlideWindowReadyMessage(identity, 81));
    controller.handleIncoming(
      createScreenShareEndedMessage({
        identity,
        reason: "stream-missing",
        sentAt: 82,
      }),
    );

    expect(onPeerReady).toHaveBeenCalledTimes(1);
    expect(onScreenShareEnded).toHaveBeenCalledWith("stream-missing");
  });

  it("marks peer state stale only after the 5 second heartbeat window", () => {
    expect(isPresentationPeerStale(null, 6000)).toBe(false);
    expect(isPresentationPeerStale(1000, 6000)).toBe(false);
    expect(isPresentationPeerStale(1000, 6001)).toBe(true);
    expect(isPresentationPeerStale(null, 6001, 5000, null)).toBe(false);
    expect(isPresentationPeerStale(null, 6001, 5000, 1000)).toBe(true);
  });

  it("supports explicit sessions and disabled publisher effects", () => {
    const source = fs.readFileSync(publisherHookSourcePath, "utf8");

    expect(source).toContain("sessionId: sessionIdOverride");
    expect(source).toContain(
      "const sessionId = sessionIdOverride ?? generatedSessionId",
    );
    expect(source).toContain("if (!enabled || !identity || !deck || !state)");
    expect(source).toContain(
      "if (!enabled || !identity || !channelRef.current)",
    );
    expect(source).toContain("if (!enabled || !deck || !state)");
    expect(source).toContain("getPresenterRemoteChannelName(identity)");
    expect(source).toContain("createPresenterRemoteStateMessage");
  });

  it("keeps presenter remote commands bound to the latest owner state", () => {
    const source = fs.readFileSync(publisherHookSourcePath, "utf8");

    expect(source).toContain("const latestCommandHandlerRef = useRef");
    expect(source).toContain("latestCommandHandlerRef.current = onCommand");
    expect(source).toContain(
      "onCommand: (command) => latestCommandHandlerRef.current?.(command)",
    );
  });
});
