import { loadOrbitConfig, OrbitConfigError } from "@orbit/config";
import { describe, expect, it } from "vitest";

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
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
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

describe("ORBIT env validation", () => {
  it("reads OpenAI model defaults from env", () => {
    const config = loadOrbitConfig(
      {
        ...validEnv,
        OPENAI_MODEL: "gpt-4.1",
        OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
        OPENAI_REALTIME_TRANSCRIPTION_MODEL: "gpt-realtime-whisper-2",
        OPENAI_REALTIME_TRANSCRIPTION_DELAY: "low",
        OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS: "900"
      },
      { service: "api" }
    );

    expect(config.OPENAI_MODEL).toBe("gpt-4.1");
    expect(config.OPENAI_EMBEDDING_MODEL).toBe("text-embedding-3-large");
    expect(config.OPENAI_REALTIME_TRANSCRIPTION_MODEL).toBe(
      "gpt-realtime-whisper-2"
    );
    expect(config.OPENAI_REALTIME_TRANSCRIPTION_DELAY).toBe("low");
    expect(config.OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS).toBe(900);
  });

  it("loads realtime transcription defaults when optional env values are omitted", () => {
    const env = { ...validEnv } as Partial<typeof validEnv>;
    delete env.OPENAI_REALTIME_TRANSCRIPTION_MODEL;
    delete env.OPENAI_REALTIME_TRANSCRIPTION_DELAY;
    delete env.OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS;

    const config = loadOrbitConfig(env as NodeJS.ProcessEnv, { service: "api" });

    expect(config.OPENAI_REALTIME_TRANSCRIPTION_MODEL).toBe(
      "gpt-realtime-whisper"
    );
    expect(config.OPENAI_REALTIME_TRANSCRIPTION_DELAY).toBe("minimal");
    expect(config.OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS).toBe(600);
  });

  it("validates realtime transcription delay and client secret ttl", () => {
    expect(() =>
      loadOrbitConfig(
        { ...validEnv, OPENAI_REALTIME_TRANSCRIPTION_DELAY: "instant" },
        { service: "api" }
      )
    ).toThrow(/OPENAI_REALTIME_TRANSCRIPTION_DELAY/);

    expect(() =>
      loadOrbitConfig(
        { ...validEnv, OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS: "9" },
        { service: "api" }
      )
    ).toThrow(/OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS/);
  });

  it("fails with a readable error when a required value is missing", () => {
    const env = { ...validEnv } as Partial<typeof validEnv>;
    delete env.DATABASE_URL;

    expect(() => loadOrbitConfig(env as NodeJS.ProcessEnv, { service: "api" })).toThrow(
      OrbitConfigError
    );
    expect(() =>
      loadOrbitConfig(env as NodeJS.ProcessEnv, { service: "api" })
    ).toThrow(/Invalid ORBIT environment for api[\s\S]*DATABASE_URL/);
  });

  it("treats empty strings as missing required values", () => {
    expect(() =>
      loadOrbitConfig({ ...validEnv, OPENAI_MODEL: " " }, { service: "api" })
    ).toThrow(/OPENAI_MODEL/);
  });

  it("loads logging defaults and validates log levels", () => {
    const env = { ...validEnv } as Partial<typeof validEnv>;
    delete env.LOG_LEVEL;
    delete env.LOG_PRETTY;

    expect(loadOrbitConfig(env as NodeJS.ProcessEnv, { service: "api" })).toMatchObject({
      LOG_LEVEL: "info",
      LOG_PRETTY: false
    });
    expect(() =>
      loadOrbitConfig({ ...validEnv, LOG_LEVEL: "verbose" }, { service: "api" })
    ).toThrow(/LOG_LEVEL/);
  });

  it("keeps live STT and report STT provider contracts separate", () => {
    const config = loadOrbitConfig(validEnv, { service: "api" });

    expect(config.LIVE_STT_PROVIDER).toBe("sherpa");
    expect(config.REPORT_STT_PROVIDER).toBe("openai");
    expect(config.REHEARSAL_AUDIO_MAX_BYTES).toBe(25000000);
    expect(() =>
      loadOrbitConfig(
        { ...validEnv, LIVE_STT_PROVIDER: "openai" },
        { service: "api" }
      )
    ).toThrow(/LIVE_STT_PROVIDER/);
    expect(() =>
      loadOrbitConfig(
        { ...validEnv, REPORT_STT_PROVIDER: "sherpa" },
        { service: "api" }
      )
    ).toThrow(/REPORT_STT_PROVIDER/);
  });

  it("accepts WhisperX report STT when hosted provider config exists", () => {
    const config = loadOrbitConfig(
      {
        ...validEnv,
        REPORT_STT_PROVIDER: "whisperx",
        WHISPERX_API_URL: "https://whisperx.example.test/transcribe",
        WHISPERX_API_KEY: "whisperx-test-key",
        WHISPERX_MODEL: "large-v3",
        WHISPERX_TIMEOUT_MS: "45000"
      },
      { service: "api" }
    );

    expect(config.REPORT_STT_PROVIDER).toBe("whisperx");
    expect(config.WHISPERX_API_URL).toBe(
      "https://whisperx.example.test/transcribe"
    );
    expect(config.WHISPERX_MODEL).toBe("large-v3");
    expect(config.WHISPERX_TIMEOUT_MS).toBe(45000);
  });

  it("requires WhisperX hosted provider config when selected", () => {
    expect(() =>
      loadOrbitConfig(
        { ...validEnv, REPORT_STT_PROVIDER: "whisperx" },
        { service: "api" }
      )
    ).toThrow(/WHISPERX_API_URL/);
  });

  it("rejects invalid WhisperX hosted provider URLs when selected", () => {
    expect(() =>
      loadOrbitConfig(
        {
          ...validEnv,
          REPORT_STT_PROVIDER: "whisperx",
          WHISPERX_API_URL: "not-a-url",
          WHISPERX_API_KEY: "whisperx-test-key",
          WHISPERX_MODEL: "large-v3"
        },
        { service: "api" }
      )
    ).toThrow(/WHISPERX_API_URL must be a valid URL/);
  });

  it("rejects OpenAI report STT audio limits above the single-file path limit", () => {
    expect(() =>
      loadOrbitConfig(
        { ...validEnv, REHEARSAL_AUDIO_MAX_BYTES: "25000001" },
        { service: "api" }
      )
    ).toThrow(/REHEARSAL_AUDIO_MAX_BYTES/);
  });

  it("allows pretty logs only in development", () => {
    expect(
      loadOrbitConfig(
        { ...validEnv, NODE_ENV: "development", LOG_PRETTY: "true" },
        { service: "api" }
      ).LOG_PRETTY
    ).toBe(true);
    expect(() =>
      loadOrbitConfig({ ...validEnv, NODE_ENV: "production", LOG_PRETTY: "true" }, { service: "api" })
    ).toThrow(/LOG_PRETTY can only be true/);
  });

  it("allows the personal staging server to opt out of secure auth cookies", () => {
    const config = loadOrbitConfig(
      {
        ...validEnv,
        APP_ENV: "staging",
        WEB_ORIGIN: "http://8.230.24.164",
        API_BASE_URL: "http://8.230.24.164/api",
        PYTHON_WORKER_URL: "http://python-worker:8000",
        DATABASE_URL: "postgres://orbit:orbit@postgres:5432/orbit",
        REDIS_URL: "redis://redis:6379",
        SESSION_SECRET: "staging-session-secret",
        COOKIE_SECRET: "staging-cookie-secret",
        S3_ENDPOINT: "http://minio:9000",
        S3_PUBLIC_ENDPOINT: "http://8.230.24.164/assets",
        S3_BUCKET: "orbit-personal-staging",
        OPENAI_API_KEY: "sk-staging-placeholder",
        AUTH_COOKIE_SECURE: "false"
      },
      { service: "api" }
    );

    expect(config.AUTH_COOKIE_SECURE).toBe(false);
  });

  it("rejects insecure auth cookies when staging uses HTTPS origins", () => {
    expect(() =>
      loadOrbitConfig(
        {
          ...validEnv,
          APP_ENV: "staging",
          WEB_ORIGIN: "https://app.example.com",
          API_BASE_URL: "https://app.example.com/api",
          PYTHON_WORKER_URL: "http://python-worker:8000",
          DATABASE_URL: "postgres://orbit:orbit@postgres:5432/orbit",
          REDIS_URL: "redis://redis:6379",
          SESSION_SECRET: "staging-session-secret",
          COOKIE_SECRET: "staging-cookie-secret",
          S3_ENDPOINT: "http://minio:9000",
          S3_PUBLIC_ENDPOINT: "https://app.example.com/assets",
          S3_BUCKET: "orbit-personal-staging",
          OPENAI_API_KEY: "sk-staging-placeholder",
          AUTH_COOKIE_SECURE: "false"
        },
        { service: "api" }
      )
    ).toThrow(/AUTH_COOKIE_SECURE=false is only allowed/);
  });

  it("rejects insecure auth cookies in production", () => {
    expect(() =>
      loadOrbitConfig(
        {
          ...validEnv,
          APP_ENV: "production",
          WEB_ORIGIN: "https://app.example.com",
          API_BASE_URL: "https://api.example.com",
          PYTHON_WORKER_URL: "http://python-worker.internal:8000",
          DATABASE_URL: "postgres://orbit:orbit@prod-rds.example.com:5432/orbit",
          REDIS_URL: "rediss://prod-redis.example.com:6379",
          SESSION_SECRET: "production-session-secret",
          COOKIE_SECRET: "production-cookie-secret",
          STORAGE_DRIVER: "s3",
          S3_ENDPOINT: "",
          S3_PUBLIC_ENDPOINT: "https://assets.example.com",
          S3_BUCKET: "orbit-production",
          S3_ACCESS_KEY_ID: "",
          S3_SECRET_ACCESS_KEY: "",
          S3_FORCE_PATH_STYLE: "false",
          OPENAI_API_KEY: "sk-production-placeholder",
          AUTH_COOKIE_SECURE: "false"
        },
        { service: "api" }
      )
    ).toThrow(/AUTH_COOKIE_SECURE cannot be false in production/);
  });

  it("rejects local defaults in staging and production", () => {
    expect(() =>
      loadOrbitConfig(
        {
          ...validEnv,
          APP_ENV: "staging",
          OPENAI_API_KEY: "sk-staging-placeholder"
        },
        { service: "api" }
      )
    ).toThrow(/DATABASE_URL must not use the local default in staging/);
  });
});
