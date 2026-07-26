import { deckSchema, type Deck, type SemanticCue } from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processSemanticCueExtractionJob } from "./semantic-cue-extraction.processor";

const payload = {
  jobId: "job-semantic-cues",
  projectId: "project-a",
  request: {
    deckId: "deck_demo_1",
    force: false,
    baseVersion: 1
  }
};

describe("processSemanticCueExtractionJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("saves generated cues with a baseVersion and pending-patch CAS", async () => {
    const harness = createHarness(createDeck());
    vi.stubGlobal("fetch", extractionResponse([{ slideId: "slide_intro", cueId: "scue_new" }]));

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({
      deckId: "deck_demo_1",
      sourceDeckVersion: 1,
      version: 2,
      cueCount: 1,
      processedSlideCount: 1,
      warnings: []
    });
    expect(harness.deck.version).toBe(2);
    expect(harness.deck.slides[0]?.semanticCues[0]).toMatchObject({
      cueId: "scue_new",
      origin: "ai",
      reviewStatus: "suggested",
      freshness: "current",
      sourceDeckVersion: 1
    });
    expect(
      harness.queries.some(
        (query) =>
          query.startsWith("UPDATE decks") &&
          query.includes("version = $5") &&
          query.includes("NOT EXISTS") &&
          query.includes("after_version > $5")
      )
    ).toBe(true);
  });

  it("fails before provider work when the queued baseVersion is stale", async () => {
    const deck = createDeck();
    deck.version = 2;
    const harness = createHarness(deck);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("SEMANTIC_CUE_DECK_VERSION_CONFLICT");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.deck.version).toBe(2);
  });

  it("fails when a user patch appears after the extraction baseVersion", async () => {
    const harness = createHarness(createDeck(), { pendingPatch: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("SEMANTIC_CUE_DECK_VERSION_CONFLICT");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.deck.version).toBe(1);
  });

  it("rejects a late concurrent completion without overwriting the deck", async () => {
    const original = createDeck();
    const harness = createHarness(original, { casSucceeds: false });
    vi.stubGlobal("fetch", extractionResponse([{ slideId: "slide_intro", cueId: "scue_late" }]));

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("SEMANTIC_CUE_DECK_VERSION_CONFLICT");
    expect(harness.deck).toEqual(original);
  });

  it("preserves omitted and failed slide results with warnings", async () => {
    const deck = createDeck(true);
    deck.slides[0]!.semanticCues = [createCue("scue_intro_old", "slide_intro")];
    deck.slides[1]!.semanticCues = [createCue("scue_detail_old", "slide_detail")];
    const harness = createHarness(deck);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          deckId: deck.deckId,
          sourceDeckVersion: 1,
          slides: [
            {
              slideId: "slide_intro",
              status: "failed",
              warnings: ["provider-slide-failed"]
            }
          ]
        })
      )
    );

    const job = await runExtraction(harness.dataSource, true);

    expect(job.status).toBe("succeeded");
    expect(harness.deck.slides[0]?.semanticCues[0]?.cueId).toBe("scue_intro_old");
    expect(harness.deck.slides[1]?.semanticCues[0]?.cueId).toBe("scue_detail_old");
    expect(job.result?.warnings).toEqual([
      "slide_intro:provider-slide-failed",
      "provider-omitted-slide:slide_detail"
    ]);
  });

  it("preserves manual and approved cues even when force is true", async () => {
    const deck = createDeck();
    deck.slides[0]!.semanticCues = [
      createCue("scue_manual", "slide_intro", {
        origin: "manual",
        reviewStatus: "suggested"
      }),
      createCue("scue_approved", "slide_intro", {
        origin: "ai",
        reviewStatus: "approved"
      }),
      createCue("scue_ai_old", "slide_intro", {
        origin: "ai",
        reviewStatus: "suggested"
      })
    ];
    const harness = createHarness(deck);
    vi.stubGlobal("fetch", extractionResponse([{ slideId: "slide_intro", cueId: "scue_ai_new" }]));

    await runExtraction(harness.dataSource, true);

    expect(harness.deck.slides[0]?.semanticCues.map((cue) => cue.cueId)).toEqual([
      "scue_manual",
      "scue_approved",
      "scue_ai_new"
    ]);
    expect(harness.deck.slides[0]?.semanticCues[1]?.revision).toBe(1);
  });

  it("refreshes only stale or AI suggested candidates when force is false", async () => {
    const deck = createDeck();
    deck.slides[0]!.semanticCues = [
      createCue("scue_imported_current", "slide_intro"),
      createCue("scue_imported_stale", "slide_intro", { freshness: "stale" }),
      createCue("scue_ai_suggested", "slide_intro", { origin: "ai" }),
      createCue("scue_approved", "slide_intro", { reviewStatus: "approved" })
    ];
    const harness = createHarness(deck);
    vi.stubGlobal("fetch", extractionResponse([{ slideId: "slide_intro", cueId: "scue_new" }]));

    await runExtraction(harness.dataSource);

    expect(harness.deck.slides[0]?.semanticCues.map((cue) => cue.cueId)).toEqual([
      "scue_imported_current",
      "scue_approved",
      "scue_new"
    ]);
  });

  it("treats a legacy empty provider result as skipped instead of deleting cues", async () => {
    const deck = createDeck();
    deck.slides[0]!.semanticCues = [
      createCue("scue_ai_old", "slide_intro", {
        origin: "ai",
        reviewStatus: "suggested"
      })
    ];
    const harness = createHarness(deck);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          deckId: deck.deckId,
          slides: [{ slideId: "slide_intro", semanticCues: [] }]
        })
      )
    );

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("succeeded");
    expect(harness.deck.slides[0]?.semanticCues[0]?.cueId).toBe("scue_ai_old");
    expect(job.result?.warnings).toEqual([
      "slide_intro:empty-slide-result-preserved"
    ]);
  });

  it("skips provider and checkpoint writes when force=false has no refreshable slide", async () => {
    const deck = createDeck();
    deck.slides[0]!.semanticCues = [
      createCue("scue_approved", "slide_intro", { reviewStatus: "approved" })
    ];
    const harness = createHarness(deck);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({ version: 1, processedSlideCount: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.queries.some((query) => query.startsWith("UPDATE decks"))).toBe(
      false
    );
  });

  it("fails without saving when Python semantic cue extraction fails", async () => {
    const harness = createHarness(createDeck());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ detail: "provider unavailable" }, { status: 503 }))
    );

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("PYTHON_WORKER_SEMANTIC_CUE_FAILED");
    expect(harness.deck.version).toBe(1);
  });

  it("reports an invalid result when provider sourceDeckVersion differs", async () => {
    const harness = createHarness(createDeck());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          deckId: "deck_demo_1",
          sourceDeckVersion: 2,
          slides: []
        })
      )
    );

    const job = await runExtraction(harness.dataSource);

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("SEMANTIC_CUE_RESULT_INVALID");
    expect(harness.deck.version).toBe(1);
  });

  it("preserves lifecycle fields from provider cues with stable identity", async () => {
    const deck = createDeck();
    deck.slides[0]!.semanticCues = [
      createCue("scue_stable", "slide_intro", { origin: "ai" })
    ];
    const harness = createHarness(deck);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          deckId: deck.deckId,
          sourceDeckVersion: 1,
          slides: [
            {
              slideId: "slide_intro",
              status: "succeeded",
              semanticCues: [
                {
                  ...providerCue("scue_stable", "slide_intro"),
                  sourceFingerprint: "f".repeat(64),
                  sourceDeckVersion: 1,
                  reviewStatus: "excluded",
                  origin: "ai",
                  revision: 4
                }
              ],
              warnings: []
            }
          ]
        })
      )
    );

    await runExtraction(harness.dataSource);

    expect(harness.deck.slides[0]?.semanticCues[0]).toMatchObject({
      cueId: "scue_stable",
      sourceFingerprint: "f".repeat(64),
      reviewStatus: "excluded",
      origin: "ai",
      revision: 4
    });
  });

  it("surfaces removed suggestions in job warnings", async () => {
    const deck = createDeck();
    deck.slides[0]!.semanticCues = [
      createCue("scue_removed", "slide_intro", { origin: "ai" })
    ];
    const harness = createHarness(deck);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          deckId: deck.deckId,
          sourceDeckVersion: 1,
          slides: [
            {
              slideId: "slide_intro",
              status: "succeeded",
              semanticCues: [],
              warnings: ["removed-suggestion:scue_removed"]
            }
          ]
        })
      )
    );

    const job = await runExtraction(harness.dataSource);

    expect(harness.deck.slides[0]?.semanticCues).toEqual([]);
    expect(job.result?.warnings).toEqual([
      "slide_intro:removed-suggestion:scue_removed"
    ]);
  });
});

