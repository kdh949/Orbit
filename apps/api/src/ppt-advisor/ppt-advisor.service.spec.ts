import type { PptAdvisorRequest } from "@orbit/shared/deck";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PptAdvisorService } from "./ppt-advisor.service";

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
  LIVE_STT_PROVIDER: "sherpa",
  REPORT_STT_PROVIDER: "openai",
  OCR_PROVIDER: "python",
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-test-key",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_TRANSCRIPTION_MODEL: "whisper-1",
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

const request: PptAdvisorRequest = {
  question: "7분 발표 장수를 추천해줘",
  brief: {
    topic: "MVP 회고",
    purpose: "다음 행동 합의",
    presentationContext: "팀 토론",
    audienceText: "제품팀",
    presentationType: "discussion",
    successCriteria: "합의",
    duration: 7,
    tone: "friendly",
  },
  design: {
    colorMood: "신뢰감 있는 파랑",
    fontMood: "둥근 한글 고딕",
    mediaPolicy: "ai-generated",
    referencePolicy: "references-first",
  },
  history: [],
};

describe("PptAdvisorService", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
  });

  it("returns schema-validated provider suggestions", async () => {
    const providerResult = {
      answer: "토론 시간을 고려하면 7장이 적당합니다.",
      suggestions: [
        {
          field: "slides",
          value: 7,
          label: "7장 구성",
          reason: "표지와 결론을 포함합니다.",
        },
      ],
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: "output_text", text: JSON.stringify(providerResult) },
              ],
            },
          ],
        }),
      ),
    );
    const logger = createLogger();
    const service = new PptAdvisorService(fetcher as never, logger);

    await expect(service.advise(request, "user_1")).resolves.toEqual(providerResult);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.instructions).toContain("Never tell the user to edit an unpublished draft");
    expect(body.text.format.name).toBe("ppt_advisor_response");
    expect(
      body.text.format.schema.properties.suggestions.items.anyOf.every(
        (item: { properties: { field: { type?: string } } }) =>
          item.properties.field.type === "string",
      ),
    ).toBe(true);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: false, suggestionCount: 1 }),
      expect.any(String),
    );
  });

  it("uses typed rule fallback on timeout without overriding media policy", async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    const logger = createLogger();
    const service = new PptAdvisorService(fetcher as never, logger);

    const result = await service.advise(
      { ...request, question: "이미지 정책을 설명해줘" },
      "user_1",
    );

    expect(result.answer).toContain("ai-generated");
    expect(result.suggestions).not.toContainEqual(
      expect.objectContaining({ field: "mediaPolicy", value: "minimal" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: true }),
      expect.any(String),
    );
  });

  it("describes hybrid provider behavior without promising unavailable AI images", async () => {
    vi.stubEnv("IMAGE_PROVIDER", "disabled");
    const fetcher = vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    const service = new PptAdvisorService(fetcher as never, createLogger());

    const result = await service.advise(
      {
        ...request,
        question: "hybrid 이미지 정책을 설명해줘",
        design: { ...request.design, mediaPolicy: "hybrid" }
      },
      "user_1"
    );

    expect(result.answer).toContain("공식 이미지 검색은 사용할 수 있지만");
    expect(result.answer).toContain("AI 이미지 provider는 현재 비활성화");
    expect(result.answer).toContain("no-media composition");
  });

  it("falls back when provider returns an invalid typed value", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            answer: "추천",
            suggestions: [
              {
                field: "slides",
                value: 99,
                label: "99장",
                reason: "invalid",
              },
            ],
          }),
        }),
      ),
    );
    const service = new PptAdvisorService(fetcher as never, createLogger());

    await expect(service.advise(request, "user_1")).resolves.toMatchObject({
      suggestions: [expect.objectContaining({ field: "slides", value: 7 })],
    });
  });
});

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as ConstructorParameters<typeof PptAdvisorService>[1];
}
