import type { Server, Socket } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../auth/auth.service";
import type { ProjectsService } from "../projects/projects.service";

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

describe("RealtimeGateway", () => {
  it("does not expose IP or raw user agent details in the global user list", async () => {
    Object.assign(process.env, validEnv);
    const { RealtimeGateway } = await import("./realtime.gateway");
    const gateway = new RealtimeGateway(
      {} as AuthService,
      {} as ProjectsService,
    );
    gateway.server = {
      emit: vi.fn(),
      sockets: {
        adapter: { rooms: new Map() },
        sockets: new Map(),
      },
      fetchSockets: vi.fn(async () => [client]),
    } as unknown as Server;
    const client = {
      id: "socket-1",
      handshake: {
        address: "203.0.113.10",
        headers: {
          "accept-language": "ko-KR",
          "user-agent": "Mozilla/5.0 Chrome/126.0",
          "x-real-ip": "203.0.113.11",
        },
      },
      conn: { transport: { name: "websocket" } },
      data: {},
      emit: vi.fn(),
    } as unknown as Socket;

    gateway.handleConnection(client);
    const response = await gateway.handleUsersList();
    gateway.handleDisconnect(client);

    expect(response.data).toHaveLength(1);
    expect(response.data[0]).not.toHaveProperty("ip");
    expect(response.data[0].environment).toEqual({ browserLabel: "Chrome" });
    expect(JSON.stringify(response.data)).not.toContain("203.0.113");
    expect(JSON.stringify(response.data)).not.toContain("Mozilla/5.0");
    expect(JSON.stringify(response.data)).not.toContain("ko-KR");
  });

  it("collects project presence from every Socket.IO server through fetchSockets", async () => {
    Object.assign(process.env, validEnv);
    const { RealtimeGateway } = await import("./realtime.gateway");
    const gateway = new RealtimeGateway(
      {} as AuthService,
      {} as ProjectsService,
    );
    const localSocket = realtimeSocket("socket-local", "2026-07-24T00:00:00.000Z");
    const remoteSocket = realtimeSocket("socket-remote", "2026-07-24T00:01:00.000Z");
    localSocket.data.userId = "user-local";
    localSocket.data.userEmail = "local@example.com";
    remoteSocket.data.userId = "user-remote";
    remoteSocket.data.userEmail = "remote@example.com";

    const to = { emit: vi.fn() };
    gateway.server = {
      emit: vi.fn(),
      to: vi.fn(() => to),
      in: vi.fn(() => ({ fetchSockets: vi.fn(async () => [localSocket, remoteSocket]) })),
      fetchSockets: vi.fn(async () => [localSocket, remoteSocket]),
    } as unknown as Server;

    gateway.handleConnection(localSocket);
    gateway.handleConnection(remoteSocket);
    const response = await gateway.handleUsersList();

    expect(response.data.map((user) => user.id)).toEqual(["socket-local", "socket-remote"]);
    expect(JSON.stringify(response.data)).not.toContain("203.0.113");
  });
});

function realtimeSocket(id: string, connectedAt: string) {
  return {
    id,
    handshake: { headers: { "user-agent": "Mozilla/5.0 Chrome/126.0" } },
    conn: { transport: { name: "websocket" } },
    data: {
      realtimeUser: {
        id,
        connectedAt,
        transport: "websocket",
        environment: { browserLabel: "Chrome" },
      },
    },
    emit: vi.fn(),
  } as unknown as Socket;
}