function runExtraction(dataSource: DataSource, force = false) {
  return processSemanticCueExtractionJob(
    dataSource,
    "http://localhost:8000",
    force ? { ...payload, request: { ...payload.request, force: true } } : payload
  );
}

function createHarness(
  inputDeck: Deck,
  options: { pendingPatch?: boolean; casSucceeds?: boolean } = {}
) {
  let storedDeck = cloneJson(inputDeck);
  const queries: string[] = [];
  const dataSource = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      const normalized = normalizeSql(sql);
      queries.push(normalized);
      if (normalized.startsWith("UPDATE jobs")) {
        return [
          jobRow(
            params[0] as string,
            params[1] as Job["status"],
            params[2] as number,
            params[4] as Record<string, unknown> | null,
            params[5] as Job["error"]
          )
        ];
      }
      if (normalized.includes("FROM decks")) {
        return [
          {
            deck_id: storedDeck.deckId,
            deck_json: cloneJson(storedDeck),
            version: storedDeck.version
          }
        ];
      }
      if (normalized.startsWith("SELECT 1 FROM deck_patches")) {
        return options.pendingPatch ? [{ exists: 1 }] : [];
      }
      if (normalized.startsWith("UPDATE decks")) {
        const baseVersion = params[4] as number;
        if (
          options.casSucceeds === false ||
          options.pendingPatch ||
          storedDeck.version !== baseVersion
        ) {
          return [];
        }
        storedDeck = cloneJson(params[2] as Deck);
        return [{ version: storedDeck.version }];
      }
      throw new Error(`Unhandled query: ${normalized}`);
    })
  } as unknown as DataSource;

  return {
    dataSource,
    queries,
    get deck() {
      return storedDeck;
    }
  };
}

