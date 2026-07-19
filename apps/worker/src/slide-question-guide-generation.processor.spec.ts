import type { DataSource } from "typeorm";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  deckSchema,
  slideQuestionGuideTextHashInput,
} from "@orbit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { processSlideQuestionGuideGenerationJob } from "./slide-question-guide-generation.processor";

const payload = {
  jobId: "job-guide-1",
  projectId: "project-1",
  guideId: "guide-1",
};
const canonicalDeck = deckSchema.parse(deckFixture());
const slideHash = sha256Canonical(canonicalDeck.slides[0]);
const supportingSlideHash = sha256Canonical(canonicalDeck.slides[1]);
const slideTextHash = sha256Canonical(slideQuestionGuideTextHashInput(canonicalDeck.slides[0]));
const referenceHash = "b".repeat(64);

describe("processSlideQuestionGuideGenerationJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stores private canonical items while keeping the Job result identifier-only", async () => {
    const harness = createHarness();
    const events: Record<string, unknown>[] = [];
    let providerRequest: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      providerRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(providerResponse(
        [0, 1, 2].map((index) => generatedItem(index)),
      ));
    }));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
      (event) => events.push(event),
    );

    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({
      guideId: "guide-1",
      projectId: "project-1",
      deckId: "deck_1",
      deckVersion: 3,
      slideId: "slide_1",
      itemCount: 3,
      generatedAt: expect.any(String),
    });
    expect(JSON.stringify(job.result)).not.toContain("questionText");
    expect(providerRequest).toMatchObject({
      targetSlideId: "slide_1",
      deckVersion: 3,
      slides: [
        { slideId: "slide_1", speakerNotes: "현재 슬라이드 발표 대본" },
        { slideId: "slide_2", speakerNotes: "다음 슬라이드 발표 대본" },
      ],
    });
    expect(harness.insertedItems).toHaveLength(3);
    expect(harness.storedResearch).toEqual({
      status: "unavailable",
      attempts: 1,
      officialSourceCount: 0,
      issueCodes: ["no-citations"],
      researchedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(harness.storedResearchSql).toContain(
      "research_issue_codes = $7::jsonb",
    );
    expect(harness.storedResearchParameter).toBe('["no-citations"]');
    expect(events).toEqual([{
      event: "slide_question_guide.web_research.completed",
      projectId: "project-1",
      guideId: "guide-1",
      status: "unavailable",
      attempts: 1,
      officialSourceCount: 0,
      issueCodes: ["no-citations"],
      webSearchMs: 1_200,
      generationMs: 8_400,
      totalProviderMs: 9_600,
    }]);
    expect(JSON.stringify(events)).not.toContain("http");
  });

  it("replays the patch tail before validating the frozen guide deck version", async () => {
    const checkpointDeck = deckFixture();
    checkpointDeck.version = 2;
    checkpointDeck.slides[0]!.title = "변경 전 제목";
    const harness = createHarness({
      checkpointDeck,
      patchRows: [{
        before_version: 2,
        after_version: 3,
        source: "user",
        operations: [{
          type: "update_slide",
          slideId: "slide_1",
          title: "핵심 슬라이드",
        }],
        created_at: "2026-07-17T00:00:00.000Z",
      }],
    });
    let providerRequest: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      providerRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(providerResponse(
        [0, 1, 2].map((index) => generatedItem(index)),
      ));
    }));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("succeeded");
    expect(providerRequest).toMatchObject({ deckVersion: 3 });
    expect((providerRequest as { slides: unknown[] } | null)?.slides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slideId: "slide_1",
          deckVersion: 3,
          title: "핵심 슬라이드",
        }),
      ]),
    );
  });

  it("uses the frozen deck snapshot after the live deck changes", async () => {
    const liveDeck = deckFixture();
    liveDeck.slides[0]!.title = "편집된 제목";
    const harness = createHarness({
      sourceSnapshotId: "snapshot_1",
      checkpointDeck: liveDeck,
    });
    let providerRequest: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      providerRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(providerResponse(
        [0, 1, 2].map((index) => generatedItem(index)),
      ));
    }));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("succeeded");
    expect((providerRequest as { slides: unknown[] } | null)?.slides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "핵심 슬라이드" }),
      ]),
    );
    expect(harness.queriedLiveDeck).toBe(false);
  });

  it("keeps a text-hash guide fresh after a visual-only edit", async () => {
    const frozenDeck = deckFixture();
    frozenDeck.slides[0]!.style = { backgroundColor: "#000000" };
    const harness = createHarness({
      contentHashVersion: "slide-text-v1",
      frozenSnapshotDeck: frozenDeck,
      sourceSnapshotId: "snapshot_1",
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(
      [0, 1, 2].map((index) => generatedItem(index, slideTextHash)),
    ))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("succeeded");
  });

  it("fails a text-hash guide after a text edit", async () => {
    const frozenDeck = deckFixture();
    frozenDeck.slides[0]!.title = "수정된 핵심 슬라이드";
    const harness = createHarness({
      contentHashVersion: "slide-text-v1",
      frozenSnapshotDeck: frozenDeck,
      sourceSnapshotId: "snapshot_1",
    });
    vi.stubGlobal("fetch", vi.fn());

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["snapshot ID", { snapshot_id: "snapshot_other" }, deckFixture()],
    ["project", { project_id: "project-other" }, deckFixture()],
    ["deck", { deck_id: "deck_other" }, deckFixture()],
    ["version", { version: 2 }, deckFixture()],
    ["target hash", {}, (() => {
      const deck = deckFixture();
      deck.slides[0]!.title = "다른 제목";
      return deck;
    })()],
  ])("fails safely when the frozen snapshot %s mismatches", async (_label, snapshotOverrides, snapshotDeck) => {
    const harness = createHarness({
      sourceSnapshotId: "snapshot_1",
      frozenSnapshotDeck: snapshotDeck,
      snapshotOverrides,
    });
    vi.stubGlobal("fetch", vi.fn());

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts another slide in the same frozen deck as answer evidence", async () => {
    const harness = createHarness();
    const items = [0, 1, 2].map((index) => generatedItem(index));
    items[0] = {
      ...items[0],
      keyConcepts: [{ label: "다음 단계", sourceRefs: [supportingSlideRef()] }],
      sourceRefs: [supportingSlideRef()],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(items))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("succeeded");
    expect(harness.insertedItems).toHaveLength(3);
  });

  it("rejects a provider source hash that was not in the frozen source snapshot", async () => {
    const harness = createHarness();
    const items = [0, 1, 2].map((index) => generatedItem(index));
    items[0] = {
      ...items[0],
      sourceRefs: [{ ...slideRef(), contentHash: "c".repeat(64) }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(items))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.result).toBeNull();
    expect(harness.insertedItems).toHaveLength(0);
  });

  it("accepts only an official web source returned in the provider allowlist", async () => {
    const harness = createHarness();
    const webSource = webRef();
    const items: Array<Record<string, unknown>> = [0, 1, 2].map((index) => ({
      ...generatedItem(index),
      keyConcepts: [{ label: "공식 근거", sourceRefs: [webSource] }],
      sourceRefs: [webSource],
    }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(
      items,
      [webSource],
    ))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("succeeded");
    expect(harness.insertedItems).toHaveLength(3);
    expect(harness.storedResearch?.officialSourceCount).toBe(1);
    expect(harness.storedResearch?.issueCodes).toEqual([]);
    expect(harness.storedResearchParameter).toBe("[]");
  });

  it("rejects a web citation that is not in the provider allowlist", async () => {
    const harness = createHarness();
    const items: Array<Record<string, unknown>> = [0, 1, 2].map((index) => generatedItem(index));
    items[0] = {
      ...items[0],
      sourceRefs: [webRef()],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(items))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(harness.insertedItems).toHaveLength(0);
  });

  it("emits only safe PostgreSQL diagnostics when guide persistence fails", async () => {
    const sensitiveSentinel = "private-question-guide-payload";
    const persistenceError = Object.assign(new Error(sensitiveSentinel), {
      driverError: {
        code: "22P02",
        detail: sensitiveSentinel,
      },
      query: sensitiveSentinel,
      parameters: [sensitiveSentinel],
    });
    const harness = createHarness({ persistenceError });
    const events: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(
      [0, 1, 2].map((index) => generatedItem(index)),
    ))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
      (event) => events.push(event),
    );

    expect(job.status).toBe("failed");
    expect(events.at(-1)).toEqual({
      event: "slide_question_guide.generation.failed",
      jobId: "job-guide-1",
      projectId: "project-1",
      guideId: "guide-1",
      stage: "guide-persistence",
      errorCode: "SLIDE_QUESTION_GUIDE_GENERATION_FAILED",
      postgresErrorCode: "22P02",
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(events.at(-1))).not.toContain(sensitiveSentinel);
  });

  it("does not let diagnostic logging failures change generation behavior", async () => {
    const harness = createHarness();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(
      [0, 1, 2].map((index) => generatedItem(index)),
    ))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
      () => {
        throw new Error("logger unavailable");
      },
    );

    expect(job.status).toBe("succeeded");
    expect(harness.storedResearch?.issueCodes).toEqual(["no-citations"]);
  });

  it("keeps Job persistence failures inside the safe diagnostic boundary", async () => {
    const sensitiveSentinel = "private-job-persistence-payload";
    const jobPersistenceError = Object.assign(new Error(sensitiveSentinel), {
      code: "57P01",
      detail: sensitiveSentinel,
      query: sensitiveSentinel,
    });
    const harness = createHarness({ jobPersistenceError });
    const events: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(providerResponse(
      [0, 1, 2].map((index) => generatedItem(index)),
    ))));

    const job = await processSlideQuestionGuideGenerationJob(
      harness.dataSource,
      "http://python-worker:8000",
      payload,
      (event) => events.push(event),
    );

    expect(job.status).toBe("failed");
    expect(events.at(-1)).toEqual({
      event: "slide_question_guide.generation.failed",
      jobId: "job-guide-1",
      projectId: "project-1",
      guideId: "guide-1",
      stage: "job-persistence",
      errorCode: "SLIDE_QUESTION_GUIDE_GENERATION_FAILED",
      postgresErrorCode: "57P01",
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(events.at(-1))).not.toContain(sensitiveSentinel);
  });
});

