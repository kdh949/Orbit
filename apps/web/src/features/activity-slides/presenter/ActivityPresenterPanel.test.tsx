import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import type { ActivityPresenterResult } from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ActivityPresenterMetrics,
  ActivityPresenterResults,
  createActivitySessionRecoveryTracker,
  getActivityPrimaryCommand,
  getActivityReopenCommand,
  loadActivityPresenterRuntime
} from "./ActivityPresenterPanel";
import { activityApi, ActivityApiError } from "../api/activityApi";

describe("ActivityPresenterPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a public session and opens the current Activity when presentation starts", async () => {
    const slide = createActivitySlide(createDemoDeck(), "pre-question");
    const draftRun = activityRun(slide, "draft", 0);
    const openRun = activityRun(slide, "open", 1);
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: null,
      session: null
    });
    vi.spyOn(activityApi, "createSession").mockResolvedValue({
      audienceUrl: "/audience/session_1",
      session: presentationSession()
    });
    vi.spyOn(activityApi, "ensureRun").mockResolvedValue({ run: draftRun });
    vi.spyOn(activityApi, "updateRunStatus").mockResolvedValue({ run: openRun });
    vi.spyOn(activityApi, "getPresenterResult").mockResolvedValue({
      result: presenterResult(slide, "open")
    });

    await expect(loadActivityPresenterRuntime({
      activityId: slide.activity.activityId,
      autoStart: true,
      deckId: "deck_demo",
      deckVersion: 1,
      projectId: "project_demo"
    })).resolves.toMatchObject({
      audienceUrl: "/audience/session_1/a/" + slide.activity.activityId,
      run: { status: "open" },
      sessionId: "session_1"
    });
    expect(activityApi.createSession).toHaveBeenCalledWith("project_demo", {
      accessMode: "public",
      audienceAccessEnabled: true,
      deckId: "deck_demo",
      sessionPurpose: "presentation",
    });
    expect(activityApi.updateRunStatus).toHaveBeenCalledWith(
      "project_demo",
      "session_1",
      draftRun.activityRunId,
      { expectedRevision: 0, status: "open" }
    );
  });

  it("keeps an already open Activity open while refreshing presenter aggregates", async () => {
    const slide = createActivitySlide(createDemoDeck(), "poll");
    const openRun = activityRun(slide, "open", 3);
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: "/audience/session_1",
      session: presentationSession()
    });
    const createSession = vi.spyOn(activityApi, "createSession");
    vi.spyOn(activityApi, "ensureRun").mockResolvedValue({ run: openRun });
    const updateStatus = vi.spyOn(activityApi, "updateRunStatus");
    vi.spyOn(activityApi, "getPresenterResult").mockResolvedValue({
      result: presenterResult(slide, "open")
    });

    await loadActivityPresenterRuntime({
      activityId: slide.activity.activityId,
      autoStart: true,
      deckId: "deck_demo",
      deckVersion: 1,
      projectId: "project_demo"
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("uses the presentation workspace session without creating another session", async () => {
    const slide = createActivitySlide(createDemoDeck(), "poll");
    const draftRun = activityRun(slide, "draft", 0);
    const openRun = activityRun(slide, "open", 1);
    const getCurrentSession = vi.spyOn(activityApi, "getCurrentSession");
    const createSession = vi.spyOn(activityApi, "createSession");
    vi.spyOn(activityApi, "ensureRun").mockResolvedValue({ run: draftRun });
    vi.spyOn(activityApi, "updateRunStatus").mockResolvedValue({ run: openRun });
    vi.spyOn(activityApi, "getPresenterResult").mockResolvedValue({
      result: presenterResult(slide, "open")
    });

    await expect(loadActivityPresenterRuntime({
      activityId: slide.activity.activityId,
      autoStart: true,
      deckId: "deck_demo",
      deckVersion: 1,
      presentationSession: {
        audienceUrl: "/audience/session_live",
        sessionId: "session_live"
      },
      projectId: "project_demo"
    })).resolves.toMatchObject({
      audienceUrl: `/audience/session_live/a/${slide.activity.activityId}`,
      sessionId: "session_live"
    });
    expect(getCurrentSession).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(activityApi.ensureRun).toHaveBeenCalledWith(
      "project_demo",
      "session_live",
      slide.activity.activityId
    );
  });

  it("requires explicit audience enablement for a companion-only presentation session", async () => {
    const slide = createActivitySlide(createDemoDeck(), "poll");
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: null,
      session: {
        ...presentationSession(),
        audienceAccessEnabled: false
      }
    });
    const createSession = vi.spyOn(activityApi, "createSession");
    const ensureRun = vi.spyOn(activityApi, "ensureRun");

    await expect(loadActivityPresenterRuntime({
      activityId: slide.activity.activityId,
      autoStart: true,
      deckId: "deck_demo",
      deckVersion: 1,
      presentationSession: {
        audienceUrl: null,
        sessionId: "session_1"
      },
      projectId: "project_demo"
    })).resolves.toBeNull();

    expect(createSession).not.toHaveBeenCalled();
    expect(ensureRun).not.toHaveBeenCalled();
  });

  it("replaces a stale session when the current Deck adds the requested Activity", async () => {
    const slide = createActivitySlide(createDemoDeck(), "pre-question");
    const draftRun = activityRun(slide, "draft", 0);
    const openRun = activityRun(slide, "open", 1);
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: "/audience/session_stale",
      session: { ...presentationSession(), sessionId: "session_stale", deckVersion: 1 }
    });
    vi.spyOn(activityApi, "createSession").mockResolvedValue({
      audienceUrl: "/audience/session_current",
      session: { ...presentationSession(), sessionId: "session_current", deckVersion: 4 }
    });
    const ensureRun = vi.spyOn(activityApi, "ensureRun")
      .mockRejectedValueOnce(new ActivityApiError(
        "Activity definition not found in stored Deck",
        404,
        null
      ))
      .mockResolvedValueOnce({
        run: { ...draftRun, presentationSessionId: "session_current" }
      });
    vi.spyOn(activityApi, "updateRunStatus").mockResolvedValue({
      run: { ...openRun, presentationSessionId: "session_current" }
    });
    vi.spyOn(activityApi, "getPresenterResult").mockResolvedValue({
      result: presenterResult(slide, "open")
    });

    await expect(loadActivityPresenterRuntime({
      activityId: slide.activity.activityId,
      autoStart: true,
      deckId: "deck_demo",
      deckVersion: 4,
      projectId: "project_demo"
    })).resolves.toMatchObject({
      audienceUrl: "/audience/session_current/a/" + slide.activity.activityId,
      sessionId: "session_current"
    });
    expect(ensureRun).toHaveBeenNthCalledWith(
      1,
      "project_demo",
      "session_stale",
      slide.activity.activityId
    );
    expect(ensureRun).toHaveBeenNthCalledWith(
      2,
      "project_demo",
      "session_current",
      slide.activity.activityId
    );
  });

  it("attempts stale-session recovery only once until the Activity identity changes", async () => {
    const slide = createActivitySlide(createDemoDeck(), "pre-question");
    const tracker = createActivitySessionRecoveryTracker();
    const staleSession = { ...presentationSession(), deckVersion: 1 };
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: "/audience/session_stale",
      session: staleSession
    });
    const createSession = vi.spyOn(activityApi, "createSession").mockResolvedValue({
      audienceUrl: "/audience/session_stale",
      session: staleSession
    });
    vi.spyOn(activityApi, "ensureRun").mockRejectedValue(new ActivityApiError(
      "Activity definition not found in stored Deck",
      404,
      null
    ));
    const identity = JSON.stringify([
      "project_demo",
      "deck_demo",
      4,
      slide.activity.activityId
    ]);
    const load = (recoveryIdentity: string, deckVersion: number) =>
      loadActivityPresenterRuntime({
        activityId: slide.activity.activityId,
        autoStart: true,
        deckId: "deck_demo",
        deckVersion,
        projectId: "project_demo",
        tryStaleSessionReplacement: () =>
          tracker.tryStaleReplacement(recoveryIdentity)
      });

    await expect(load(identity, 4)).rejects.toThrow(
      "Activity definition not found in stored Deck"
    );
    await expect(load(identity, 4)).rejects.toThrow(
      "Activity definition not found in stored Deck"
    );
    expect(createSession).toHaveBeenCalledTimes(1);

    const nextVersionIdentity = JSON.stringify([
      "project_demo",
      "deck_demo",
      5,
      slide.activity.activityId
    ]);
    await expect(load(nextVersionIdentity, 5)).rejects.toThrow(
      "Activity definition not found in stored Deck"
    );
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("retries initial autoStart session creation after a transient failure", async () => {
    const slide = createActivitySlide(createDemoDeck(), "pre-question");
    const draftRun = activityRun(slide, "draft", 0);
    const openRun = activityRun(slide, "open", 1);
    const tracker = createActivitySessionRecoveryTracker();
    const identity = JSON.stringify([
      "project_demo",
      "deck_demo",
      1,
      slide.activity.activityId
    ]);
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: null,
      session: null
    });
    const createSession = vi.spyOn(activityApi, "createSession")
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({
        audienceUrl: "/audience/session_1",
        session: presentationSession()
      });
    vi.spyOn(activityApi, "ensureRun").mockResolvedValue({ run: draftRun });
    vi.spyOn(activityApi, "updateRunStatus").mockResolvedValue({ run: openRun });
    vi.spyOn(activityApi, "getPresenterResult").mockResolvedValue({
      result: presenterResult(slide, "open")
    });
    const load = () => loadActivityPresenterRuntime({
      activityId: slide.activity.activityId,
      autoStart: true,
      deckId: "deck_demo",
      deckVersion: 1,
      finishInitialSessionCreation: () =>
        tracker.finishInitialCreation(identity),
      projectId: "project_demo",
      tryInitialSessionCreation: () => tracker.tryInitialCreation(identity)
    });

    await expect(load()).rejects.toThrow("temporary network failure");
    await expect(load()).resolves.toMatchObject({ sessionId: "session_1" });
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("maps every runtime state to one primary presenter command", () => {
    expect(getActivityPrimaryCommand("draft")).toEqual({
      label: "응답 열기",
      nextStatus: "open"
    });
    expect(getActivityPrimaryCommand("open")).toEqual({
      label: "응답 마감",
      nextStatus: "closed"
    });
    expect(getActivityPrimaryCommand("closed")).toEqual({
      label: "결과 공개",
      nextStatus: "results"
    });
    expect(getActivityPrimaryCommand("results")).toEqual({
      label: "결과 숨기기",
      nextStatus: "closed"
    });
    expect(getActivityReopenCommand("closed")).toEqual({
      label: "응답 다시 열기",
      nextStatus: "open"
    });
    expect(getActivityReopenCommand("results")).toBeNull();
  });

  it("renders poll distribution and presenter-only question text", () => {
    const slide = createActivitySlide(createDemoDeck(), "poll");
    const question = slide.activity.questions[0]!;
    if (question.type !== "single-choice") throw new Error("poll fixture");
    const result: ActivityPresenterResult = {
      activityRunId: "activity_run_1",
      activityId: slide.activity.activityId,
      status: "closed",
      revision: 3,
      responseCount: 2,
      participantCount: 4,
      responseRate: 50,
      aggregates: [{
        questionId: question.questionId,
        type: question.type,
        responseCount: 2,
        average: null,
        ratingDistribution: [],
        choices: question.options.map((option, index) => ({
          optionId: option.optionId,
          count: index === 0 ? 2 : 0,
          ratio: index === 0 ? 1 : 0
        }))
      }],
      textEntries: [{
        entryId: "activity_text_1",
        questionId: question.questionId,
        text: "PRESENTER_TEXT_SENTINEL",
        displayName: "익명 발표자",
        moderationStatus: "pending",
        answeredAt: null,
        updatedAt: "2026-07-17T00:00:00.000Z"
      }]
    };
    const html = renderToStaticMarkup(<ActivityPresenterResults result={result} slide={slide} />);
    expect(html).toContain("100%");
    expect(html).toContain("PRESENTER_TEXT_SENTINEL");
    expect(renderToStaticMarkup(<ActivityPresenterMetrics result={result} />)).toContain(
      "50%"
    );
  });

  it("renders keyboard-operable moderation controls for 50 text fixtures", () => {
    const slide = createActivitySlide(createDemoDeck(), "pre-question");
    const result: ActivityPresenterResult = {
      activityRunId: "activity_run_1",
      activityId: slide.activity.activityId,
      status: "open",
      revision: 50,
      responseCount: 50,
      participantCount: 100,
      responseRate: 50,
      aggregates: [],
      textEntries: Array.from({ length: 50 }, (_, index) => ({
        entryId: `activity_text_${index + 1}`,
        questionId: slide.activity.questions[0]!.questionId,
        text: `질문 ${index + 1}`,
        displayName: null,
        moderationStatus: "pending" as const,
        answeredAt: null,
        updatedAt: "2026-07-17T00:00:00.000Z"
      }))
    };
    const html = renderToStaticMarkup(
      <ActivityPresenterResults onModerate={() => undefined} result={result} slide={slide} />
    );
    expect((html.match(/<button/g) ?? [])).toHaveLength(150);
    expect(html).toContain("질문 50");
  });
});