function extractionResponse(results: Array<{ slideId: string; cueId: string }>) {
  return vi.fn(async () =>
    Response.json({
      deckId: "deck_demo_1",
      sourceDeckVersion: 1,
      slides: results.map(({ slideId, cueId }) => ({
        slideId,
        status: "succeeded",
        semanticCues: [providerCue(cueId, slideId)],
        warnings: []
      }))
    })
  );
}

function providerCue(cueId: string, slideId: string) {
  return {
    cueId,
    slideId,
    meaning: `${slideId}의 생성된 핵심 의미`,
    nliHypotheses: [`발표자는 ${slideId}의 핵심 의미를 설명했다`]
  };
}

function createDeck(includeDetail = false): Deck {
  return deckSchema.parse({
    deckId: "deck_demo_1",
    projectId: "project-a",
    title: "ORBIT Demo Deck",
    version: 1,
    metadata: { language: "ko", locale: "ko-KR" },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9"
    },
    slides: [
      {
        slideId: "slide_intro",
        order: 1,
        title: "소개",
        speakerNotes: "문제 정의를 설명합니다."
      },
      ...(includeDetail
        ? [
            {
              slideId: "slide_detail",
              order: 2,
              title: "상세",
              speakerNotes: "해결 방법을 설명합니다."
            }
          ]
        : [])
    ]
  });
}

function createCue(
  cueId: string,
  slideId: string,
  overrides: Partial<SemanticCue> = {}
): SemanticCue {
  return {
    cueId,
    slideId,
    meaning: `${slideId}의 기존 핵심 의미`,
    importance: "supporting",
    reviewStatus: "suggested",
    freshness: "current",
    origin: "imported",
    revision: 1,
    sourceRefs: [],
    qualityWarnings: [],
    required: false,
    priority: 2,
    candidateKeywords: [],
    aliases: {},
    requiredConcepts: [],
    nliHypotheses: [`발표자는 ${slideId}의 기존 핵심 의미를 설명했다`],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides
  };
}

function jobRow(
  jobId: string,
  status: Job["status"],
  progress: number,
  result: Record<string, unknown> | null,
  error: Job["error"]
) {
  return {
    job_id: jobId,
    project_id: payload.projectId,
    type: "semantic-cue-extraction",
    status,
    progress,
    message: "updated",
    result,
    error,
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: "2026-07-09T00:00:01.000Z"
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
