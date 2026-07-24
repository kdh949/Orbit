import { createDemoDeck } from "@orbit/editor-core";
import {
  generateDeckDesignSelectionSchema,
  generateDeckJobResultSchema,
  generateDeckStoredJobPayloadSchema,
} from "@orbit/shared";
import { ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSelectionService } from "./design-selection.service";

const testEnv = {
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
  PRIVATE_EVIDENCE_REDIS_URL: "redis://localhost:6380",
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
  LIVE_STT_ENGINE: "web-speech",
  REPORT_STT_PROVIDER: "openai",
  OCR_PROVIDER: "python",
  LLM_PROVIDER: "openai",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  AWS_REGION: "ap-northeast-2",
  TRANSCRIBE_LANGUAGE_CODE: "ko-KR",
  TEXTRACT_ENABLED: "false",
  LOG_LEVEL: "info",
  LOG_PRETTY: "false",
  DEMO_USER_ID: "user_demo_1",
  DEMO_WORKSPACE_ID: "workspace_demo_1",
  DEMO_PROJECT_ID: "project_demo_1",
  DEMO_DECK_ID: "deck_demo_1",
  DEMO_SESSION_ID: "session_demo_1",
  DEMO_AI_DECK_CACHE_ENABLED: "false",
  DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION: "false",
  DEMO_AI_DECK_SOURCE_PROJECT_ID: "",
  DEMO_AI_DECK_TRIGGER_TOPIC: "",
  DEMO_FIXTURE_ENV_ALLOWLIST: "",
};

const selection = {
  paletteOptionId: "demo-palette",
  paletteOverride: {
    primary: "#2563EB",
    secondary: "#0F172A",
    background: "#FFFFFF",
    surface: "#F8FAFC",
    muted: "#64748B",
    border: "#CBD5E1",
    text: "#0F172A",
    accentColor: "#F97316",
  },
  fontOverride: {
    fontId: "pretendard",
    name: "Pretendard",
    headingFontFamily: "Pretendard",
    bodyFontFamily: "Pretendard",
  },
};

