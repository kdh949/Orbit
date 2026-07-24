import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import {
  io as createSocketClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    COOKIE_SECRET: "companion-gateway-cookie-secret",
    IPAD_PRESENTER_COMPANION_ENABLED: true,
    SESSION_SECRET: "companion-gateway-session-secret",
    WEB_ORIGIN: "https://present.orbit.example",
  }),
}));

vi.mock("cookie-parser", () => ({
  default: {
    signedCookie: (value: string) =>
      value.startsWith("valid-") ? value.slice("valid-".length) : false,
  },
}));

import { companionAccessCookieName } from "./companion-access-cookie";
import { PresentationCompanionGateway } from "./presentation-companion.gateway";

const runIntegration =
  process.env.RUN_COMPANION_SOCKET_INTEGRATION === "true";

describe.skipIf(!runIntegration)(
  "PresentationCompanionGateway socket.io-client integration",
  () => {
    it(
      "joins presenter and companion identities and relays annotation only to authority",
      async () => {
        const fixture = await createGatewayServer();
        const presenter = await connectClient(
          fixture.port,
          "orbit_session=valid-auth-session",
        );
        const companion = await connectClient(
          fixture.port,
          `${companionAccessCookieName}=valid-companion-token`,
        );
        const audience = await connectClient(
          fixture.port,
          "orbit_presentation_audience=valid-audience-token",
        );

        try {
          await expect(
            emitWithAck(presenter, "presentation:companion:authority-claim", {
              sessionId: "session_1",
              authorityEpochId: "epoch_1",
            }),
          ).resolves.toMatchObject({ claimed: true });
          await expect(
            emitWithAck(companion, "presentation:companion:join", {
              sessionId: "session_1",
            }),
          ).resolves.toMatchObject({
            type: "presentation:companion:joined",
          });
          await expect(
            emitWithAck(audience, "presentation:companion:join", {
              sessionId: "session_1",
            }),
          ).resolves.toMatchObject({
            data: { payload: { code: "AUTH_REQUIRED" } },
          });

          const relayed = onceEvent(
            presenter,
            "presentation:companion:annotation-command",
          );
          companion.emit(
            "presentation:companion:annotation-command",
            annotationCommand(),
          );
          await expect(relayed).resolves.toMatchObject({
            roomId:
              "presentation:session_1:companion-authority:epoch_1",
            payload: annotationCommand(),
          });
          expect(
            fixture.rateLimit.consumeDrawing,
          ).toHaveBeenCalledWith("companion_opaque_1");

          const offered = onceEvent(
            companion,
            "presentation:companion:signal",
          );
          presenter.emit(
            "presentation:companion:signal",
            companionSignal("offer"),
          );
          await expect(offered).resolves.toMatchObject({
            payload: companionSignal("offer"),
          });

          const answered = onceEvent(
            presenter,
            "presentation:companion:signal",
          );
          companion.emit(
            "presentation:companion:signal",
            companionSignal("answer"),
          );
          await expect(answered).resolves.toMatchObject({
            payload: companionSignal("answer"),
          });
        } finally {
          presenter.disconnect();
          companion.disconnect();
          audience.disconnect();
          await fixture.io.close();
        }
      },
      10_000,
    );

    it(
      "rejoins after a short disconnect and resumes output, laser, and annotation without duplicate delivery",
      async () => {
        const fixture = await createGatewayServer();
        const presenter = await connectClient(
          fixture.port,
          "orbit_session=valid-auth-session",
        );
        let companion = await connectClient(
          fixture.port,
          `${companionAccessCookieName}=valid-companion-token`,
        );

        try {
          await emitWithAck(
            presenter,
            "presentation:companion:authority-claim",
            {
              sessionId: "session_1",
              authorityEpochId: "epoch_1",
            },
          );
          await emitWithAck(companion, "presentation:companion:join", {
            sessionId: "session_1",
          });

          const disconnectedAt = Date.now();
          companion.disconnect();
          companion = await connectClient(
            fixture.port,
            `${companionAccessCookieName}=valid-companion-token`,
          );
          await emitWithAck(companion, "presentation:companion:join", {
            sessionId: "session_1",
          });
          expect(Date.now() - disconnectedAt).toBeLessThan(3_000);

          const output = onceEvent(
            companion,
            "presentation:companion:output-state",
          );
          presenter.emit(
            "presentation:companion:output-state",
            outputState(),
          );
          await expect(output).resolves.toMatchObject({
            payload: outputState(),
          });

          const laser = onceEvent(
            presenter,
            "presentation:companion:laser",
          );
          companion.emit("presentation:companion:laser", laserMove());
          await expect(laser).resolves.toMatchObject({
            payload: laserMove(),
          });

          const annotationDeliveries = vi.fn();
          presenter.on(
            "presentation:companion:annotation-command",
            annotationDeliveries,
          );
          const annotation = onceEvent(
            presenter,
            "presentation:companion:annotation-command",
          );
          companion.emit(
            "presentation:companion:annotation-command",
            annotationCommand(),
          );
          await expect(annotation).resolves.toMatchObject({
            payload: annotationCommand(),
          });
          await new Promise((resolve) => setTimeout(resolve, 25));
          expect(annotationDeliveries).toHaveBeenCalledTimes(1);
        } finally {
          presenter.disconnect();
          companion.disconnect();
          await fixture.io.close();
        }
      },
      10_000,
    );
  },
);

