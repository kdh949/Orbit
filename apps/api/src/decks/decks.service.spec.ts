import { HttpException, HttpStatus } from "@nestjs/common";
import { createActivitySlide, createAddSlidePatch } from "@orbit/editor-core";
import {
  deckApiErrorSchema,
  deckSchema,
  createKeywordOccurrenceId,
  jobSchema,
  type Deck,
  type DeckApiError,
  type DeckElement,
  type DeckPatch,
  type DeckSnapshotReason,
} from "@orbit/shared";
import type { DataSource, EntityManager } from "typeorm";
import type { PinoLogger } from "nestjs-pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecksService } from "./decks.service";

type StoredDeckRow = {
  project_id: string;
  deck_id: string;
  deck_json: unknown;
  version: number;
  updated_at: string;
};

type StoredPatchRow = {
  change_id: string;
  project_id: string;
  deck_id: string;
  before_version: number;
  after_version: number;
  source: string;
  actor_user_id: string | null;
  operations: DeckPatch["operations"];
  created_at: string;
};

type StoredSnapshotRow = {
  snapshot_id: string;
  project_id: string;
  deck_id: string;
  deck_json: unknown;
  version: number;
  reason: DeckSnapshotReason;
  created_at: string;
};

type StoredTemplateBlueprintRow = {
  template_id: string;
  project_id: string;
  deck_id: string;
  blueprint_json: unknown;
  quality_report_json?: unknown;
};

class InMemoryDeckDataSource {
  readonly decks = new Map<string, StoredDeckRow>();
  readonly projectTitles = new Map<string, string>();
  readonly patchRows: StoredPatchRow[] = [];
  readonly snapshotRows: StoredSnapshotRow[] = [];
  readonly templateBlueprintRows: StoredTemplateBlueprintRow[] = [];
  readonly executedQueries: string[] = [];
  readonly exportSessionIds = new Set<string>();

  async transaction<T>(
    run: (manager: InMemoryDeckDataSource) => Promise<T>,
  ): Promise<T> {
    return run(this);
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const query = normalizeSql(sql);
    this.executedQueries.push(query);

    if (query.startsWith("SELECT deck_id FROM decks")) {
      const [projectId, deckId] = params as [string, string];
      const row = this.decks.get(projectId);
      return (row?.deck_id === deckId ? [{ deck_id: deckId }] : []) as T;
    }

    if (query.includes("FROM presentation_sessions")) {
      const [projectId, deckId, sessionId] = params as [string, string, string];
      return (
        projectId === "project_demo_1" &&
        deckId === "deck_demo_1" &&
        this.exportSessionIds.has(sessionId)
          ? [{ session_id: sessionId }]
          : []
      ) as T;
    }

    if (
      query.startsWith("SELECT project_id, deck_id, deck_json, version") &&
      query.includes("WHERE project_id = $1 AND deck_id = $2")
    ) {
      const [projectId, deckId] = params as [string, string];
      const row = this.decks.get(projectId);
      return (row && row.deck_id === deckId ? [cloneDeckRow(row)] : []) as T;
    }

    if (
      query.startsWith("SELECT project_id, deck_id, deck_json, version") &&
      query.includes("WHERE project_id = $1")
    ) {
      const [projectId] = params as [string];
      const row = this.decks.get(projectId);
      return (row ? [cloneDeckRow(row)] : []) as T;
    }

    if (
      query.startsWith("SELECT change_id, project_id, deck_id") &&
      query.includes(
        "WHERE project_id = $1 AND deck_id = $2 AND after_version > $3",
      )
    ) {
      const [projectId, deckId, version] = params as [string, string, number];
      return this.patchRows
        .filter(
          (row) =>
            row.project_id === projectId &&
            row.deck_id === deckId &&
            row.after_version > version,
        )
        .sort((left, right) =>
          left.after_version !== right.after_version
            ? left.after_version - right.after_version
            : left.created_at.localeCompare(right.created_at),
        )
        .map(clonePatchRow) as T;
    }

    if (query.startsWith("INSERT INTO decks")) {
      const [projectId, deckId, deck, version, updatedAt] = params as [
        string,
        string,
        Deck,
        number,
        string,
      ];
      const row: StoredDeckRow = {
        project_id: projectId,
        deck_id: deckId,
        deck_json: cloneJson(deck),
        version,
        updated_at: updatedAt,
      };

      this.decks.set(projectId, row);
      return [cloneDeckRow(row)] as T;
    }

    if (query.startsWith("UPDATE projects SET title = $2")) {
      const [projectId, title] = params as [string, string];
      this.projectTitles.set(projectId, title);
      return [] as T;
    }

    if (query.startsWith("INSERT INTO deck_patches")) {
      const [
        changeId,
        projectId,
        deckId,
        beforeVersion,
        afterVersion,
        source,
        actorUserId,
        operations,
        createdAt,
      ] = params as [
        string,
        string,
        string,
        number,
        number,
        string,
        string | null,
        DeckPatch["operations"] | string,
        string,
      ];
      const normalizedOperations =
        typeof operations === "string"
          ? (JSON.parse(operations) as DeckPatch["operations"])
          : operations;

      this.patchRows.push({
        change_id: changeId,
        project_id: projectId,
        deck_id: deckId,
        before_version: beforeVersion,
        after_version: afterVersion,
        source,
        actor_user_id: actorUserId,
        operations: cloneJson(normalizedOperations),
        created_at: createdAt,
      });
      return [] as T;
    }

    if (query.startsWith("INSERT INTO deck_snapshots")) {
      const [snapshotId, projectId, deckId, deck, version, reason, createdAt] =
        params as [
          string,
          string,
          string,
          Deck,
          number,
          DeckSnapshotReason,
          string,
        ];
      const row: StoredSnapshotRow = {
        snapshot_id: snapshotId,
        project_id: projectId,
        deck_id: deckId,
        deck_json: cloneJson(deck),
        version,
        reason,
        created_at: createdAt,
      };

      this.snapshotRows.push(row);
      return [cloneSnapshotRow(row)] as T;
    }

    if (
      query.startsWith("DELETE FROM deck_patches") &&
      query.includes(
        "WHERE project_id = $1 AND deck_id = $2 AND after_version > $3",
      )
    ) {
      const [projectId, deckId, version] = params as [string, string, number];
      for (let index = this.patchRows.length - 1; index >= 0; index -= 1) {
        const row = this.patchRows[index];
        if (
          row?.project_id === projectId &&
          row.deck_id === deckId &&
          row.after_version > version
        ) {
          this.patchRows.splice(index, 1);
        }
      }
      return [] as T;
    }

    if (
      query.startsWith("DELETE FROM deck_patches") &&
      query.includes(
        "WHERE project_id = $1 AND deck_id = $2 AND after_version <= $3",
      )
    ) {
      const [projectId, deckId, version] = params as [string, string, number];
      for (let index = this.patchRows.length - 1; index >= 0; index -= 1) {
        const row = this.patchRows[index];
        if (
          row?.project_id === projectId &&
          row.deck_id === deckId &&
          row.after_version <= version
        ) {
          this.patchRows.splice(index, 1);
        }
      }
      return [] as T;
    }

    if (
      query.startsWith("SELECT snapshot_id, project_id, deck_id") &&
      query.includes("WHERE project_id = $1 AND deck_id = $2 AND version = $3")
    ) {
      const [projectId, deckId, version] = params as [string, string, number];
      const row = this.snapshotRows
        .filter((snapshot) => (
          snapshot.project_id === projectId &&
          snapshot.deck_id === deckId &&
          snapshot.version === version
        ))
        .sort(compareSnapshotRows)[0];
      return (row ? [cloneSnapshotRow(row)] : []) as T;
    }

    if (
      query.startsWith("SELECT snapshot_id, project_id, deck_id") &&
      query.includes("WHERE project_id = $1")
    ) {
      const [projectId] = params as [string];
      const rows = this.snapshotRows
        .filter((row) => row.project_id === projectId)
        .sort(compareSnapshotRows)
        .map(cloneSnapshotRow);
      return rows as T;
    }

    if (
      query.startsWith("SELECT quality_report_json") &&
      query.includes("FROM template_blueprints")
    ) {
      const [projectId, deckId] = params as [string, string];
      return this.templateBlueprintRows
        .filter((row) => row.project_id === projectId && row.deck_id === deckId)
        .map((row) => ({
          quality_report_json:
            row.quality_report_json === undefined
              ? undefined
              : cloneJson(row.quality_report_json),
        })) as T;
    }

    if (
      query.startsWith("SELECT template_id, blueprint_json") &&
      query.includes("FROM template_blueprints")
    ) {
      const [projectId, deckId] = params as [string, string];
      return this.templateBlueprintRows
        .filter((row) => row.project_id === projectId && row.deck_id === deckId)
        .map((row) => ({
          template_id: row.template_id,
          blueprint_json: cloneJson(row.blueprint_json),
        })) as T;
    }

    if (
      query.startsWith("UPDATE template_blueprints") &&
      query.includes("WHERE template_id = $1")
    ) {
      const [templateId, blueprint] = params as [string, unknown];
      const row = this.templateBlueprintRows.find(
        (candidate) => candidate.template_id === templateId,
      );
      if (row) row.blueprint_json = cloneJson(blueprint);
      return [] as T;
    }

    if (
      query.startsWith("SELECT snapshot_id, project_id, deck_id") &&
      query.includes("WHERE snapshot_id = $1")
    ) {
      const [snapshotId] = params as [string];
      const row = this.snapshotRows.find(
        (snapshot) => snapshot.snapshot_id === snapshotId,
      );
      return (row ? [cloneSnapshotRow(row)] : []) as T;
    }

    throw new Error(`Unhandled test query: ${query}`);
  }
}