describe("DesignSelectionService", () => {
  beforeEach(() => Object.assign(process.env, testEnv));

  it("starts design planning directly without creating a new cover checkpoint", async () => {
    const stored = generateDeckStoredJobPayloadSchema.parse({
      request: { topic: "Regular deck" },
      requestedByUserId: "user_demo_1",
    });
    const queries: string[] = [];
    const manager = {
      query: vi.fn(async (sql: string, _parameters?: unknown[]) => {
        queries.push(sql);
        if (sql.includes("FROM jobs") && sql.includes("FOR UPDATE")) {
          return [jobRow(stored)];
        }
        if (sql.includes("SELECT artifact_id")) {
          return [{ artifact_id: "artifact-content" }];
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: vi.fn(async (run: (value: typeof manager) => Promise<unknown>) => run(manager)),
      query: vi.fn(async () => [jobRow({ ...stored, designSelection: selection }, "running")]),
    };
    const service = new DesignSelectionService(dataSource as never, logger() as never);

    await service.select("project-target", "job-1", selection);

    expect(queries.some((sql) => sql.includes("'cover-slide'"))).toBe(false);
    const stageCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO ai_deck_generation_stages"),
    );
    expect(stageCall?.[1]).toEqual([
      "job-1",
      "project-target",
      "design-planning",
      { planningArtifactId: "artifact-content" },
    ]);
    const jobUpdate = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE jobs SET payload"),
    );
    expect(
      generateDeckStoredJobPayloadSchema.parse(jobUpdate?.[1]?.[2]).coverPlan,
    ).toBeUndefined();
  });

  it("clones a valid cached deck and completes the existing job atomically", async () => {
    Object.assign(process.env, {
      DEMO_AI_DECK_CACHE_ENABLED: "true",
      DEMO_AI_DECK_SOURCE_PROJECT_ID: "project-source",
      DEMO_AI_DECK_TRIGGER_TOPIC: "Orbit demo",
      DEMO_FIXTURE_ENV_ALLOWLIST: "local",
    });
    const sourceDeck = createDemoDeck();
    const stored = generateDeckStoredJobPayloadSchema.parse({
      request: { topic: "Orbit demo" },
      requestedByUserId: "user_demo_1",
    });
    let completedPayload: unknown;
    let completedResult: unknown;
    const manager = {
      query: vi.fn(async (sql: string, parameters?: unknown[]) => {
        if (sql.includes("FROM jobs") && sql.includes("FOR UPDATE")) return [jobRow(stored)];
        if (sql.includes("SELECT decks.deck_json FROM decks")) return [{ deck_json: sourceDeck }];
        if (sql.includes("UPDATE jobs SET payload") && sql.includes("'succeeded'")) {
          completedPayload = parameters?.[2];
          completedResult = parameters?.[3];
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: vi.fn(async (run: (value: typeof manager) => Promise<unknown>) => run(manager)),
      query: vi.fn(async () => [jobRow(completedPayload, "succeeded")]),
    };
    const log = logger();
    const service = new DesignSelectionService(dataSource as never, log as never);

    await service.select("project-target", "job-demo", selection);

    const result = generateDeckJobResultSchema.parse(completedResult);
    expect(result.deckId).toBe("deck_job-demo");
    expect(result.deck).toMatchObject({
      projectId: "project-target",
      deckId: "deck_job-demo",
      version: 1,
    });
    expect(result.deck.slides.map((slide) => slide.slideId)).toEqual(
      sourceDeck.slides.map((slide) => slide.slideId),
    );
    expect(result.deck.slides).toEqual(sourceDeck.slides);
    expect(generateDeckStoredJobPayloadSchema.parse(completedPayload).designSelection).toEqual(
      generateDeckDesignSelectionSchema.parse(selection),
    );
    expect(
      manager.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO ai_deck_generation_stages"),
      ),
    ).toBe(false);
    const sourceRead = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes("SELECT decks.deck_json FROM decks"),
    );
    expect(sourceRead?.[1]).toEqual(["project-source", "user_demo_1"]);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai_ppt.demo_cache.used",
        jobId: "job-demo",
        projectId: "project-target",
        sourceProjectId: "project-source",
        deckId: "deck_job-demo",
        slideCount: sourceDeck.slides.length,
      }),
      "Demo AI deck cache used.",
    );
  });

  it("fails explicitly before completing the job when the cached deck is invalid", async () => {
    Object.assign(process.env, {
      DEMO_AI_DECK_CACHE_ENABLED: "true",
      DEMO_AI_DECK_SOURCE_PROJECT_ID: "project-source",
      DEMO_AI_DECK_TRIGGER_TOPIC: "Orbit demo",
      DEMO_FIXTURE_ENV_ALLOWLIST: "local",
    });
    const stored = generateDeckStoredJobPayloadSchema.parse({
      request: { topic: "Orbit demo" },
      requestedByUserId: "user_demo_1",
    });
    const manager = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM jobs") && sql.includes("FOR UPDATE")) return [jobRow(stored)];
        if (sql.includes("SELECT decks.deck_json FROM decks")) return [{ deck_json: { invalid: true } }];
        return [];
      }),
    };
    const service = new DesignSelectionService(
      { transaction: vi.fn(async (run: (value: typeof manager) => Promise<unknown>) => run(manager)) } as never,
      logger() as never,
    );

    const error = await service
      .select("project-target", "job-demo", selection)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      code: "DEMO_DECK_CACHE_UNAVAILABLE",
    });
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE jobs SET payload"))).toBe(false);
  });
});

function jobRow(payload: unknown, status: "queued" | "running" | "succeeded" = "queued") {
  return {
    job_id: "job-demo",
    project_id: "project-target",
    status,
    payload,
    error: null,
  };
}

function logger() {
  return { info: vi.fn() };
}
