import { beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeConfigController } from "./runtime-config.controller";

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
  LIVE_STT_ENGINE: "openai-realtime",
  IPAD_PRESENTER_COMPANION_ENABLED: "true",
  REPORT_STT_PROVIDER: "openai",
  OCR_PROVIDER: "python",
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-test-key",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_TRANSCRIPTION_MODEL: "whisper-1",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  OPENAI_REALTIME_TRANSCRIPTION_MODEL: "gpt-realtime-whisper",
  OPENAI_REALTIME_TRANSCRIPTION_DELAY: "minimal",
  OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS: "600",
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
  DEMO_SESSION_ID: "session_demo_1"
};

describe("RuntimeConfigController", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(validEnv)) {
      vi.stubEnv(key, value);
    }
  });

  it("exposes the env-selected browser Live STT engine without secrets", () => {
    vi.stubEnv("LIVE_STT_ENGINE", "web-speech");

    expect(new RuntimeConfigController().getRuntimeConfig()).toEqual({
      liveSttEngine: "web-speech",
      ipadPresenterCompanionEnabled: true,
      adaptiveRehearsalCoachEnabled: false,
      focusedPracticeEnabled: false,
      challengeQnaEnabled: false,
      slidePracticeEnabled: false,
      slideQuestionGuidesEnabled: false,
    });
  });

  it("exposes only the public companion feature flag", () => {
    vi.stubEnv("IPAD_PRESENTER_COMPANION_ENABLED", "false");

    const runtimeConfig = new RuntimeConfigController().getRuntimeConfig();

    expect(runtimeConfig.ipadPresenterCompanionEnabled).toBe(false);
    expect(runtimeConfig).not.toHaveProperty("REDIS_URL");
    expect(runtimeConfig).not.toHaveProperty("SESSION_SECRET");
  });

  it("enables the companion feature by default", () => {
    delete process.env.IPAD_PRESENTER_COMPANION_ENABLED;

    expect(
      new RuntimeConfigController().getRuntimeConfig()
        .ipadPresenterCompanionEnabled
    ).toBe(true);
  });
});