function createHarness(options: {
  contentHashVersion?: "slide-text-v1";
  checkpointDeck?: ReturnType<typeof deckFixture>;
  frozenSnapshotDeck?: ReturnType<typeof deckFixture>;
  sourceSnapshotId?: string;
  snapshotOverrides?: Record<string, unknown>;
  patchRows?: Array<Record<string, unknown>>;
  persistenceError?: Error;
  jobPersistenceError?: Error;
} = {}) {
  const insertedItems: unknown[] = [];
  let storedResearchSql: string | null = null;
  let storedResearchParameter: string | null = null;
  let storedResearch: {
    status: string;
    attempts: number;
    officialSourceCount: number;
    issueCodes: string[];
    researchedAt: string | null;
  } | null = null;
  let queriedLiveDeck = false;
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT * FROM slide_question_guides")) {
      return [guideRow(options.sourceSnapshotId, options.contentHashVersion)];
    }
    if (normalized.startsWith("SELECT snapshot_id, project_id")) {
      const frozenSnapshotDeck = options.frozenSnapshotDeck ?? deckFixture();
      return [{
        snapshot_id: options.sourceSnapshotId,
        project_id: "project-1",
        deck_id: "deck_1",
        deck_json: frozenSnapshotDeck,
        version: 3,
        ...options.snapshotOverrides,
      }];
    }
    if (normalized.startsWith("SELECT d.deck_json")) {
      queriedLiveDeck = true;
      const checkpointDeck = options.checkpointDeck ?? deckFixture();
      return [{
        deck_json: checkpointDeck,
        version: checkpointDeck.version,
        patch_rows: options.patchRows ?? [],
      }];
    }
    if (normalized.startsWith("SELECT chunks.id::text")) return [{
      chunk_id: "chunk-1",
      file_id: "file-1",
      content: "참고자료 근거",
      content_hash: referenceHash,
    }];
    if (normalized.startsWith("UPDATE jobs")) {
      if (parameters[1] === "succeeded" && options.jobPersistenceError) {
        throw options.jobPersistenceError;
      }
      return [jobRow(
        parameters[1] as "running" | "succeeded" | "failed",
        parameters[4] as Record<string, unknown> | null,
        parameters[5] as { code: string; message: string } | null,
      )];
    }
    return [];
  });
  const managerQuery = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("FOR UPDATE")) {
      return [{
        status: "running",
        deck_version: 3,
        slide_content_hash: options.contentHashVersion ? slideTextHash : slideHash,
      }];
    }
    if (normalized.startsWith("INSERT INTO slide_question_guide_items")) {
      insertedItems.push(parameters[4]);
    }
    if (normalized.startsWith("UPDATE slide_question_guides SET status = 'succeeded'")) {
      storedResearchSql = normalized;
      storedResearchParameter = String(parameters[6]);
      if (options.persistenceError) throw options.persistenceError;
      storedResearch = {
        status: String(parameters[3]),
        attempts: Number(parameters[4]),
        officialSourceCount: Number(parameters[5]),
        issueCodes: JSON.parse(storedResearchParameter) as string[],
        researchedAt: parameters[7] === null ? null : String(parameters[7]),
      };
    }
    return [];
  });
  const dataSource = {
    query,
    transaction: vi.fn(async (callback: (manager: { query: typeof managerQuery }) => Promise<void>) => (
      callback({ query: managerQuery })
    )),
  } as unknown as DataSource;
  return {
    dataSource,
    insertedItems,
    get storedResearch() { return storedResearch; },
    get storedResearchSql() { return storedResearchSql; },
    get storedResearchParameter() { return storedResearchParameter; },
    get queriedLiveDeck() { return queriedLiveDeck; },
  };
}