function presentationSession() {
  return {
    sessionId: "session_1",
    projectId: "project_demo",
    deckId: "deck_demo",
    deckVersion: 1,
    presenterUserId: "user_1",
    createdBy: "user_1",
    status: "live" as const,
    sessionPurpose: "presentation" as const,
    audienceAccessEnabled: true,
    accessMode: "public" as const,
    startsAt: "2026-07-18T00:00:00.000Z",
    expiresAt: "2026-07-19T00:00:00.000Z",
    activeActivityRunId: null,
    startedAt: "2026-07-18T00:00:00.000Z",
    endedAt: null,
    closedAt: null,
    rawResponsesDeleteAfter: null,
    rawResponsesDeletedAt: null,
    resultsDeletedAt: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

function activityRun(
  slide: ReturnType<typeof createActivitySlide>,
  status: "draft" | "open",
  revision: number
) {
  return {
    activityRunId: "activity_run_1",
    presentationSessionId: "session_1",
    activityId: slide.activity.activityId,
    sourceSlideId: slide.slideId,
    version: 1,
    supersedesActivityRunId: null,
    definitionSnapshot: slide.activity,
    definitionFingerprint: "activity-definition-fingerprint",
    status,
    revision,
    isCurrent: true,
    responseCount: 0,
    openedAt: status === "open" ? "2026-07-18T00:00:00.000Z" : null,
    closedAt: null,
    revealedAt: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

function presenterResult(
  slide: ReturnType<typeof createActivitySlide>,
  status: "open"
): ActivityPresenterResult {
  return {
    activityRunId: "activity_run_1",
    activityId: slide.activity.activityId,
    status,
    revision: 1,
    responseCount: 0,
    participantCount: 0,
    responseRate: 0,
    aggregates: [],
    textEntries: []
  };
}