function createService() {
  const dataSource = new InMemoryDeckDataSource();
  const service = new DecksService(dataSource as unknown as DataSource);

  return { dataSource, service };
}

function createJob(
  jobId = "job_sync_1",
  type:
    | "pptx-ooxml-sync"
    | "deck-export"
    | "semantic-cue-extraction"
    | "speaker-notes-suggestion" = "pptx-ooxml-sync",
) {
  return jobSchema.parse({
    jobId,
    projectId: "project_demo_1",
    type,
    status: "queued",
    progress: 0,
    message: "Job queued",
    result: null,
    error: null,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
  });
}

function createLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
}

function stubOrbitEnv() {
  const values = {
    NODE_ENV: "test",
    APP_ENV: "local",
    WEB_PORT: "5173",
    API_PORT: "3000",
    WORKER_PORT: "3001",
    PYTHON_WORKER_PORT: "8000",
    WEB_ORIGIN: "http://localhost:5173",
    API_BASE_URL: "http://localhost:3000",
    PYTHON_WORKER_URL: "http://localhost:8000",
    DATABASE_URL: "postgres://orbit:orbit@localhost:5432/orbit",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "local-session-secret-change-me",
    COOKIE_SECRET: "local-cookie-secret-change-me",
    STORAGE_DRIVER: "minio",
    S3_ENDPOINT: "http://localhost:9000",
    S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "orbit-local",
    S3_REGION: "ap-northeast-2",
    S3_ACCESS_KEY_ID: "orbit",
    S3_SECRET_ACCESS_KEY: "orbit-password",
    S3_FORCE_PATH_STYLE: "true",
    JOB_QUEUE_DRIVER: "bullmq",
    LIVE_STT_PROVIDER: "sherpa",
    REPORT_STT_PROVIDER: "openai",
    OCR_PROVIDER: "python",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    AWS_REGION: "ap-northeast-2",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    TRANSCRIBE_LANGUAGE_CODE: "ko-KR",
    TEXTRACT_ENABLED: "false",
    LOG_LEVEL: "debug",
    LOG_PRETTY: "false",
    DEMO_USER_ID: "user_demo_1",
    DEMO_WORKSPACE_ID: "workspace_demo_1",
    DEMO_PROJECT_ID: "project_demo_1",
    DEMO_DECK_ID: "deck_demo_1",
    DEMO_SESSION_ID: "session_demo_1",
  };

  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
}

function createDeck(): Deck {
  return deckSchema.parse({
    deckId: "deck_demo_1",
    projectId: "project_demo_1",
    title: "ORBIT Demo Deck",
    version: 1,
    metadata: {
      language: "ko",
      locale: "ko-KR",
    },
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
        title: "소개",
      },
    ],
  });
}

function createTextElement(
  elementId: string,
  text: string,
  x = 100,
): DeckElement {
  return {
    elementId,
    type: "text",
    role: "body",
    x,
    y: 120,
    width: 480,
    height: 120,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    visible: true,
    props: {
      text,
      fontSize: 32,
      fontWeight: "normal",
      color: "#111827",
      align: "left",
      verticalAlign: "top",
      lineHeight: 1.2,
    },
  };
}

function createRepeatedKeywordDeck(): Deck {
  const deck = createDeck();

  return deckSchema.parse({
    ...deck,
    slides: [
      {
        ...deck.slides[0],
        speakerNotes: "ORBIT 흐름은 ORBIT 대본으로 설명합니다.",
        keywords: [
          {
            keywordId: "kw_orbit",
            text: "ORBIT",
            synonyms: [],
            abbreviations: [],
            required: true,
          },
        ],
      },
    ],
  });
}

function createLegacyKeywordDeck(deck: Deck): Deck {
  const legacyDeck = cloneJson(deck);

  legacyDeck.slides[0].keywords = [
    {
      keywordId: "kw_one",
      text: " ORBIT ",
      synonyms: ["발표 도우미", "", "발표 도우미"],
      abbreviations: ["OD", "od", " "],
      required: true,
    },
    {
      keywordId: "kw_two",
      text: "orbit",
      synonyms: ["ORBIT", "리허설"],
      abbreviations: ["발표 도우미", "STT"],
      required: true,
    },
  ];

  return legacyDeck;
}

function createNormalizedLegacyKeywords(): Deck["slides"][number]["keywords"] {
  return [
    {
      keywordId: "kw_one",
      text: "ORBIT",
      synonyms: ["발표 도우미", "리허설"],
      abbreviations: ["OD", "STT"],
      required: true,
    },
  ];
}

function seedStoredDeck(
  dataSource: InMemoryDeckDataSource,
  deck: Deck,
  deckJson: unknown,
): void {
  dataSource.decks.set(deck.projectId, {
    project_id: deck.projectId,
    deck_id: deck.deckId,
    deck_json: cloneJson(deckJson),
    version: deck.version,
    updated_at: "2026-06-29T00:00:00.000Z",
  });
}

function createUpdateTitlePatch(
  deck: Deck,
  title: string,
  baseVersion = deck.version,
): DeckPatch {
  return {
    deckId: deck.deckId,
    baseVersion,
    source: "user",
    operations: [
      {
        type: "update_deck",
        title,
      },
    ],
  };
}

function createAddOccurrenceNextSlideActionPatch(
  deck: Deck,
  occurrenceId: string,
): DeckPatch {
  const slide = deck.slides[0]!;

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations: [
      {
        type: "add_slide_action",
        slideId: slide.slideId,
        action: {
          actionId: "act_second_orbit_next",
          trigger: {
            kind: "keyword-occurrence",
            keywordId: "kw_orbit",
            occurrenceId,
          },
          effect: {
            kind: "go-to-next-slide",
          },
        },
      },
    ],
  };
}

async function expectDeckApiError(
  action: () => Promise<unknown>,
  status: HttpStatus,
  code: DeckApiError["code"],
): Promise<DeckApiError> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof HttpException)) {
      throw error;
    }

    const body = deckApiErrorSchema.parse(error.getResponse());
    expect(error.getStatus()).toBe(status);
    expect(body.code).toBe(code);
    return body;
  }

  throw new Error(`Expected Deck API error: ${code}`);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function cloneDeckRow(row: StoredDeckRow): StoredDeckRow {
  return {
    ...row,
    deck_json: cloneJson(row.deck_json),
  };
}

function cloneSnapshotRow(row: StoredSnapshotRow): StoredSnapshotRow {
  return {
    ...row,
    deck_json: cloneJson(row.deck_json),
  };
}