async function createGatewayServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });
  const companionService = {
    claimAuthority: vi.fn().mockResolvedValue(true),
    clearPresence: vi.fn().mockResolvedValue(true),
    getAuthority: vi.fn().mockResolvedValue("epoch_1"),
    getLatestGeneration: vi.fn().mockResolvedValue(2),
    heartbeatAuthority: vi.fn().mockResolvedValue(true),
    renewPresence: vi.fn().mockResolvedValue(undefined),
    verifyCredential: vi.fn(
      async (
        token: string,
        _userAgent: string,
        sessionId: string,
      ) =>
        token === "companion-token" && sessionId === "session_1"
          ? {
              companionId: "companion_opaque_1",
              sessionId: "session_1",
              projectId: "project_1",
              deckId: "deck_1",
              deckVersion: 1,
              pairingGeneration: 2,
              scopes: [
                "view-audience-output",
                "write-annotation",
              ],
              expiresAt: "2099-07-23T04:00:00.000Z",
              uaHash: "opaque-user-agent-hash-value",
            }
          : null,
    ),
  };
  const publisher = {
    attach: vi.fn(),
    publishAuthorityChanged: vi.fn().mockResolvedValue(undefined),
    publishPresence: vi.fn(),
  };
  const rateLimit = {
    consumeDrawing: vi.fn().mockResolvedValue(undefined),
    consumeLaser: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = new PresentationCompanionGateway(
    {
      me: vi.fn().mockResolvedValue({
        user: { userId: "user_1" },
      }),
    } as never,
    {
      assertCanWriteProject: vi.fn().mockResolvedValue(undefined),
    } as never,
    {
      findActiveCompanionSession: vi.fn().mockResolvedValue({
        session_id: "session_1",
        project_id: "project_1",
      }),
    } as never,
    companionService as never,
    publisher as never,
    rateLimit as never,
  );
  gateway.server = io;
  gateway.afterInit(io);
  io.on("connection", (socket) => {
    bind(socket, "presentation:companion:authority-claim", (body) =>
      gateway.claimAuthority(socket, body),
    );
    bind(socket, "presentation:companion:join", (body) =>
      gateway.joinCompanion(socket, body),
    );
    bind(
      socket,
      "presentation:companion:annotation-command",
      (body) => gateway.relayAnnotationCommand(socket, body),
    );
    bind(socket, "presentation:companion:output-state", (body) =>
      gateway.relayOutputState(socket, body),
    );
    bind(socket, "presentation:companion:laser", (body) =>
      gateway.relayLaser(socket, body),
    );
    bind(socket, "presentation:companion:signal", (body) =>
      gateway.relaySignal(socket, body),
    );
    socket.on("disconnect", () => {
      void gateway.handleDisconnect(socket);
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  return {
    io,
    port: (httpServer.address() as AddressInfo).port,
    rateLimit,
  };
}

function bind(
  socket: Parameters<Parameters<Server["on"]>[1]>[0],
  event: string,
  handler: (body: unknown) => Promise<unknown>,
) {
  socket.on(
    event,
    async (body: unknown, acknowledge?: (value: unknown) => void) => {
      const result = await handler(body);
      acknowledge?.(result);
    },
  );
}

function connectClient(
  port: number,
  cookie: string,
): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(`http://127.0.0.1:${port}`, {
      extraHeaders: { cookie, "user-agent": "Safari" },
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emitWithAck(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<unknown> {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function onceEvent(
  socket: ClientSocket,
  event: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once(event, resolve);
  });
}

function outputState() {
  return {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    outputRevision: 4,
    surfaceRevision: 2,
    surfaceId: "surface_1",
    outputMode: "slide",
    slideId: "slide_1",
    slideIndex: 0,
    animationStep: 1,
  };
}

function laserMove() {
  return {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    surfaceId: "surface_1",
    sequence: 8,
    kind: "move",
    x: 0.25,
    y: 0.75,
  };
}

function annotationCommand() {
  return {
    sessionId: "session_1",
    authorityEpochId: "epoch_1",
    surfaceId: "surface_1",
    clientOperationId: "operation_1",
    baseRevision: 1,
    sequence: 1,
    kind: "stroke-points",
    strokeId: "stroke_1",
    points: [
      {
        x: 0.5,
        y: 0.5,
        pressure: 0.5,
        t: 1,
      },
    ],
  };
}

function companionSignal(kind: "answer" | "offer") {
  return {
    authorityEpochId: "epoch_1",
    kind,
    sdp: `${kind}-sdp`,
    sessionId: "session_1",
    shareEpochId: "share_1",
    signalId: "signal_1",
    targetGeneration: 2,
  };
}
