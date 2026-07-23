import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoDeck } from "@orbit/editor-core";

import { activityApi } from "../activity-slides/api/activityApi";
import {
  completePresentationWithoutAudio,
  createPresentationRuntime,
  fetchOrCreatePresentationDeck,
  getPresentationReport,
  getPresentationSessionRun,
  uploadPresentationRecording,
} from "./presentationApi";

const now = "2026-07-20T00:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("presentationApi", () => {
  it("loads the presentation deck without calling a rehearsal endpoint", async () => {
    const deck = createDemoDeck();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ deck, projectId: deck.projectId, updatedAt: now }),
      );

    await expect(
      fetchOrCreatePresentationDeck({
        fetcher,
        projectId: deck.projectId,
      }),
    ).resolves.toEqual(deck);

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/projects/${deck.projectId}/deck`,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("rehearsal");
  });

  it("creates one audience session and one isolated presentation run with the session deck version", async () => {
    const getCurrentSession = vi
      .spyOn(activityApi, "getCurrentSession")
      .mockResolvedValue({ audienceUrl: null, session: null });
    const createSession = vi
      .spyOn(activityApi, "createSession")
      .mockResolvedValue({
        audienceUrl: "/audience/session_live",
        session: presentationSession(),
      });
    const getPresenterAccess = vi
      .spyOn(activityApi, "getPresenterAccess")
      .mockResolvedValue({ accessMode: "public", displayPasscode: null });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ run: presentationRun("created", "microphone") }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createPresentationRuntime({
        deckId: "deck_1",
        deckVersion: 3,
        projectId: "project_1",
        recordingMode: "microphone",
      }),
    ).resolves.toEqual({
      accessMode: "public",
      audienceUrl: "/audience/session_live",
      displayPasscode: null,
      recordingMode: "microphone",
      runId: "presentation_run_1",
      sessionId: "session_live",
      status: "created",
    });

    expect(getCurrentSession).toHaveBeenCalledWith("project_1", "deck_1");
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith("project_1", {
      accessMode: "public",
      deckId: "deck_1",
      reuseCurrent: true,
    });
    expect(getPresenterAccess).toHaveBeenCalledWith(
      "project_1",
      "session_live",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedDeckVersion: 4,
      recordingMode: "microphone",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("rehearsal");
  });

  it("reuses a matching passcode session and returns its presenter-only display value", async () => {
    const passcodeSession = {
      ...presentationSession(),
      accessMode: "passcode" as const,
    };
    vi.spyOn(activityApi, "getCurrentSession").mockResolvedValue({
      audienceUrl: "/audience/session_live",
      session: passcodeSession,
    });
    const createSession = vi.spyOn(activityApi, "createSession");
    vi.spyOn(activityApi, "getPresenterAccess").mockResolvedValue({
      accessMode: "passcode",
      displayPasscode: "4821",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ run: presentationRun("created", "none") }),
      ),
    );

    await expect(
      createPresentationRuntime({
        deckId: "deck_1",
        deckVersion: 4,
        projectId: "project_1",
        recordingMode: "none",
      }),
    ).resolves.toMatchObject({
      accessMode: "passcode",
      audienceUrl: "/audience/session_live",
      displayPasscode: "4821",
      sessionId: "session_live",
    });

    expect(createSession).not.toHaveBeenCalled();
  });

  it("uploads microphone audio and completes the matching run", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ run: presentationRun("created", "microphone") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("uploading", "microphone", "file_audio_1"),
          upload: {
            fileId: "file_audio_1",
            projectId: "project_1",
            uploadUrl: "https://upload.orbit.test/presentation-audio",
            method: "PUT",
            headers: { "x-orbit-upload": "signed" },
            expiresAt: "2026-07-20T00:10:00.000Z",
            purpose: "presentation-audio",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("processing", "microphone", "file_audio_1"),
          job: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["audio"], "live-presentation.webm", {
      type: "audio/webm",
    });
    await uploadPresentationRecording({
      file,
      liveTranscript: "안녕하세요 실전 발표입니다.",
      projectId: "project_1",
      runId: "presentation_run_1",
      sessionId: "session_live",
      slideTranscriptSnapshots: [
        {
          capturedAt: now,
          reason: "rehearsal-end",
          slideId: "slide_1",
          slideNum: 1,
          transcript: "안녕하세요 실전 발표입니다.",
          visitedAt: now,
          visitedVer: 1,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/audio-upload",
      "https://upload.orbit.test/presentation-audio",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/audio-complete",
    ]);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: file,
      headers: { "x-orbit-upload": "signed" },
      method: "PUT",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      fileId: "file_audio_1",
      liveTranscript: "안녕하세요 실전 발표입니다.",
      slideTranscriptSnapshots: [
        {
          capturedAt: now,
          reason: "rehearsal-end",
          slideId: "slide_1",
          slideNum: 1,
          transcript: "안녕하세요 실전 발표입니다.",
          visitedAt: now,
          visitedVer: 1,
        },
      ],
    });
  });

  it("normalizes Chrome recorder MIME types before requesting an upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ run: presentationRun("created", "microphone") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("uploading", "microphone", "file_audio_1"),
          upload: {
            fileId: "file_audio_1",
            projectId: "project_1",
            uploadUrl: "https://upload.orbit.test/presentation-audio",
            method: "PUT",
            headers: {},
            expiresAt: "2026-07-20T00:10:00.000Z",
            purpose: "presentation-audio",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("processing", "microphone", "file_audio_1"),
          job: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await uploadPresentationRecording({
      file: new File(["audio"], "live-presentation.webm", {
        type: "audio/webm;codecs=opus",
      }),
      projectId: "project_1",
      runId: "presentation_run_1",
      sessionId: "session_live",
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      mimeType: "audio/webm",
    });
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBeInstanceOf(File);
    expect((fetchMock.mock.calls[2]?.[1]?.body as File).type).toBe(
      "audio/webm",
    );
  });

  it("skips duplicate upload after the server already accepted audio completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        run: presentationRun("processing", "microphone", "file_audio_1"),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadPresentationRecording({
      file: new File(["audio"], "live-presentation.webm", {
        type: "audio/webm",
      }),
      projectId: "project_1",
      runId: "presentation_run_1",
      sessionId: "session_live",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/presentation_run_1$/);
  });

  it("reconciles a lost completion response before retrying the upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ run: presentationRun("created", "microphone") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("uploading", "microphone", "file_audio_1"),
          upload: {
            fileId: "file_audio_1",
            projectId: "project_1",
            uploadUrl: "https://upload.orbit.test/presentation-audio",
            method: "PUT",
            headers: {},
            expiresAt: "2026-07-20T00:10:00.000Z",
            purpose: "presentation-audio",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("processing", "microphone", "file_audio_1"),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadPresentationRecording({
        file: new File(["audio"], "live-presentation.webm", {
          type: "audio/webm",
        }),
        projectId: "project_1",
        runId: "presentation_run_1",
        sessionId: "session_live",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("creates a fresh upload when an earlier upload never reached storage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("uploading", "microphone", "file_stale"),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: "업로드 파일을 찾을 수 없습니다." }, 409),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("uploading", "microphone", "file_stale"),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("uploading", "microphone", "file_audio_2"),
          upload: {
            fileId: "file_audio_2",
            projectId: "project_1",
            uploadUrl: "https://upload.orbit.test/presentation-audio-2",
            method: "PUT",
            headers: {},
            expiresAt: "2026-07-20T00:10:00.000Z",
            purpose: "presentation-audio",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("processing", "microphone", "file_audio_2"),
          job: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadPresentationRecording({
        file: new File(["audio"], "live-presentation.webm", {
          type: "audio/webm",
        }),
        projectId: "project_1",
        runId: "presentation_run_1",
        sessionId: "session_live",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/audio-complete",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/audio-upload",
      "https://upload.orbit.test/presentation-audio-2",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/audio-complete",
    ]);
  });

  it("completes without audio and reads the combined report from the same session", async () => {
    const deck = createDemoDeck();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ run: presentationRun("created", "none") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("succeeded", "none"),
          job: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ run: presentationRun("succeeded", "none") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          report: {
            runId: "presentation_run_1",
            projectId: "project_1",
            sessionId: "session_live",
            analysisStatus: "succeeded",
            recordingMode: "none",
            voiceReport: null,
            detailedReport: null,
            deck,
            audienceSummary: null,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await completePresentationWithoutAudio({
      projectId: "project_1",
      runId: "presentation_run_1",
      sessionId: "session_live",
    });
    await getPresentationSessionRun({
      projectId: "project_1",
      sessionId: "session_live",
    });
    await getPresentationReport({
      projectId: "project_1",
      runId: "presentation_run_1",
      sessionId: "session_live",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      withoutAudio: true,
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/audio-complete",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/report",
    ]);
    expect(
      fetchMock.mock.calls.every(([url]) => !String(url).includes("rehearsal")),
    ).toBe(true);
  });

  it("falls back to no-audio completion when microphone recording is empty", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ run: presentationRun("created", "microphone") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ run: presentationRun("created", "none") }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: presentationRun("succeeded", "none"),
          job: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completePresentationWithoutAudio({
        projectId: "project_1",
        runId: "presentation_run_1",
        sessionId: "session_live",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs",
      "/api/v1/projects/project_1/presentation-sessions/session_live/runs/presentation_run_1/audio-complete",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedDeckVersion: 4,
      recordingMode: "none",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      withoutAudio: true,
    });
  });
});

function presentationSession() {
  return {
    sessionId: "session_live",
    projectId: "project_1",
    deckId: "deck_1",
    deckVersion: 4,
    presenterUserId: "user_1",
    createdBy: "user_1",
    status: "live" as const,
    accessMode: "public" as const,
    startsAt: now,
    expiresAt: "2026-07-31T00:00:00.000Z",
    activeActivityRunId: null,
    startedAt: now,
    endedAt: null,
    closedAt: null,
    rawResponsesDeleteAfter: null,
    rawResponsesDeletedAt: null,
    resultsDeletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function presentationRun(
  status: "created" | "uploading" | "processing" | "succeeded",
  recordingMode: "microphone" | "none",
  audioFileId: string | null = null,
) {
  return {
    runId: "presentation_run_1",
    projectId: "project_1",
    sessionId: "session_live",
    deckId: "deck_1",
    deckVersion: 4,
    recordingMode,
    audioFileId,
    jobId: null,
    status,
    error: null,
    voiceReport: null,
    startedAt: now,
    endedAt: status === "succeeded" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