function guideRow(
  sourceSnapshotId?: string,
  contentHashVersion?: "slide-text-v1",
) {
  const contentHash = contentHashVersion ? slideTextHash : slideHash;
  return {
    guide_id: "guide-1",
    project_id: "project-1",
    deck_id: "deck_1",
    deck_version: 3,
    slide_id: "slide_1",
    slide_content_hash: contentHash,
    source_snapshot_json: {
      ...(sourceSnapshotId ? { deckSnapshotId: sourceSnapshotId } : {}),
      ...(contentHashVersion ? { contentHashVersion } : {}),
      slideId: "slide_1",
      deckVersion: 3,
      contentHash,
      title: "핵심 슬라이드",
      content: "슬라이드 근거",
    },
    status: "queued",
  };
}

function generatedItem(index: number, contentHash = slideHash) {
  return {
    questionType: ["evidence", "objection", "decision"][index],
    questionText: `질문 ${index + 1}`,
    supportState: "grounded",
    keyConcepts: [{ label: "핵심", sourceRefs: [slideRef(contentHash)] }],
    suggestedAnswer: {
      summary: "근거에 기반한 답변",
      structure: ["결론", "근거"],
      caveats: [],
    },
    remediation: null,
    sourceRefs: index === 2 ? [referenceRef()] : [slideRef(contentHash)],
  };
}

