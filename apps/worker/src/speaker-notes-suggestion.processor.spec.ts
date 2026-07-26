import { deckSchema, type Deck } from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { processSpeakerNotesSuggestionJob } from "./speaker-notes-suggestion.processor";

const payload = {
  jobId: "job_notes_1",
  projectId: "project-a",
  request: {
    deckId: "deck_demo_1",
    slideId: "slide_intro",
    baseVersion: 1,
    mode: "naturalize" as const,
  },
};

describe("processSpeakerNotesSuggestionJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads notes by ID and stores a validated suggestion", async () => {
    const harness = createHarness(createDeck());
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(request.currentNotes).toBe("기존 문장을 설명합니다.");
      expect(request.slideContent).toEqual(["기존 흐름의 한계"]);
      return Response.json({
        suggestedNotes: "먼저 기존 흐름의 한계를 자연스럽게 설명하겠습니다.",
        summary: "말하듯 자연스럽게 다듬었습니다.",
        warnings: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const job = await processSpeakerNotesSuggestionJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({
      slideId: "slide_intro",
      baseVersion: 1,
      mode: "naturalize",
      metrics: { characterCount: 23, estimatedSeconds: 5 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails before provider work when the deck version is stale", async () => {
    const deck = createDeck();
    deck.version = 2;
    const harness = createHarness(deck);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await processSpeakerNotesSuggestionJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("SPEAKER_NOTES_SOURCE_STALE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fabricate a fallback when the provider fails", async () => {
    const harness = createHarness(createDeck());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    const job = await processSpeakerNotesSuggestionJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.result).toBeNull();
    expect(job.error?.code).toBe("PYTHON_WORKER_SPEAKER_NOTES_FAILED");
  });
});

function createDeck(): Deck {
  return deckSchema.parse({
    deckId: "deck_demo_1",
    projectId: "project-a",
    title: "ORBIT Demo",
    version: 1,
    metadata: { language: "ko", locale: "ko-KR" },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_intro",
        order: 1,
        title: "개편 배경",
        speakerNotes: "기존 문장을 설명합니다.",
        aiNotes: {
          timingPlan: {
            charsPerMinute: 320,
            targetSeconds: 30,
            targetSpeakerNotesChars: 160,
            actualSpeakerNotesChars: 12,
          },
        },
        elements: [
          {
            elementId: "el_body",
            type: "text",
            role: "body",
            x: 100,
            y: 100,
            width: 500,
            height: 120,
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            locked: false,
            visible: true,
            props: {
              text: "기존 흐름의 한계",
              fontSize: 32,
              fontWeight: 400,
              color: "#111111",
              align: "left",
              verticalAlign: "top",
              lineHeight: 1.2,
            },
          },
        ],
      },
    ],
  });
}

function createHarness(deck: Deck) {
  let job = jobRow("running", 0, null, null);
  const dataSource = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT deck_id")) {
        return [{ deck_id: deck.deckId, deck_json: deck, version: deck.version }];
      }
      if (normalized.startsWith("SELECT 1 FROM deck_patches")) return [];
      if (normalized.startsWith("UPDATE jobs")) {
        job = jobRow(
          params[1] as Job["status"],
          params[2] as number,
          params[4] as Record<string, unknown> | null,
          params[5] as Job["error"],
        );
        return [job];
      }
      throw new Error(`Unhandled test query: ${normalized}`);
    }),
  } as unknown as DataSource;
  return { dataSource };
}

function jobRow(
  status: Job["status"],
  progress: number,
  result: Record<string, unknown> | null,
  error: Job["error"],
) {
  return {
    job_id: payload.jobId,
    project_id: payload.projectId,
    type: "speaker-notes-suggestion",
    status,
    progress,
    message: "updated",
    result,
    error,
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:01.000Z",
  };
}
