import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobsService } from "../jobs/jobs.service";
import type { ProjectsService } from "../projects/projects.service";
import { GenerateDeckService } from "./generate-deck.service";

const validEnv = {
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
  AI_DECK_EXECUTION_MODE: "monolith",
  AI_DECK_WORKER_QUEUE: "all",
  AI_DECK_WORKER_CONCURRENCY: "5",
  AI_DECK_USER_CONCURRENCY: "5",
  STT_PROVIDER: "sherpa",
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
  DEMO_USER_ID: "user_demo_1",
  DEMO_WORKSPACE_ID: "workspace_demo_1",
  DEMO_PROJECT_ID: "project_demo_1",
  DEMO_DECK_ID: "deck_demo_1",
  DEMO_SESSION_ID: "session_demo_1",
  DEMO_AI_DECK_CACHE_ENABLED: "false",
  DEMO_AI_DECK_SOURCE_PROJECT_ID: "",
  DEMO_AI_DECK_TRIGGER_TOPIC: "",
  DEMO_FIXTURE_ENV_ALLOWLIST: ""
};

describe("GenerateDeckService design pack options", () => {
  beforeEach(() => {
    Object.assign(process.env, validEnv);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates the Python response with the shared contract", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        catalogVersion: 1,
        options: [
          {
            id: "executive-review",
            version: 1,
            name: "Executive Review",
            family: "executive-review",
            rationale: "경영 보고 구조에 적합합니다.",
            preview: {
              manifestId: "preview-executive-review-v1",
              coverPreviewId: "preview-executive-cover-01-v1",
              bodyPreviewId: "preview-executive-summary-01-v1"
            }
          }
        ],
        fallbackUsed: false
      })
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await service().createDesignPackOptions({
      topic: "분기 경영 보고",
      purpose: "report",
      profile: "executive-report"
    });

    expect(result.options[0]?.id).toBe("executive-review");
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8000/internal/ai/deck-generation/design-pack-options",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("normalizes timeout and invalid provider payload failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(
      service().createDesignPackOptions({ topic: "시장 동향" })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ options: [{ arbitrary: true }] }))
    );
    await expect(
      service().createDesignPackOptions({ topic: "시장 동향" })
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("rejects unknown request fields before calling Python", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      service().createDesignPackOptions({ topic: "시장 동향", unknown: true })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function service(): GenerateDeckService {
  return new GenerateDeckService(
    {} as JobsService,
    {} as ProjectsService,
    vi.fn()
  );
}