function slideRef(contentHash = slideHash) {
  return {
    kind: "slide" as const,
    slideId: "slide_1",
    objectId: null,
    deckVersion: 3,
    contentHash,
  };
}

function supportingSlideRef() {
  return {
    kind: "slide" as const,
    slideId: "slide_2",
    objectId: null,
    deckVersion: 3,
    contentHash: supportingSlideHash,
  };
}

function referenceRef() {
  return {
    kind: "reference" as const,
    fileId: "file-1",
    chunkId: "chunk-1",
    contentHash: referenceHash,
  };
}

function webRef() {
  return {
    kind: "web" as const,
    sourceId: "web:official-1",
    url: "https://example.edu/program",
    title: "공식 교육과정",
    authority: "official" as const,
    contentHash: "c".repeat(64),
    retrievedAt: "2026-07-17T00:00:00.000Z",
  };
}

function providerResponse(
  items: Array<Record<string, unknown>>,
  webSources: ReturnType<typeof webRef>[] = [],
) {
  return {
    items,
    model: "deterministic-grounded-v2",
    research: webSources.length > 0
      ? {
          status: "succeeded",
          attempts: 1,
          officialSourceCount: webSources.length,
          issueCodes: [],
          researchedAt: "2026-07-17T00:00:00.000Z",
        }
      : {
          status: "unavailable",
          attempts: 1,
          officialSourceCount: 0,
          issueCodes: ["no-citations"],
          researchedAt: "2026-07-17T00:00:00.000Z",
        },
    webSources,
    timings: {
      webSearchMs: 1_200,
      generationMs: 8_400,
      totalProviderMs: 9_600,
    },
  };
}

function deckFixture() {
  return {
    deckId: "deck_1",
    projectId: "project-1",
    title: "통합 발표",
    version: 3,
    metadata: {},
    targetDurationMinutes: 10,
    canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
    theme: {},
    slides: [
      slideFixture("slide_1", 1, "핵심 슬라이드", "현재 슬라이드 발표 대본"),
      slideFixture("slide_2", 2, "실행 계획", "다음 슬라이드 발표 대본"),
    ],
  };
}

function slideFixture(slideId: string, order: number, title: string, speakerNotes: string) {
  return {
    slideId,
    order,
    title,
    thumbnailUrl: "",
    style: {},
    speakerNotes,
    elements: [],
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
  };
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function jobRow(
  status: "running" | "succeeded" | "failed",
  result: Record<string, unknown> | null,
  error: { code: string; message: string } | null,
) {
  return {
    job_id: payload.jobId,
    project_id: payload.projectId,
    type: "slide-question-guide-generation",
    status,
    progress: status === "running" ? 20 : 100,
    message: "updated",
    result,
    error,
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: "2026-07-17T00:00:01.000Z",
  };
}