function clonePatchRow(row: StoredPatchRow): StoredPatchRow {
  return {
    ...row,
    operations: cloneJson(row.operations),
  };
}

function compareSnapshotRows(
  a: StoredSnapshotRow,
  b: StoredSnapshotRow,
): number {
  const createdAtOrder = b.created_at.localeCompare(a.created_at);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }

  const versionOrder = b.version - a.version;
  return versionOrder === 0
    ? b.snapshot_id.localeCompare(a.snapshot_id)
    : versionOrder;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("DecksService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores and reads a current deck with an automatic snapshot", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();

    const putResponse = await service.putDeck(deck.projectId, { deck });
    const getResponse = await service.getDeck(deck.projectId);
    const snapshotResponse = await service.listSnapshots(deck.projectId);

    expect(putResponse.deck).toMatchObject({
      deckId: deck.deckId,
      projectId: deck.projectId,
      title: deck.title,
      version: 1,
    });
    expect(putResponse.snapshot).toMatchObject({
      projectId: deck.projectId,
      deckId: deck.deckId,
      version: 1,
      reason: "deck-replaced",
    });
    expect(putResponse.snapshot.snapshotId).toMatch(/^snapshot_/);
    expect(getResponse.deck.title).toBe(deck.title);
    expect(dataSource.projectTitles.get(deck.projectId)).toBe(deck.title);
    expect(snapshotResponse.snapshots).toHaveLength(1);
    expect(snapshotResponse.snapshots[0]?.snapshotId).toBe(
      putResponse.snapshot.snapshotId,
    );
  });

  it("materializes and locks patch-only activity slides for transactional reads", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    const activitySlide = createActivitySlide(deck, "pre-question");
    seedStoredDeck(dataSource, deck, deck);
    dataSource.patchRows.push({
      change_id: "change_add_activity",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      before_version: 1,
      after_version: 2,
      source: "user",
      actor_user_id: null,
      operations: createAddSlidePatch(deck, activitySlide).operations,
      created_at: "2026-07-19T00:00:00.000Z",
    });

    const materialized = await service.getDeckForUpdate(
      dataSource as unknown as EntityManager,
      deck.projectId,
      deck.deckId,
    );

    expect(materialized.version).toBe(2);
    expect(materialized.slides).toContainEqual(
      expect.objectContaining({
        kind: "activity",
        slideId: activitySlide.slideId,
      }),
    );
    expect(
      dataSource.executedQueries.some(
        (query) =>
          query.includes("FROM decks") &&
          query.includes("WHERE project_id = $1 AND deck_id = $2") &&
          query.includes("FOR UPDATE"),
      ),
    ).toBe(true);
    expect(
      dataSource.executedQueries.some(
        (query) =>
          query.includes("FROM deck_patches") && query.includes("FOR UPDATE"),
      ),
    ).toBe(true);
  });

  it("creates at most one reusable snapshot for the same current deck version", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    seedStoredDeck(dataSource, deck, deck);

    const first = await service.getOrCreateSnapshot(deck);
    const second = await service.getOrCreateSnapshot(deck);

    expect(first).toMatchObject({ reason: "auto-save", version: deck.version });
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(dataSource.snapshotRows).toHaveLength(1);
  });

  it("reads persisted PPTX import quality without changing the Deck", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    seedStoredDeck(dataSource, deck, deck);
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {},
      quality_report_json: {
        compositeScore: 82,
        metrics: {
          geometry: 90,
          text: 80,
          color: 80,
          layer: 90,
          editability: 60,
          pixelSimilarity: null,
        },
        weights: {
          geometry: 25,
          text: 15,
          color: 10,
          layer: 10,
          editability: 10,
          pixelSimilarity: 30,
        },
        editabilityCoverage: 0.6,
        appliedCap: null,
        slideReports: [],
        notes: ["pixel renderer unavailable"],
      },
    });

    await expect(service.getPptxImportQuality(deck.projectId)).resolves.toEqual({
      importQuality: {
        qualityReport: expect.objectContaining({ compositeScore: 82 }),
      },
    });
    expect(dataSource.decks.get(deck.projectId)?.version).toBe(deck.version);
  });

  it("returns null when an import quality sidecar is absent or invalid", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    seedStoredDeck(dataSource, deck, deck);

    await expect(service.getPptxImportQuality(deck.projectId)).resolves.toEqual({
      importQuality: null,
    });

    dataSource.templateBlueprintRows.push({
      template_id: "template_invalid_quality",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {},
      quality_report_json: { compositeScore: "invalid" },
    });
    await expect(service.getPptxImportQuality(deck.projectId)).resolves.toEqual({
      importQuality: null,
    });
  });

  it("normalizes legacy keyword terms when reading stored deck JSON", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();

    seedStoredDeck(dataSource, deck, createLegacyKeywordDeck(deck));

    const response = await service.getDeck(deck.projectId);

    expect(response.deck.slides[0].keywords).toEqual(
      createNormalizedLegacyKeywords(),
    );
  });

  it("normalizes legacy numeric keyword IDs when reading stored deck JSON", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    const legacyDeck = createLegacyKeywordDeck(deck);
    legacyDeck.slides[0].keywords[0].keywordId = 1 as unknown as string;

    seedStoredDeck(dataSource, deck, legacyDeck);

    const response = await service.getDeck(deck.projectId);

    expect(response.deck.slides[0].keywords[0]?.keywordId).toBe("kw_legacy_1");
  });

  it("uses stored deck row IDs when legacy deck JSON identity is stale", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    const staleDeck = {
      ...deck,
      projectId: "project_stale",
      deckId: "deck_stale",
    };

    seedStoredDeck(dataSource, deck, staleDeck);

    const response = await service.getDeck(deck.projectId);

    expect(response.deck.projectId).toBe(deck.projectId);
    expect(response.deck.deckId).toBe(deck.deckId);
  });

  it("normalizes legacy keyword terms before applying patches", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();

    seedStoredDeck(dataSource, deck, createLegacyKeywordDeck(deck));

    const response = await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "수정된 덱"),
    });
    const getResponse = await service.getDeck(deck.projectId);

    expect(response.deck.title).toBe("수정된 덱");
    expect(response.deck.slides[0].keywords).toEqual(
      createNormalizedLegacyKeywords(),
    );
    expect(getResponse.deck).toMatchObject({
      title: "수정된 덱",
      slides: [
        {
          keywords: createNormalizedLegacyKeywords(),
        },
      ],
    });
  });

  it("applies a patch, increments the deck version, and stores change history", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    const patchResponse = await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "수정된 덱"),
    });
    const getResponse = await service.getDeck(deck.projectId);
    const snapshotResponse = await service.listSnapshots(deck.projectId);

    expect(patchResponse.deck.title).toBe("수정된 덱");
    expect(dataSource.projectTitles.get(deck.projectId)).toBe("수정된 덱");
    expect(patchResponse.deck.version).toBe(2);
    expect(patchResponse.changeRecord).toMatchObject({
      deckId: deck.deckId,
      beforeVersion: 1,
      afterVersion: 2,
      source: "user",
    });
    expect(patchResponse.snapshot).toBeNull();
    expect(dataSource.patchRows).toHaveLength(1);
    expect(dataSource.patchRows[0]).toMatchObject({
      deck_id: deck.deckId,
      before_version: 1,
      after_version: 2,
    });
    expect(dataSource.decks.get(deck.projectId)?.version).toBe(1);
    expect(getResponse.deck.version).toBe(2);
    expect(getResponse.deck.title).toBe("수정된 덱");
    expect(
      snapshotResponse.snapshots.map((snapshot) => snapshot.version).sort(),
    ).toEqual([1]);
  });

  it("returns a lightweight acknowledgement when requested", async () => {
    const { service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    const response = await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "Ack title"),
      responseMode: "ack",
    });
    const persisted = await service.getDeck(deck.projectId);

    expect(response).not.toHaveProperty("deck");
    expect(response).toMatchObject({
      deckId: deck.deckId,
      version: 2,
      changeRecord: {
        beforeVersion: 1,
        afterVersion: 2,
      },
    });
    expect(response.snapshot).toBeUndefined();
    expect(persisted.deck).toMatchObject({ title: "Ack title", version: 2 });
  });

  it("persists keyword occurrence action triggers in checkpointed deck JSON", async () => {
    const { dataSource, service } = createService();
    const deck = createRepeatedKeywordDeck();
    const occurrenceId = createKeywordOccurrenceId(
      deck.slides[0]!.slideId,
      "kw_orbit",
      10,
      15,
    );
    await service.putDeck(deck.projectId, { deck });

    expect(deck.slides[0]!.actions).toEqual([]);

    const response = await service.appendPatch(deck.projectId, {
      patch: createAddOccurrenceNextSlideActionPatch(deck, occurrenceId),
      snapshotReason: "patch-applied",
    });
    const persistedDeck = deckSchema.parse(
      dataSource.decks.get(deck.projectId)?.deck_json,
    );

    expect(response.deck.slides[0]!.actions).toHaveLength(1);
    expect(response.deck.slides[0]!.actions[0]?.trigger).toEqual({
      kind: "keyword-occurrence",
      keywordId: "kw_orbit",
      occurrenceId,
    });
    expect(persistedDeck.slides[0]!.actions[0]?.trigger).toEqual({
      kind: "keyword-occurrence",
      keywordId: "kw_orbit",
      occurrenceId,
    });
  });

  it("enqueues OOXML sync after patching an OOXML-backed deck", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const syncJob = createJob();
    const jobsService = {
      create: vi.fn(async () => syncJob),
      update: vi.fn(),
    };
    const enqueueSyncJob = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      enqueueSyncJob,
    );

    await service.putDeck(deck.projectId, { deck });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });

    const response = await service.appendPatch(deck.projectId, {
      patch: {
        deckId: deck.deckId,
        baseVersion: deck.version,
        source: "user",
        operations: [
          {
            type: "add_element",
            slideId: deck.slides[0]!.slideId,
            element: {
              elementId: "el_sync_text",
              type: "text",
              role: "body",
              x: 120,
              y: 140,
              width: 520,
              height: 120,
              rotation: 0,
              opacity: 1,
              zIndex: 1,
              locked: false,
              visible: true,
              props: {
                text: "OOXML sync target",
                fontSize: 32,
              },
            },
          },
        ],
      },
    });

    expect(response.ooxmlSyncJob?.jobId).toBe(syncJob.jobId);
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: deck.projectId,
      type: "pptx-ooxml-sync",
      payload: {
        deckId: deck.deckId,
        changeId: response.changeRecord.changeId,
        targetDeckVersion: 2,
      },
    });
    expect(enqueueSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: syncJob.jobId,
        projectId: deck.projectId,
        deckId: deck.deckId,
        targetDeckVersion: 2,
      }),
    );
    expect(dataSource.decks.get(deck.projectId)).toMatchObject({
      version: 2,
      deck_json: expect.objectContaining({
        version: 2,
        slides: [
          expect.objectContaining({
            elements: [expect.objectContaining({ elementId: "el_sync_text" })],
          }),
        ],
      }),
    });
  });

  it("normalizes an imported full save, records its OOXML diff, and enqueues sync", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const syncJob = createJob("job_sync_put");
    const jobsService = {
      create: vi.fn(async () => syncJob),
      update: vi.fn(),
    };
    const enqueueSyncJob = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      enqueueSyncJob,
    );
    const base = createDeck();
    const current = deckSchema.parse({
      ...base,
      version: 2,
      slides: [
        {
          ...base.slides[0],
          elements: [
            createTextElement("el_keep", "Before"),
            createTextElement("el_delete", "Delete", 700),
          ],
        },
      ],
    });
    await service.putDeck(current.projectId, { deck: current });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: current.projectId,
      deck_id: current.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        sourcePackageFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 2,
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });
    const requested = deckSchema.parse({
      ...current,
      version: 1,
      slides: [
        {
          ...current.slides[0],
          elements: [
            createTextElement("el_keep", "After", 180),
            createTextElement("el_add", "Add", 900),
          ],
        },
      ],
    });

    const response = await service.putDeck(current.projectId, {
      baseVersion: current.version,
      deck: requested,
    });

    expect(response.deck.version).toBe(3);
    expect(response.ooxmlSyncJob?.jobId).toBe(syncJob.jobId);
    expect(dataSource.patchRows).toHaveLength(1);
    expect(dataSource.patchRows[0]).toMatchObject({
      before_version: 2,
      after_version: 3,
      operations: expect.arrayContaining([
        expect.objectContaining({
          type: "delete_element",
          elementId: "el_delete",
        }),
        expect.objectContaining({
          type: "update_element_frame",
          elementId: "el_keep",
        }),
        expect.objectContaining({
          type: "update_element_props",
          elementId: "el_keep",
          props: { text: "After" },
        }),
        expect.objectContaining({
          type: "add_element",
          element: expect.objectContaining({ elementId: "el_add" }),
        }),
      ]),
    });
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: current.projectId,
      type: "pptx-ooxml-sync",
      payload: {
        deckId: current.deckId,
        changeId: "change_deck_demo_1_3_put",
        targetDeckVersion: 3,
      },
    });
    expect(enqueueSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: syncJob.jobId,
        deckId: current.deckId,
        targetDeckVersion: 3,
      }),
    );
  });

  it("records an imported full-save slide reorder as one exact permutation", async () => {
    const { dataSource, service } = createService();
    const base = createDeck();
    const slideIds = ["slide_cover", "slide_metrics", "slide_close"];
    const current = deckSchema.parse({
      ...base,
      version: 2,
      slides: Array.from({ length: 3 }, (_, index) => ({
        ...base.slides[0],
        slideId: slideIds[index],
        order: index + 1,
        title: `Slide ${index + 1}`,
      })),
    });
    await service.putDeck(current.projectId, { deck: current });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: current.projectId,
      deck_id: current.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 2,
        slides: Array.from({ length: 3 }, (_, index) => ({
          slideIndex: index + 1,
          sourceSlideIndex: index + 1,
          sourceSlidePart: `ppt/slides/slide${index + 1}.xml`,
          slots: [],
        })),
      },
    });
    const requested = deckSchema.parse({
      ...current,
      slides: [
        { ...current.slides[2], order: 1 },
        { ...current.slides[0], order: 2 },
        { ...current.slides[1], order: 3 },
      ],
    });

    await service.putDeck(current.projectId, {
      baseVersion: current.version,
      deck: requested,
    });

    expect(dataSource.patchRows).toHaveLength(1);
    expect(dataSource.patchRows[0]?.operations).toEqual([
      {
        type: "reorder_slides",
        slideOrders: [
          { slideId: "slide_close", order: 1 },
          { slideId: "slide_cover", order: 2 },
          { slideId: "slide_metrics", order: 3 },
        ],
      },
    ]);
    expect(
      dataSource.templateBlueprintRows[0]?.blueprint_json,
    ).toMatchObject({
      slides: [
        { slideId: "slide_cover", sourceSlidePart: "ppt/slides/slide1.xml" },
        {
          slideId: "slide_metrics",
          sourceSlidePart: "ppt/slides/slide2.xml",
        },
        { slideId: "slide_close", sourceSlidePart: "ppt/slides/slide3.xml" },
      ],
    });
  });

  it("rejects an imported full save with a non-permutation slide order", async () => {
    const { dataSource, service } = createService();
    const base = createDeck();
    const current = deckSchema.parse({
      ...base,
      version: 2,
      slides: [
        { ...base.slides[0], slideId: "slide_ooxml_file_1", order: 1 },
        { ...base.slides[0], slideId: "slide_ooxml_file_2", order: 2 },
      ],
    });
    await service.putDeck(current.projectId, { deck: current });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: current.projectId,
      deck_id: current.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 2,
        slides: [
          { slideIndex: 1, sourceSlideIndex: 1, slots: [] },
          { slideIndex: 2, sourceSlideIndex: 2, slots: [] },
        ],
      },
    });

    const error = await expectDeckApiError(
      () =>
        service.putDeck(current.projectId, {
          baseVersion: current.version,
          deck: {
            ...current,
            slides: current.slides.map((slide) => ({ ...slide, order: 1 })),
          },
        }),
      HttpStatus.BAD_REQUEST,
      "DECK_VALIDATION_FAILED",
    );

    expect(error.message).toContain("exact permutations");
    expect(dataSource.patchRows).toHaveLength(0);
  });

  it("diffs equal element IDs independently across imported slides", async () => {
    const { dataSource, service } = createService();
    const base = createDeck();
    const current = deckSchema.parse({
      ...base,
      version: 2,
      slides: [
        {
          ...base.slides[0],
          elements: [createTextElement("el_shared", "First slide")],
        },
        {
          ...base.slides[0],
          slideId: "slide_second",
          order: 2,
          title: "Second slide",
          elements: [createTextElement("el_shared", "Before")],
        },
      ],
    });
    await service.putDeck(current.projectId, { deck: current });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: current.projectId,
      deck_id: current.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 2,
        slides: [
          { slideIndex: 1, sourceSlideIndex: 1, slots: [] },
          { slideIndex: 2, sourceSlideIndex: 2, slots: [] },
        ],
      },
    });
    const requested = deckSchema.parse({
      ...current,
      slides: [
        current.slides[0],
        {
          ...current.slides[1],
          elements: [createTextElement("el_shared", "After", 180)],
        },
      ],
    });

    await service.putDeck(current.projectId, {
      baseVersion: current.version,
      deck: requested,
    });

    expect(dataSource.patchRows).toHaveLength(1);
    expect(dataSource.patchRows[0]?.operations).toEqual([
      expect.objectContaining({
        type: "update_element_frame",
        slideId: "slide_second",
        elementId: "el_shared",
      }),
      expect.objectContaining({
        type: "update_element_props",
        slideId: "slide_second",
        elementId: "el_shared",
        props: expect.objectContaining({ text: "After" }),
      }),
    ]);
  });

  it("persists every imported patch and retains unsynced patch history", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 1,
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });

    const firstResponse = await service.appendPatch(deck.projectId, {
      patch: {
        deckId: deck.deckId,
        baseVersion: 1,
        source: "user",
        operations: [
          {
            type: "add_element",
            slideId: deck.slides[0]!.slideId,
            element: createTextElement("el_unsynced", "Unsynced"),
          },
        ],
      },
    });
    const secondResponse = await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(
        firstResponse.deck,
        "Imported deck second patch",
      ),
    });
    const fullResponse = await service.putDeck(deck.projectId, {
      baseVersion: secondResponse.deck.version,
      deck: {
        ...secondResponse.deck,
        title: "Imported deck full save",
        version: 1,
      },
    });

    expect(firstResponse.deck.version).toBe(2);
    expect(secondResponse.deck.version).toBe(3);
    expect(fullResponse.deck.version).toBe(4);
    expect(dataSource.decks.get(deck.projectId)).toMatchObject({
      version: 4,
      deck_json: expect.objectContaining({
        title: "Imported deck full save",
        version: 4,
      }),
    });
    expect(dataSource.patchRows.map((row) => row.after_version)).toEqual([
      2, 3, 4,
    ]);
  });

  it("enqueues PPTX export with the current deck snapshot", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const exportJob = createJob("job_export_1", "deck-export");
    const jobsService = {
      create: vi.fn(async () => exportJob),
      update: vi.fn(),
    };
    const enqueueExportJob = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      vi.fn(async () => undefined),
      enqueueExportJob,
    );

    await service.putDeck(deck.projectId, { deck });
    const response = await service.createExportJob(deck.projectId, {
      format: "pptx",
    });

    expect(response.job.jobId).toBe(exportJob.jobId);
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: deck.projectId,
      type: "deck-export",
      payload: {
        deckId: deck.deckId,
        format: "pptx",
      },
    });
    expect(enqueueExportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: exportJob.jobId,
        projectId: deck.projectId,
        deck: expect.objectContaining({
          deckId: deck.deckId,
          slides: deck.slides,
        }),
        format: "pptx",
      }),
    );
  });

  it("marks the export Job failed and returns a structured 503 when enqueue is unavailable", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const exportJob = createJob("job_export_failed", "deck-export");
    const failedJob = jobSchema.parse({
      ...exportJob,
      status: "failed",
      progress: 0,
      message: "Deck export queue is unavailable.",
      error: {
        code: "DECK_EXPORT_ENQUEUE_FAILED",
        message: "Deck export queue is unavailable.",
        retryable: true,
      },
    });
    const jobsService = {
      create: vi.fn(async () => exportJob),
      update: vi.fn(async () => failedJob),
    };
    const enqueueError = new Error("connect ECONNREFUSED 127.0.0.1:6379");
    const enqueueExportJob = vi.fn(async () => {
      throw enqueueError;
    });
    const logger = createLogger();
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      vi.fn(async () => undefined),
      enqueueExportJob,
      undefined,
      logger,
    );
    await service.putDeck(deck.projectId, { deck });

    await expect(
      service.createExportJob(deck.projectId, { format: "png" }),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: {
        code: "DECK_EXPORT_ENQUEUE_FAILED",
        message: "Deck export queue is unavailable.",
        job: failedJob,
      },
    });
    expect(jobsService.update).toHaveBeenCalledWith(
      exportJob.jobId,
      expect.objectContaining({
        status: "failed",
        error: {
          code: "DECK_EXPORT_ENQUEUE_FAILED",
          message: "Deck export queue is unavailable.",
          retryable: true,
        },
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "deck_export.enqueue_failed",
        jobId: exportJob.jobId,
        projectId: deck.projectId,
        deckId: deck.deckId,
        format: "png",
        error: expect.objectContaining({ message: enqueueError.message }),
      }),
      "Deck export job enqueue failed.",
    );
  });

  it("blocks imported PPTX export while its package is stale", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = deckSchema.parse({ ...createDeck(), version: 145 });
    seedStoredDeck(dataSource, deck, deck);
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 1,
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });
    const jobsService = {
      create: vi.fn(),
      update: vi.fn(),
      getLatestPptxOoxmlSync: vi.fn(async () => null),
    };
    const enqueueExportJob = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      vi.fn(async () => undefined),
      enqueueExportJob,
    );

    await expect(
      service.createExportJob(deck.projectId, { format: "pptx" }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: expect.objectContaining({
        code: "DECK_EXPORT_OOXML_SYNC_NOT_READY",
        ooxmlSyncState: expect.objectContaining({
          status: "stale",
          deckVersion: 145,
          syncedDeckVersion: 1,
        }),
      }),
    });
    expect(jobsService.create).not.toHaveBeenCalled();
    expect(enqueueExportJob).not.toHaveBeenCalled();
  });

  it("authorizes and forwards the selected presentation session for export", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    dataSource.exportSessionIds.add("session_export_1");
    const deck = createDeck();
    const exportJob = createJob("job_export_session_1", "deck-export");
    const jobsService = {
      create: vi.fn(async () => exportJob),
      update: vi.fn(),
    };
    const enqueueExportJob = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      vi.fn(async () => undefined),
      enqueueExportJob,
    );
    await service.putDeck(deck.projectId, { deck });

    await service.createExportJob(deck.projectId, {
      format: "pptx",
      presentationSessionId: "session_export_1",
    });

    expect(jobsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          presentationSessionId: "session_export_1",
        }),
      }),
    );
    expect(enqueueExportJob).toHaveBeenCalledWith(
      expect.objectContaining({ presentationSessionId: "session_export_1" }),
    );
  });

  it("rejects an export session outside the current project boundary", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const jobsService = { create: vi.fn(), update: vi.fn() };
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );
    await service.putDeck(deck.projectId, { deck });

    await expect(
      service.createExportJob(deck.projectId, {
        format: "pptx",
        presentationSessionId: "session_other_project",
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    expect(jobsService.create).not.toHaveBeenCalled();
  });

  it("persists and enqueues OOXML sync for thumbnail-only system patches", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const syncJob = createJob("job_sync_thumbnail");
    const jobsService = {
      create: vi.fn(async () => syncJob),
      update: vi.fn(),
    };
    const enqueueSyncJob = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      enqueueSyncJob,
    );

    await service.putDeck(deck.projectId, { deck });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });

    const response = await service.appendPatch(deck.projectId, {
      patch: {
        deckId: deck.deckId,
        baseVersion: deck.version,
        source: "system",
        operations: [
          {
            type: "update_slide",
            slideId: deck.slides[0]!.slideId,
            thumbnailUrl:
              "/api/v1/projects/project_demo_1/assets/file_thumb/content",
          },
          {
            type: "update_deck",
            metadata: {
              thumbnailSource: "canvas",
            },
          },
        ],
      },
      responseMode: "ack",
    });

    expect(response.ooxmlSyncJob?.jobId).toBe(syncJob.jobId);
    expect(response.version).toBe(2);
    expect(response).not.toHaveProperty("deck");
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: deck.projectId,
      type: "pptx-ooxml-sync",
      payload: {
        deckId: deck.deckId,
        changeId: response.changeRecord.changeId,
        targetDeckVersion: 2,
      },
    });
    expect(enqueueSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: syncJob.jobId,
        deckId: deck.deckId,
        changeId: response.changeRecord.changeId,
        targetDeckVersion: 2,
      }),
    );
    expect(dataSource.decks.get(deck.projectId)).toMatchObject({
      version: 2,
      deck_json: expect.objectContaining({
        version: 2,
        metadata: expect.objectContaining({ thumbnailSource: "canvas" }),
        slides: [
          expect.objectContaining({
            thumbnailUrl:
              "/api/v1/projects/project_demo_1/assets/file_thumb/content",
          }),
        ],
      }),
    });
    expect(dataSource.patchRows.map((row) => row.after_version)).toEqual([2]);
  });

  it("creates and enqueues a semantic cue extraction preparation job", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const semanticCueJob = createJob(
      "job_semantic_cues_1",
      "semantic-cue-extraction",
    );
    const jobsService = {
      create: vi.fn(async () => semanticCueJob),
      update: vi.fn(),
    };
    const enqueueSyncJob = vi.fn(async () => undefined);
    const enqueueSemanticCueJob = vi.fn(async () => undefined);
    const logger = createLogger();
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      enqueueSyncJob,
      undefined,
      enqueueSemanticCueJob,
      logger,
    );

    await service.putDeck(deck.projectId, { deck });
    await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "enqueue 직전 편집"),
    });
    expect(dataSource.patchRows).toHaveLength(1);
    const response = await service.createSemanticCueExtractionJob(
      deck.projectId,
      {
        force: true,
      },
    );

    expect(response.job.jobId).toBe(semanticCueJob.jobId);
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: deck.projectId,
      type: "semantic-cue-extraction",
      payload: {
        request: {
          deckId: deck.deckId,
          force: true,
          baseVersion: 2,
        },
      },
    });
    expect(enqueueSemanticCueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        driver: "bullmq",
        redisUrl: "redis://localhost:6379",
        jobId: semanticCueJob.jobId,
        projectId: deck.projectId,
        request: {
          deckId: deck.deckId,
          force: true,
          baseVersion: 2,
        },
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "semantic_cue.extraction.queued",
        jobId: semanticCueJob.jobId,
        projectId: deck.projectId,
        deckId: deck.deckId,
        deckVersion: 2,
      }),
      "Semantic cue extraction job enqueued.",
    );
    expect(dataSource.patchRows).toEqual([]);
    expect(dataSource.decks.get(deck.projectId)).toMatchObject({
      version: 2,
      deck_json: expect.objectContaining({
        title: "enqueue 직전 편집",
        version: 2,
      }),
    });
    expect(
      dataSource.executedQueries.some(
        (query) =>
          query.includes("FROM deck_patches") && query.includes("FOR UPDATE"),
      ),
    ).toBe(true);
    expect(enqueueSyncJob).not.toHaveBeenCalled();
  });

  it("creates a speaker notes suggestion job with IDs only", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const suggestionJob = createJob(
      "job_speaker_notes_1",
      "speaker-notes-suggestion",
    );
    const jobsService = {
      create: vi.fn(async () => suggestionJob),
      update: vi.fn(),
    };
    const enqueueSuggestion = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      undefined,
      undefined,
      undefined,
      createLogger(),
      enqueueSuggestion,
    );

    await service.putDeck(deck.projectId, { deck });
    const response = await service.createSpeakerNotesSuggestionJob(
      deck.projectId,
      {
        deckId: deck.deckId,
        slideId: deck.slides[0]!.slideId,
        baseVersion: deck.version,
        mode: "draft",
      },
    );

    expect(response.job.jobId).toBe(suggestionJob.jobId);
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: deck.projectId,
      type: "speaker-notes-suggestion",
      payload: {
        request: {
          deckId: deck.deckId,
          slideId: deck.slides[0]!.slideId,
          baseVersion: deck.version,
          mode: "draft",
        },
      },
    });
    expect(enqueueSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: suggestionJob.jobId,
        projectId: deck.projectId,
        request: {
          deckId: deck.deckId,
          slideId: deck.slides[0]!.slideId,
          baseVersion: deck.version,
          mode: "draft",
        },
      }),
    );
    expect(JSON.stringify(enqueueSuggestion.mock.calls)).not.toContain(
      "speakerNotes",
    );
  });

  it("rejects a refinement mode when speaker notes are empty", async () => {
    const dataSource = new InMemoryDeckDataSource();
    const deck = createDeck();
    const jobsService = { create: vi.fn(), update: vi.fn() };
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
    );
    await service.putDeck(deck.projectId, { deck });

    await expect(
      service.createSpeakerNotesSuggestionJob(deck.projectId, {
        deckId: deck.deckId,
        slideId: deck.slides[0]!.slideId,
        baseVersion: deck.version,
        mode: "naturalize",
      }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(jobsService.create).not.toHaveBeenCalled();
  });

  it("restores a snapshot into the current deck", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    const putResponse = await service.putDeck(deck.projectId, { deck });
    await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "수정된 덱"),
    });

    const restoreResponse = await service.restoreSnapshot(
      deck.projectId,
      putResponse.snapshot.snapshotId,
    );
    const getResponse = await service.getDeck(deck.projectId);

    expect(restoreResponse.restoredSnapshot.snapshotId).toBe(
      putResponse.snapshot.snapshotId,
    );
    expect(restoreResponse.deck).toMatchObject({
      title: deck.title,
      version: 1,
    });
    expect(getResponse.deck).toMatchObject({
      title: deck.title,
      version: 1,
    });
    expect(dataSource.projectTitles.get(deck.projectId)).toBe(deck.title);
    const snapshots = await service.listSnapshots(deck.projectId);
    expect(snapshots.snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "snapshot-restore",
          version: 2,
        }),
      ]),
    );
    expect(
      dataSource.snapshotRows.find(
        (snapshot) => snapshot.reason === "snapshot-restore",
      )?.deck_json,
    ).toMatchObject({ title: "수정된 덱", version: 2 });
    expect(dataSource.patchRows).toHaveLength(0);
    expect(
      dataSource.executedQueries.some((query) =>
        query.includes("WHERE project_id = $1 AND deck_id = $2 FOR UPDATE"),
      ),
    ).toBe(true);
  });

  it("restores an OOXML-backed snapshot as the next version and enqueues sync", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const syncJob = createJob("job_sync_restore");
    const jobsService = {
      create: vi.fn(async () => syncJob),
      update: vi.fn(),
    };
    const enqueueSyncJob = vi.fn(async () => undefined);
    const logger = createLogger();
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      enqueueSyncJob,
      undefined,
      undefined,
      logger,
    );
    const snapshotDeck = createDeck();
    const currentDeck = deckSchema.parse({
      ...snapshotDeck,
      title: "Current imported deck",
      version: 3,
    });
    seedStoredDeck(dataSource, currentDeck, currentDeck);
    dataSource.snapshotRows.push({
      snapshot_id: "snapshot_imported_restore_1",
      project_id: snapshotDeck.projectId,
      deck_id: snapshotDeck.deckId,
      deck_json: cloneJson(snapshotDeck),
      version: snapshotDeck.version,
      reason: "deck-replaced",
      created_at: "2026-07-10T00:00:00.000Z",
    });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: currentDeck.projectId,
      deck_id: currentDeck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 3,
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });

    const response = await service.restoreSnapshot(
      currentDeck.projectId,
      "snapshot_imported_restore_1",
    );

    expect(response).toMatchObject({
      deck: { title: snapshotDeck.title, version: 4 },
      restoredSnapshot: { version: 1 },
      ooxmlSyncJob: { jobId: syncJob.jobId, status: "queued" },
    });
    expect(dataSource.decks.get(currentDeck.projectId)).toMatchObject({
      version: 4,
      deck_json: expect.objectContaining({
        title: snapshotDeck.title,
        version: 4,
      }),
    });
    expect(dataSource.patchRows).toEqual([
      expect.objectContaining({ before_version: 3, after_version: 4 }),
    ]);
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: currentDeck.projectId,
      type: "pptx-ooxml-sync",
      payload: {
        deckId: currentDeck.deckId,
        changeId: "change_deck_demo_1_4_put",
        targetDeckVersion: 4,
      },
    });
    expect(enqueueSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: syncJob.jobId,
        deckId: currentDeck.deckId,
        targetDeckVersion: 4,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "pptx_ooxml.sync.queued",
        jobId: syncJob.jobId,
        projectId: currentDeck.projectId,
        deckId: currentDeck.deckId,
        targetDeckVersion: 4,
      },
      "PPTX OOXML sync job enqueued.",
    );
  });

  it("preserves unsynced OOXML patches and returns a failed restore sync job", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const syncJob = createJob("job_sync_restore_failed");
    const failedJob = jobSchema.parse({
      ...syncJob,
      status: "failed",
      message: "PPTX OOXML sync enqueue failed.",
      error: {
        code: "PPTX_OOXML_SYNC_ENQUEUE_FAILED",
        message: "queue unavailable",
      },
    });
    const jobsService = {
      create: vi.fn(async () => syncJob),
      update: vi.fn(async () => failedJob),
    };
    const enqueueSyncJob = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    const logger = createLogger();
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      enqueueSyncJob,
      undefined,
      undefined,
      logger,
    );
    const deck = createDeck();
    const initial = await service.putDeck(deck.projectId, { deck });
    const version2 = await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "Version 2"),
    });
    await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(version2.deck, "Version 3"),
    });
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 1,
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });

    const response = await service.restoreSnapshot(
      deck.projectId,
      initial.snapshot.snapshotId,
    );

    expect(response.deck.version).toBe(4);
    expect(response.ooxmlSyncJob).toMatchObject({
      jobId: syncJob.jobId,
      status: "failed",
      error: { code: "PPTX_OOXML_SYNC_ENQUEUE_FAILED" },
    });
    expect(dataSource.patchRows.map((row) => row.after_version)).toEqual([
      2, 3, 4,
    ]);
    expect(jobsService.update).toHaveBeenCalledWith(
      syncJob.jobId,
      expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({
          code: "PPTX_OOXML_SYNC_ENQUEUE_FAILED",
        }),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "pptx_ooxml.sync.enqueue_failed",
        jobId: syncJob.jobId,
        projectId: deck.projectId,
        deckId: deck.deckId,
        targetDeckVersion: 4,
      },
      "PPTX OOXML sync job enqueue failed.",
    );
  });

  it("compacts stored patch rows after a full deck checkpoint save", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    const patched = await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "수정된 덱"),
    });

    expect(dataSource.patchRows).toHaveLength(1);

    await service.putDeck(deck.projectId, { deck: patched.deck });

    expect(dataSource.patchRows).toHaveLength(0);
    expect(dataSource.decks.get(deck.projectId)?.version).toBe(2);
  });

  it("rejects stale full deck saves before deleting newer patch rows", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "Updated deck"),
    });

    const error = await expectDeckApiError(
      () => service.putDeck(deck.projectId, { deck }),
      HttpStatus.CONFLICT,
      "STALE_BASE_VERSION",
    );
    const getResponse = await service.getDeck(deck.projectId);

    expect(error.details).toEqual(["deck.version=2", "request.baseVersion=1"]);
    expect(dataSource.patchRows).toHaveLength(1);
    expect(getResponse.deck).toMatchObject({
      title: "Updated deck",
      version: 2,
    });
  });

  it("rejects full deck saves that try to replace the project deck id", async () => {
    const { service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    const error = await expectDeckApiError(
      () =>
        service.putDeck(deck.projectId, {
          baseVersion: deck.version,
          deck: {
            ...deck,
            deckId: "deck_other_1",
          },
        }),
      HttpStatus.CONFLICT,
      "DECK_MISMATCH",
    );

    expect(error.details).toEqual([
      "deck.deckId=deck_demo_1",
      "request.deckId=deck_other_1",
    ]);
  });

  it("allows explicit full deck version rewind when baseVersion matches", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "Updated deck"),
    });

    await service.putDeck(deck.projectId, { deck, baseVersion: 2 });
    const getResponse = await service.getDeck(deck.projectId);

    expect(dataSource.patchRows).toHaveLength(0);
    expect(getResponse.deck).toMatchObject({
      title: deck.title,
      version: 1,
    });

    const nextPatchResponse = await service.appendPatch(deck.projectId, {
      patch: createUpdateTitlePatch(deck, "Saved after undo"),
    });

    expect(nextPatchResponse.deck).toMatchObject({
      title: "Saved after undo",
      version: 2,
    });
  });

  it("normalizes legacy keyword terms when restoring snapshots", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();

    dataSource.snapshotRows.push({
      snapshot_id: "snapshot_legacy_keywords",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      deck_json: createLegacyKeywordDeck(deck),
      version: deck.version,
      reason: "deck-replaced",
      created_at: "2026-06-29T00:00:00.000Z",
    });

    const response = await service.restoreSnapshot(
      deck.projectId,
      "snapshot_legacy_keywords",
    );

    expect(response.deck.slides[0].keywords).toEqual(
      createNormalizedLegacyKeywords(),
    );
    expect(dataSource.decks.get(deck.projectId)?.deck_json).toMatchObject({
      slides: [
        {
          keywords: createNormalizedLegacyKeywords(),
        },
      ],
    });
  });

  it("rejects stale patch baseVersion", async () => {
    const { service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    const error = await expectDeckApiError(
      () =>
        service.appendPatch(deck.projectId, {
          patch: createUpdateTitlePatch(deck, "수정된 덱", 2),
        }),
      HttpStatus.CONFLICT,
      "STALE_BASE_VERSION",
    );

    expect(error.details).toEqual(["deck.version=1", "patch.baseVersion=2"]);
  });

  it("rejects reads when stored patch chain does not start from the checkpoint version", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    seedStoredDeck(dataSource, deck, deck);
    dataSource.patchRows.push({
      change_id: "change_gap_from_checkpoint",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      before_version: 2,
      after_version: 3,
      source: "user",
      actor_user_id: null,
      operations: createUpdateTitlePatch(deck, "수정된 덱", 2).operations,
      created_at: "2026-06-30T00:00:00.000Z",
    });

    const error = await expectDeckApiError(
      () => service.getDeck(deck.projectId),
      HttpStatus.CONFLICT,
      "PATCH_CHAIN_CHECKPOINT_MISMATCH",
    );

    expect(error.details).toContain("checkpoint.version=1");
    expect(error.details).toContain("expected.beforeVersion=1");
  });

  it("rejects reads when stored patch chain contains a version gap", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    seedStoredDeck(dataSource, deck, { ...deck, version: 2, title: "중간 덱" });
    dataSource.patchRows.push({
      change_id: "change_gap_middle_start",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      before_version: 2,
      after_version: 3,
      source: "user",
      actor_user_id: null,
      operations: createUpdateTitlePatch(
        { ...deck, version: 2 },
        "세 번째 덱",
        2,
      ).operations,
      created_at: "2026-06-30T00:00:00.000Z",
    });
    dataSource.patchRows.push({
      change_id: "change_gap_middle",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      before_version: 4,
      after_version: 5,
      source: "user",
      actor_user_id: null,
      operations: createUpdateTitlePatch(
        { ...deck, version: 4 },
        "수정된 덱",
        4,
      ).operations,
      created_at: "2026-06-30T00:00:01.000Z",
    });

    const error = await expectDeckApiError(
      () => service.getDeck(deck.projectId),
      HttpStatus.CONFLICT,
      "PATCH_CHAIN_INVALID",
    );

    expect(error.details).toContain("expected.beforeVersion=3");
    expect(error.details).toContain("patch.beforeVersion=4");
  });

  it("rejects reads when stored patch row has a non-sequential version transition", async () => {
    const { dataSource, service } = createService();
    const deck = createDeck();
    seedStoredDeck(dataSource, deck, deck);
    dataSource.patchRows.push({
      change_id: "change_duplicate_after_version",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      before_version: 1,
      after_version: 3,
      source: "user",
      actor_user_id: null,
      operations: createUpdateTitlePatch(deck, "수정된 덱").operations,
      created_at: "2026-06-30T00:00:00.000Z",
    });

    const error = await expectDeckApiError(
      () => service.getDeck(deck.projectId),
      HttpStatus.CONFLICT,
      "PATCH_CHAIN_INVALID",
    );

    expect(error.details).toContain("patch.beforeVersion=1");
    expect(error.details).toContain("patch.afterVersion=3");
  });

  it("rejects reads when the current deck does not exist", async () => {
    const { service } = createService();

    await expectDeckApiError(
      () => service.getDeck("project_demo_1"),
      HttpStatus.NOT_FOUND,
      "DECK_NOT_FOUND",
    );
  });

  it("rejects patch append when the current deck does not exist", async () => {
    const { service } = createService();
    const deck = createDeck();

    await expectDeckApiError(
      () =>
        service.appendPatch(deck.projectId, {
          patch: createUpdateTitlePatch(deck, "수정된 덱"),
        }),
      HttpStatus.NOT_FOUND,
      "DECK_NOT_FOUND",
    );
  });

  it("rejects invalid DeckPatch payloads", async () => {
    const { service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    const error = await expectDeckApiError(
      () =>
        service.appendPatch(deck.projectId, {
          patch: {
            deckId: deck.deckId,
            baseVersion: deck.version,
            source: "user",
            operations: [],
          },
        }),
      HttpStatus.BAD_REQUEST,
      "PATCH_VALIDATION_FAILED",
    );

    expect(error.details.join("\n")).toContain("operations");
  });

  it("rejects invalid keyword replacement patch payloads", async () => {
    const { service } = createService();
    const deck = createDeck();
    await service.putDeck(deck.projectId, { deck });

    const error = await expectDeckApiError(
      () =>
        service.appendPatch(deck.projectId, {
          patch: {
            deckId: deck.deckId,
            baseVersion: deck.version,
            source: "user",
            operations: [
              {
                type: "replace_keywords",
                slideId: "slide_intro",
                keywords: [
                  {
                    keywordId: "kw_one",
                    text: "ORBIT",
                    synonyms: [""],
                    abbreviations: [],
                    required: true,
                  },
                  {
                    keywordId: "kw_two",
                    text: "orbit",
                    synonyms: [],
                    abbreviations: [],
                    required: true,
                  },
                ],
              },
            ],
          },
        }),
      HttpStatus.BAD_REQUEST,
      "PATCH_VALIDATION_FAILED",
    );

    expect(error.details.join("\n")).toContain("keywords");
  });

  it("rejects invalid DeckSchema payloads", async () => {
    const { service } = createService();
    const invalidDeck = {
      ...createDeck(),
      metadata: {
        language: "en",
        locale: "ko-KR",
      },
    };

    const error = await expectDeckApiError(
      () => service.putDeck("project_demo_1", { deck: invalidDeck }),
      HttpStatus.BAD_REQUEST,
      "DECK_VALIDATION_FAILED",
    );

    expect(error.details.join("\n")).toContain("metadata.language");
  });

  it("rejects restore when the snapshot does not exist", async () => {
    const { service } = createService();

    await expectDeckApiError(
      () => service.restoreSnapshot("project_demo_1", "snapshot_missing_1"),
      HttpStatus.NOT_FOUND,
      "SNAPSHOT_NOT_FOUND",
    );
  });

  it("rejects restore when the snapshot belongs to another project", async () => {
    const { service } = createService();
    const deck = createDeck();
    const putResponse = await service.putDeck(deck.projectId, { deck });

    const error = await expectDeckApiError(
      () =>
        service.restoreSnapshot(
          "project_other_1",
          putResponse.snapshot.snapshotId,
        ),
      HttpStatus.BAD_REQUEST,
      "SNAPSHOT_PROJECT_MISMATCH",
    );

    expect(error.details).toEqual([
      "projectId=project_other_1",
      "snapshot.projectId=project_demo_1",
    ]);
  });

  it("rejects deck writes outside the requested project boundary", async () => {
    const { service } = createService();
    const deck = createDeck();

    const error = await expectDeckApiError(
      () => service.putDeck("project_other_1", { deck }),
      HttpStatus.BAD_REQUEST,
      "PROJECT_MISMATCH",
    );

    expect(error.details).toEqual([
      "projectId=project_other_1",
      "deck.projectId=project_demo_1",
    ]);
  });

  it("reports a failed OOXML sync for the current Deck version", async () => {
    const dataSource = new InMemoryDeckDataSource();
    const deck = deckSchema.parse({ ...createDeck(), version: 145 });
    seedStoredDeck(dataSource, deck, deck);
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 1,
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });
    const failedJob = jobSchema.parse({
      ...createJob("job_sync_failed"),
      status: "failed",
      error: { code: "PPTX_OOXML_SYNC_FAILED", message: "sync failed" },
    });
    const jobsService = {
      getLatestPptxOoxmlSync: vi.fn(async () => failedJob),
    };
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
    );

    const response = await service.getOoxmlSyncState(deck.projectId);

    expect(response.ooxmlSyncState).toMatchObject({
      status: "failed",
      deckVersion: 145,
      syncedDeckVersion: 1,
      retryable: true,
      job: { jobId: "job_sync_failed" },
    });
    expect(jobsService.getLatestPptxOoxmlSync).toHaveBeenCalledWith(
      deck.projectId,
      deck.deckId,
      145,
    );
  });

  it("retries OOXML sync against the current Deck version", async () => {
    stubOrbitEnv();
    const dataSource = new InMemoryDeckDataSource();
    const deck = deckSchema.parse({ ...createDeck(), version: 145 });
    seedStoredDeck(dataSource, deck, deck);
    dataSource.templateBlueprintRows.push({
      template_id: "template_file_1",
      project_id: deck.projectId,
      deck_id: deck.deckId,
      blueprint_json: {
        templateId: "template_file_1",
        sourceFileId: "file_1",
        currentPackageFileId: "file_current",
        ooxmlSyncedDeckVersion: 1,
        slides: [{ slideIndex: 1, sourceSlideIndex: 1, slots: [] }],
      },
    });
    const queuedJob = createJob("job_sync_retry");
    const jobsService = {
      create: vi.fn(async () => queuedJob),
      update: vi.fn(),
      getLatestPptxOoxmlSync: vi.fn(async () => null),
    };
    const enqueueSyncJob = vi.fn(async () => undefined);
    const service = new DecksService(
      dataSource as unknown as DataSource,
      jobsService as never,
      enqueueSyncJob,
    );

    const response = await service.retryOoxmlSync(deck.projectId);

    expect(response.ooxmlSyncState).toMatchObject({
      status: "pending",
      deckVersion: 145,
      syncedDeckVersion: 1,
      retryable: false,
      job: { jobId: "job_sync_retry" },
    });
    expect(jobsService.create).toHaveBeenCalledWith({
      projectId: deck.projectId,
      type: "pptx-ooxml-sync",
      payload: expect.objectContaining({
        deckId: deck.deckId,
        targetDeckVersion: 145,
      }),
    });
    expect(enqueueSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ targetDeckVersion: 145 }),
    );
  });
});
