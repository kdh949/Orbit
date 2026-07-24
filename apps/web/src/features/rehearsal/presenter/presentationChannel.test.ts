import { describe, expect, it } from "vitest";
import { p0AnimationDeck } from "./__fixtures__/animationDeck";
import { createPresenterSlideshowState } from "./presenterStateStore";
import {
  createLivePresentationHostIdentity,
  createPresenterAnnotationDeltaMessage,
  createPresenterAnnotationSnapshotMessage,
  createPresenterCommandMessage,
  createPresenterHeartbeatMessage,
  createPresenterLaserMessage,
  createPresenterRemoteHeartbeatMessage,
  createPresenterRemoteReadyMessage,
  createPresenterRemoteSnapshotMessage,
  createPresenterRemoteStateMessage,
  createScreenShareEndedMessage,
  createPresenterSnapshotMessage,
  createPresenterStateMessage,
  createSlideWindowDeckSnapshot,
  createSlideWindowHeartbeatMessage,
  createSlideWindowReadyMessage,
  getPresentationChannelName,
  getPresenterRemoteChannelName,
  matchesPresentationChannelIdentity,
  parsePresentationChannelMessage,
} from "./presentationChannel";

const identity = {
  deckId: p0AnimationDeck.deckId,
  sessionId: "session-presenter-1",
};
const isPresentationChannelMessage = (value: unknown) =>
  parsePresentationChannelMessage(value) !== null;

