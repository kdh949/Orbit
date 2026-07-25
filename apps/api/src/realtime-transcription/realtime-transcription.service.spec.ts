import { BadGatewayException, ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeTranscriptionService } from "./realtime-transcription.service";

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

describe("RealtimeTranscriptionService", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(validEnv)) {
      vi.stubEnv(key, value);
    }
  });

  it("creates a gpt-realtime-whisper transcription client secret", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: "ek_test", expires_at: 1790000000 }))
    );
    const service = new RealtimeTranscriptionService(
      fetcher as unknown as typeof fetch,
      createLogger()
    );

    await expect(
      service.createClientSecret({
        projectId: "project_1",
        userId: "user_1"
      })
    ).resolves.toEqual({
      clientSecret: "ek_test",
      expiresAt: 1790000000,
      model: "gpt-realtime-whisper",
      delay: "minimal"
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/client_secrets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-key",
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": expect.any(String)
        })
      })
    );
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      expires_after: {
        anchor: "created_at",
        seconds: 600
      },
      session: {
        type: "transcription",
        audio: {
          input: {
            transcription: {
              model: "gpt-realtime-whisper",
              language: "ko",
              delay: "minimal"
            },
            turn_detection: null
          }
        }
      }
    });
  });

  it("supports changing the realtime delay by env", async () => {
    vi.stubEnv("OPENAI_REALTIME_TRANSCRIPTION_DELAY", "low");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: "ek_test", expires_at: 1790000000 }))
    );
    const service = new RealtimeTranscriptionService(
      fetcher as unknown as typeof fetch,
      createLogger()
    );

    await expect(
      service.createClientSecret({
        projectId: "project_1",
        userId: "user_1"
      })
    ).resolves.toMatchObject({ delay: "low" });
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).session.audio.input.transcription.delay).toBe(
      "low"
    );
  });

  it("fails closed when OpenAI API key is unavailable", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const service = new RealtimeTranscriptionService(
      vi.fn() as unknown as typeof fetch,
      createLogger()
    );

    await expect(
      service.createClientSecret({
        projectId: "project_1",
        userId: "user_1"
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("does not expose OpenAI error bodies to callers", async () => {
    const service = new RealtimeTranscriptionService(
      vi.fn().mockResolvedValue(new Response("secret provider detail", { status: 500 })) as unknown as typeof fetch,
      createLogger()
    );

    await expect(
      service.createClientSecret({
        projectId: "project_1",
        userId: "user_1"
      })
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("fails closed when OpenAI returns malformed JSON", async () => {
    const service = new RealtimeTranscriptionService(
      vi.fn().mockResolvedValue(new Response("not-json")) as unknown as typeof fetch,
      createLogger()
    );

    await expect(
      service.createClientSecret({
        projectId: "project_1",
        userId: "user_1"
      })
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

function createLogger() {
  return {
    warn: vi.fn()
  } as unknown as ConstructorParameters<typeof RealtimeTranscriptionService>[1];
}