describe("presentationChannel", () => {
  it("validates annotation snapshots and deltas at the local channel boundary", () => {
    const annotation = {
      sessionId: "persisted_session_1",
      authorityEpochId: "epoch_1",
      surfaceId: "surface_1",
      surfaceRevision: 0,
      strokes: [],
    };
    const snapshot = createPresenterAnnotationSnapshotMessage({
      annotation,
      identity,
      sentAt: 10,
    });
    const delta = createPresenterAnnotationDeltaMessage({
      command: {
        sessionId: "persisted_session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        clientOperationId: "op_1",
        baseRevision: 0,
        sequence: 0,
        kind: "clear-surface",
      },
      identity,
      sentAt: 11,
      surfaceRevision: 1,
    });

    expect(parsePresentationChannelMessage(snapshot)).toEqual(snapshot);
    expect(parsePresentationChannelMessage(delta)).toEqual(delta);
    expect(
      parsePresentationChannelMessage({
        ...delta,
        command: { ...delta.command, baseRevision: -1 },
      }),
    ).toBeNull();
    expect(
      parsePresentationChannelMessage({
        ...snapshot,
        annotation: {
          ...snapshot.annotation,
          strokes: [{ strokeId: "malformed" }],
        },
      }),
    ).toBeNull();
  });

  it("validates ephemeral laser events at the local channel boundary", () => {
    const move = createPresenterLaserMessage({
      identity,
      laser: {
        sessionId: "persisted_session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        sequence: 4,
        kind: "move",
        x: 0.25,
        y: 0.75,
      },
      sentAt: 12,
    });
    const hide = createPresenterLaserMessage({
      identity,
      laser: {
        sessionId: "persisted_session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        sequence: 5,
        kind: "hide",
      },
      sentAt: 13,
    });

    expect(parsePresentationChannelMessage(move)).toEqual(move);
    expect(parsePresentationChannelMessage(hide)).toEqual(hide);
    expect(
      parsePresentationChannelMessage({
        ...move,
        laser: { ...move.laser, x: 1.1 },
      }),
    ).toBeNull();
    expect(
      parsePresentationChannelMessage({
        ...hide,
        laser: { ...hide.laser, secret: "must-not-pass" },
      }),
    ).toBeNull();
  });

  it("keeps the local window channel separate from the persisted server session", () => {
    const hostIdentity = createLivePresentationHostIdentity({
      deckId: p0AnimationDeck.deckId,
      localWindowSessionId: "local-window-session",
      persistedSessionId: "persisted-pairing-session",
    });

    expect(hostIdentity).toEqual({
      localChannel: {
        deckId: p0AnimationDeck.deckId,
        sessionId: "local-window-session",
      },
      persistedSessionId: "persisted-pairing-session",
    });
    expect(getPresentationChannelName(hostIdentity.localChannel)).not.toContain(
      hostIdentity.persistedSessionId,
    );
  });

  it("does not promote a URL-local session into a server pairing identity", () => {
    expect(
      createLivePresentationHostIdentity({
        deckId: p0AnimationDeck.deckId,
        localWindowSessionId: "session-from-url",
      }),
    ).toMatchObject({
      localChannel: { sessionId: "session-from-url" },
      persistedSessionId: null,
    });
  });

  it("creates deterministic session-scoped channel names", () => {
    expect(getPresentationChannelName(identity)).toBe(
      "orbit:presenter-screen:deck_p0_animation:session-presenter-1",
    );
    expect(
      getPresentationChannelName({
        ...identity,
        sessionId: "session-presenter-2",
      }),
    ).not.toBe(getPresentationChannelName(identity));
    expect(getPresenterRemoteChannelName(identity)).toBe(
      "orbit:presenter-screen:deck_p0_animation:session-presenter-1:owner"
    );
    expect(getPresenterRemoteChannelName(identity)).not.toBe(
      getPresentationChannelName(identity)
    );
  });

  it("keeps only render-required slide data in the slide-window deck snapshot", () => {
    const deckWithPrivateNotes = {
      ...p0AnimationDeck,
      slides: p0AnimationDeck.slides.map((slide, index) =>
        index === 0
          ? {
              ...slide,
              aiNotes: {
                emphasisPoints: ["발표자 전용 강조점"],
                sourceEvidence: [
                  {
                    confidence: 0.9,
                    fileId: "file_private_source",
                    note: "내부 메모",
                    quote: "내부 근거 원문",
                  },
                ],
              },
              actions: [
                ...slide.actions,
                {
                  actionId: "act_private_occurrence",
                  trigger: {
                    kind: "keyword-occurrence" as const,
                    keywordId: "kw_private_ai",
                    occurrenceId: "kwo_slide_p0_1_kw_private_ai_32_34",
                  },
                  effect: {
                    kind: "play-animation" as const,
                    animationId: "anim_image_zoom_in",
                  },
                },
              ],
              presenterOnlyMarker: "슬라이드 창으로 보내면 안 되는 필드",
            }
          : slide,
      ),
    };
    const snapshot = createSlideWindowDeckSnapshot(deckWithPrivateNotes);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.deckId).toBe(p0AnimationDeck.deckId);
    expect(snapshot.slides[0]?.elements).toEqual(
      p0AnimationDeck.slides[0]?.elements,
    );
    expect(snapshot.slides[0]?.animations).toEqual(
      p0AnimationDeck.slides[0]?.animations,
    );
    expect(snapshot.slides[0]?.speakerNotes).toBe("");
    expect(snapshot.slides[0]?.keywords).toEqual([]);
    expect(snapshot.slides[0]?.actions).toEqual([]);
    expect(serialized).not.toContain("첫 문장입니다");
    expect(serialized).not.toContain("두 번째 슬라이드입니다");
    expect(serialized).not.toContain("kwo_slide_p0_1_kw_private_ai_32_34");
    expect(serialized).not.toContain("act_private_occurrence");
    expect(serialized).not.toContain("발표자 전용 강조점");
    expect(serialized).not.toContain("내부 근거 원문");
    expect(serialized).not.toContain("내부 메모");
    expect(serialized).not.toContain("presenterOnlyMarker");
  });

  it("creates presenter snapshot messages without presenter-only content", () => {
    const message = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: {
        ...createPresenterSlideshowState(p0AnimationDeck),
        highlights: [{ elementId: "el_body", active: true }],
        stepIndex: 1,
      },
      triggerAnimationIds: ["anim_image_zoom_in"],
    });
    const serialized = JSON.stringify(message);

    expect(message).toMatchObject({
      deckId: "deck_p0_animation",
      sessionId: "session-presenter-1",
      sentAt: 10,
      type: "presenter-snapshot",
      triggerAnimationIds: ["anim_image_zoom_in"],
      state: {
        audienceOutputMode: "slide",
        slideId: "slide_p0_1",
        stepIndex: 1,
        highlights: [{ elementId: "el_body", active: true }],
      },
    });
    expect(serialized).not.toContain('speakerNotes":"첫');
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("rawAudio");
    expect(serialized).not.toContain("runId");
    expect(serialized).not.toContain("autoAdvance");
    expect(serialized).not.toContain("countdownStartedAtMs");
    expect(serialized).not.toContain("manualGuidance");
    expect(serialized).not.toContain("remainingTriggerSteps");
    expect(serialized).not.toContain("finish-suggested");
  });

  it("creates presenter state messages without P4 presenter-only status", () => {
    const message = createPresenterStateMessage({
      identity,
      sentAt: 20,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: ["anim_image_zoom_in"],
    });
    const serialized = JSON.stringify(message);

    expect(message).toMatchObject({
      state: {
        slideId: "slide_p0_1",
        stepIndex: 0,
      },
      triggerAnimationIds: ["anim_image_zoom_in"],
      type: "presenter-state",
    });
    expect(serialized).not.toContain("autoAdvance");
    expect(serialized).not.toContain("countdownStartedAtMs");
    expect(serialized).not.toContain("manualGuidance");
    expect(serialized).not.toContain("remainingTriggerSteps");
    expect(serialized).not.toContain("finish-suggested");
  });

  it("audience message에서 presenter speech 상태를 제거하고 owner channel에만 유지한다", () => {
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      speech: createPresenterSpeechState(),
    };
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 21,
      state,
      triggerAnimationIds: [],
    });
    const stateMessage = createPresenterStateMessage({
      identity,
      sentAt: 22,
      state,
      triggerAnimationIds: [],
    });
    const remoteSnapshot = createPresenterRemoteSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 23,
      state,
      triggerAnimationIds: []
    });
    const remoteState = createPresenterRemoteStateMessage({
      identity,
      sentAt: 24,
      state,
      triggerAnimationIds: []
    });

    expect(isPresentationChannelMessage(snapshotMessage)).toBe(true);
    expect(isPresentationChannelMessage(stateMessage)).toBe(true);
    expect(snapshotMessage.state.speech).toBeUndefined();
    expect(stateMessage.state.speech).toBeUndefined();
    expect(remoteSnapshot.state.speech).toMatchObject({
      coveredSentenceIds: ["sentence_1"],
      semanticMatchingEnabled: true,
      semanticDebug: {
        transcript: "비공개 final transcript",
        topMatches: [
          expect.objectContaining({
            sentenceId: "sentence_1",
            text: "비공개 speaker note sentence",
          }),
        ],
      },
    });
    expect(remoteState.state.speech).toBeDefined();
    expect(JSON.stringify(snapshotMessage.deck)).not.toContain(
      "비공개 final transcript",
    );
    expect(JSON.stringify(snapshotMessage.deck)).not.toContain(
      "비공개 speaker note sentence",
    );
    const audiencePayload = JSON.stringify([snapshotMessage, stateMessage]);
    expect(audiencePayload).not.toContain("semanticCapabilityItems");
    expect(audiencePayload).not.toContain("비공개 final transcript");
  });

  it("validates channel messages and ignores wrong identities", () => {
    const matching = createPresenterStateMessage({
      identity,
      sentAt: 20,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const wrongSession = {
      ...matching,
      sessionId: "session-other",
    };

    expect(isPresentationChannelMessage(matching)).toBe(true);
    expect(isPresentationChannelMessage(wrongSession)).toBe(true);
    expect(matchesPresentationChannelIdentity(matching, identity)).toBe(true);
    expect(matchesPresentationChannelIdentity(wrongSession, identity)).toBe(
      false,
    );
    expect(
      isPresentationChannelMessage({
        ...matching,
        state: { slideId: "slide_p0_1" },
      }),
    ).toBe(false);
  });

  it("creates ready and heartbeat messages for both windows", () => {
    expect(createPresenterHeartbeatMessage(identity, 30)).toEqual({
      deckId: "deck_p0_animation",
      sentAt: 30,
      sessionId: "session-presenter-1",
      type: "presenter-heartbeat",
    });
    expect(createSlideWindowReadyMessage(identity, 40)).toEqual({
      deckId: "deck_p0_animation",
      sentAt: 40,
      sessionId: "session-presenter-1",
      type: "slide-window-ready",
    });
    expect(createSlideWindowHeartbeatMessage(identity, 50)).toEqual({
      deckId: "deck_p0_animation",
      sentAt: 50,
      sessionId: "session-presenter-1",
      type: "slide-window-heartbeat",
    });
    expect(createPresenterRemoteReadyMessage(identity, 60)).toEqual({
      deckId: "deck_p0_animation",
      sentAt: 60,
      sessionId: "session-presenter-1",
      type: "presenter-remote-ready",
    });
    expect(createPresenterRemoteHeartbeatMessage(identity, 70)).toEqual({
      deckId: "deck_p0_animation",
      sentAt: 70,
      sessionId: "session-presenter-1",
      type: "presenter-remote-heartbeat",
    });
  });

  it("creates and validates presenter remote command messages", () => {
    const message = createPresenterCommandMessage({
      command: { action: "goto", slideIndex: 2, stepIndex: 1 },
      identity,
      sentAt: 80,
    });

    expect(message).toEqual({
      command: { action: "goto", slideIndex: 2, stepIndex: 1 },
      deckId: "deck_p0_animation",
      sentAt: 80,
      sessionId: "session-presenter-1",
      type: "presenter-command",
    });
    expect(isPresentationChannelMessage(message)).toBe(true);
    expect(
      isPresentationChannelMessage({
        ...message,
        command: { action: "goto", slideIndex: "2" },
      }),
    ).toBe(false);
    for (const command of [
      { action: "goto", slideIndex: Number.NaN },
      { action: "goto", slideIndex: Number.POSITIVE_INFINITY },
      { action: "goto", slideIndex: -1 },
      { action: "goto", slideIndex: 1.2 },
      { action: "goto", slideIndex: 1, stepIndex: Number.NaN },
      { action: "goto", slideIndex: 1, stepIndex: Number.POSITIVE_INFINITY },
      { action: "goto", slideIndex: 1, stepIndex: -1 },
      { action: "goto", slideIndex: 1, stepIndex: 0.5 },
    ]) {
      expect(
        isPresentationChannelMessage({
          ...message,
          command,
        }),
      ).toBe(false);
    }
  });

  it("validates presenter remote timer command messages", () => {
    const message = createPresenterCommandMessage({
      command: { action: "timer-start" },
      identity,
      sentAt: 90,
    });

    expect(isPresentationChannelMessage(message)).toBe(true);
    expect(
      isPresentationChannelMessage({
        ...message,
        command: { action: "timer-finish" },
      }),
    ).toBe(false);
  });

  it("validates presenter remote finish commands", () => {
    const message = createPresenterCommandMessage({
      command: { action: "finish" },
      identity,
      sentAt: 90,
    });

    expect(isPresentationChannelMessage(message)).toBe(true);
  });

  it("validates audience output commands and rejects unknown modes", () => {
    const message = createPresenterCommandMessage({
      command: { action: "set-audience-output", mode: "screen-share" },
      identity,
      sentAt: 91,
    });

    expect(isPresentationChannelMessage(message)).toBe(true);
    expect(
      isPresentationChannelMessage({
        ...message,
        command: { action: "set-audience-output", mode: "notes" },
      }),
    ).toBe(false);
  });

  it("validates screen share lifecycle messages without capture data", () => {
    const message = createScreenShareEndedMessage({
      identity,
      reason: "track-ended",
      sentAt: 92,
    });
    const serialized = JSON.stringify(message);

    expect(isPresentationChannelMessage(message)).toBe(true);
    expect(matchesPresentationChannelIdentity(message, identity)).toBe(true);
    expect(serialized).not.toContain("MediaStream");
    expect(serialized).not.toContain('"stream"');
    expect(serialized).not.toContain('"tracks"');
    expect(serialized).not.toContain('"label"');
    expect(serialized).not.toContain("speakerNotes");
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("rawAudio");
    expect(
      isPresentationChannelMessage({
        ...message,
        reason: "permission-denied",
      }),
    ).toBe(false);
    expect(
      parsePresentationChannelMessage(
        createScreenShareEndedMessage({
          identity,
          reason: "playback-failed",
          sentAt: 93,
        }),
      ),
    ).not.toBeNull();
  });

  it("rejects presenter state messages with an unknown audience mode", () => {
    const message = createPresenterStateMessage({
      identity,
      sentAt: 93,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });

    expect(
      isPresentationChannelMessage({
        ...message,
        state: { ...message.state, audienceOutputMode: "notes" },
      }),
    ).toBe(false);
  });

  it("normalizes a missing legacy audience mode to slide without mutating input", () => {
    const state = createPresenterSlideshowState(p0AnimationDeck);
    const messages = [
      createPresenterSnapshotMessage({
        deck: p0AnimationDeck,
        identity,
        sentAt: 94,
        state,
      }),
      createPresenterStateMessage({ identity, sentAt: 95, state }),
      createPresenterRemoteSnapshotMessage({
        deck: p0AnimationDeck,
        identity,
        sentAt: 96,
        state,
      }),
      createPresenterRemoteStateMessage({ identity, sentAt: 97, state }),
    ];

    for (const message of messages) {
      const legacyState = { ...message.state } as Record<string, unknown>;
      delete legacyState.audienceOutputMode;
      const legacyMessage = { ...message, state: legacyState };

      const parsed = parsePresentationChannelMessage(legacyMessage);

      expect(parsed).not.toBeNull();
      expect(parsed && "state" in parsed
        ? parsed.state.audienceOutputMode
        : null).toBe("slide");
      expect(legacyState).not.toHaveProperty("audienceOutputMode");
    }
  });

  it("rejects an explicitly invalid audience mode while parsing", () => {
    const message = createPresenterStateMessage({
      identity,
      sentAt: 98,
      state: createPresenterSlideshowState(p0AnimationDeck),
    });

    expect(
      parsePresentationChannelMessage({
        ...message,
        state: { ...message.state, audienceOutputMode: "notes" },
      }),
    ).toBeNull();
  });
});

function createPresenterSpeechState() {
  return {
    coveredSentenceIds: ["sentence_1"],
    coveredSentenceMatchKinds: {
      sentence_1: "covered" as const,
    },
    matchableSentenceCount: 2,
    semanticDebug: {
      status: "ready" as const,
      slideId: "slide_p0_1",
      transcript: "비공개 final transcript",
      isFinal: true,
      topMatches: [
        {
          rank: 1,
          sentenceId: "sentence_1",
          sentenceIndex: 0,
          text: "비공개 speaker note sentence",
          similarity: 0.91,
          covered: true,
        },
      ],
      decision: null,
      error: null,
    },
    semanticMatchingEnabled: true,
    snapshot: {
      slideId: "slide_p0_1",
      coveredSentenceIds: ["sentence_1"],
      coveredSentenceMatchKinds: {
        sentence_1: "covered" as const,
      },
      matchableSentenceCount: 2,
      sentenceCoverage: 0.5,
      wordCoverage: 0.1,
      effectiveCoverage: 0.5,
      finalSentenceSpoken: false,
      hitKeywordIds: [],
      provisionalMissingKeywordIds: [],
    },
  };
}
