import { loadOrbitConfig } from "@orbit/config";
import {
  createPresentationCompanionEvent,
  presentationCompanionAuthorityRoomId,
  presentationCompanionRoomId,
  presentationPresenterRoomId,
} from "@orbit/realtime";
import {
  presentationCompanionAnnotationAckSchema,
  presentationCompanionAnnotationCommandSchema,
  presentationCompanionAnnotationSnapshotSchema,
  presentationCompanionAuthorityPayloadSchema,
  presentationCompanionHeartbeatPayloadSchema,
  presentationCompanionJoinPayloadSchema,
  presentationCompanionLaserSchema,
  presentationCompanionOutputStateSchema,
  presentationCompanionSignalSchema,
  presentationCompanionSnapshotRequestSchema,
  type CompanionAccessScope,
  type PresentationCompanionEvent,
} from "@orbit/shared";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import cookieParser from "cookie-parser";
import { createHmac } from "node:crypto";
import type { Server, Socket } from "socket.io";

import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { resolveAllowedWebOrigins } from "../common/web-origin";
import { ProjectsService } from "../projects/projects.service";
import { companionAccessCookieName } from "./companion-access-cookie";
import { PresentationCompanionPublisher } from "./presentation-companion.publisher";
import { PresentationCompanionCommandRateLimitService } from "./presentation-companion-rate-limit.service";
import { PresentationCompanionService } from "./presentation-companion.service";
import { PresentationSessionRepository } from "./presentation-session.repository";

const config = loadOrbitConfig(process.env, { service: "api" });

@WebSocketGateway({
  cors: {
    credentials: true,
    origin: resolveAllowedWebOrigins(config.WEB_ORIGIN),
  },
  maxHttpBufferSize: 8 * 1024 * 1024,
})
export class PresentationCompanionGateway
  implements OnGatewayInit, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly sessions: PresentationSessionRepository,
    private readonly companion: PresentationCompanionService,
    private readonly publisher: PresentationCompanionPublisher,
    private readonly rateLimit: PresentationCompanionCommandRateLimitService,
  ) {}

  afterInit(server: Server): void {
    this.publisher.attach(server);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    if (
      client.data.presentationCompanionRole === "presenter" &&
      typeof client.data.presentationSessionId === "string" &&
      typeof client.data.presentationAuthorityEpochId === "string"
    ) {
      const sessionId = client.data.presentationSessionId as string;
      const authorityEpochId =
        client.data.presentationAuthorityEpochId as string;
      const timer = setTimeout(() => {
        void this.publishAuthorityAfterLeaseChange(
          sessionId,
          authorityEpochId,
        );
      }, 10_100);
      timer.unref();
      return;
    }
    if (
      client.data.presentationCompanionRole !== "companion" ||
      typeof client.data.presentationSessionId !== "string" ||
      !Number.isSafeInteger(
        client.data.presentationCompanionGeneration,
      )
    ) {
      return;
    }
    const sessionId = client.data.presentationSessionId as string;
    const generation =
      client.data.presentationCompanionGeneration as number;
    const cleared = await this.companion.clearPresence(
      sessionId,
      generation,
    );
    if (!cleared) return;
    this.companion.recordDisconnected?.({
      pairingGeneration: generation,
      sessionId,
    });
    this.publisher.publishPresence(sessionId, {
      connected: false,
      pairingGeneration:
        await this.companion.getLatestGeneration(sessionId),
      connectedAt: null,
      rttBucket: null,
    });
  }

  @SubscribeMessage("presentation:companion:authority-claim")
  async claimAuthority(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed =
      presentationCompanionAuthorityPayloadSchema.safeParse(body);
    if (!this.enabled() || !parsed.success) {
      return emitError(client, sessionIdFrom(body), "INVALID_PAYLOAD");
    }
    const presenter = await this.authenticatePresenter(
      client,
      parsed.data.sessionId,
    );
    if (!presenter) {
      return emitError(
        client,
        parsed.data.sessionId,
        "AUTH_REQUIRED",
      );
    }
    if (
      !(await this.companion.claimAuthority(
        parsed.data.sessionId,
        parsed.data.authorityEpochId,
      ))
    ) {
      return emitError(
        client,
        parsed.data.sessionId,
        "NOT_AUTHORITY",
      );
    }

    const previousRoom = client.data.presentationAuthorityRoom;
    if (typeof previousRoom === "string") {
      await client.leave(previousRoom);
    }
    const authorityRoom = presentationCompanionAuthorityRoomId(
      parsed.data.sessionId,
      parsed.data.authorityEpochId,
    );
    await client.join([
      presentationPresenterRoomId(parsed.data.sessionId),
      authorityRoom,
    ]);
    client.data.presentationCompanionRole = "presenter";
    client.data.presentationSessionId = parsed.data.sessionId;
    client.data.presentationAuthorityEpochId =
      parsed.data.authorityEpochId;
    client.data.presentationAuthorityRoom = authorityRoom;
    client.data.presentationPresenterEventUserId =
      presenterEventUserId(presenter.userId);
    await this.publisher.publishAuthorityChanged(
      parsed.data.sessionId,
      parsed.data.authorityEpochId,
    );
    return {
      claimed: true,
      sessionId: parsed.data.sessionId,
      authorityEpochId: parsed.data.authorityEpochId,
    };
  }

  @SubscribeMessage("presentation:companion:authority-heartbeat")
  async heartbeatAuthority(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed =
      presentationCompanionAuthorityPayloadSchema.safeParse(body);
    if (
      !this.enabled() ||
      !parsed.success ||
      !this.matchesAuthoritySocket(client, parsed.data)
    ) {
      return emitError(client, sessionIdFrom(body), "NOT_AUTHORITY");
    }
    const renewed = await this.companion.heartbeatAuthority(
      parsed.data.sessionId,
      parsed.data.authorityEpochId,
    );
    if (!renewed) {
      await this.publisher.publishAuthorityChanged(
        parsed.data.sessionId,
        await this.companion.getAuthority(parsed.data.sessionId),
      );
      return emitError(
        client,
        parsed.data.sessionId,
        "NOT_AUTHORITY",
      );
    }
    return { renewed: true, sessionId: parsed.data.sessionId };
  }

  @SubscribeMessage("presentation:companion:join")
  async joinCompanion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed = presentationCompanionJoinPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return emitError(client, sessionIdFrom(body), "INVALID_PAYLOAD");
    }
    if (!this.enabled()) {
      await this.revokeAuthenticatedCompanion(
        client,
        parsed.data.sessionId,
      );
      return emitError(
        client,
        parsed.data.sessionId,
        "SESSION_UNAVAILABLE",
      );
    }
    const credential = await this.authenticateCompanion(
      client,
      parsed.data.sessionId,
    );
    if (!credential) {
      return emitError(
        client,
        parsed.data.sessionId,
        "AUTH_REQUIRED",
      );
    }

    const roomId = presentationCompanionRoomId(
      parsed.data.sessionId,
      credential.pairingGeneration,
    );
    const previousRoom = client.data.presentationCompanionRoom;
    if (typeof previousRoom === "string" && previousRoom !== roomId) {
      await client.leave(previousRoom);
    }
    await client.join(roomId);
    const connectedAt = new Date().toISOString();
    client.data.presentationCompanionRole = "companion";
    client.data.presentationSessionId = parsed.data.sessionId;
    client.data.presentationCompanionGeneration =
      credential.pairingGeneration;
    client.data.presentationCompanionId = credential.companionId;
    client.data.presentationCompanionRoom = roomId;
    client.data.presentationCompanionConnectedAt = connectedAt;
    await this.companion.renewPresence(parsed.data.sessionId, {
      generation: credential.pairingGeneration,
      connectedAt,
      rttBucket: "unknown",
    });
    this.companion.recordConnected?.({
      companionId: credential.companionId,
      pairingGeneration: credential.pairingGeneration,
      sessionId: parsed.data.sessionId,
    });
    this.publisher.publishPresence(parsed.data.sessionId, {
      connected: true,
      pairingGeneration: credential.pairingGeneration,
      connectedAt,
      rttBucket: "unknown",
    });

    const event = createPresentationCompanionEvent({
      type: "presentation:companion:joined",
      roomId,
      sessionId: parsed.data.sessionId,
      userId: companionEventUserId(credential.companionId),
      payload: {
        pairingGeneration: credential.pairingGeneration,
        scopes: credential.scopes,
      },
    });
    client.emit(event.type, event);
    await this.publisher.publishAuthorityChanged(
      parsed.data.sessionId,
      await this.companion.getAuthority(parsed.data.sessionId),
    );
    return event;
  }

  @SubscribeMessage("presentation:companion:heartbeat")
  async heartbeatCompanion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed =
      presentationCompanionHeartbeatPayloadSchema.safeParse(body);
    if (!this.enabled()) {
      if (parsed.success) {
        await this.revokeAuthenticatedCompanion(
          client,
          parsed.data.sessionId,
        );
      }
      return emitError(
        client,
        sessionIdFrom(body),
        "SESSION_UNAVAILABLE",
      );
    }
    if (!parsed.success) {
      return emitError(client, sessionIdFrom(body), "INVALID_PAYLOAD");
    }
    const credential = await this.requireCompanionSocket(
      client,
      parsed.data.sessionId,
    );
    if (!credential) {
      return emitError(
        client,
        parsed.data.sessionId,
        "STALE_GENERATION",
      );
    }
    const connectedAt =
      typeof client.data.presentationCompanionConnectedAt === "string"
        ? client.data.presentationCompanionConnectedAt
        : new Date().toISOString();
    const rttBucket = bucketRtt(parsed.data.rttMs);
    await this.companion.renewPresence(parsed.data.sessionId, {
      generation: credential.pairingGeneration,
      connectedAt,
      rttBucket,
    });
    this.publisher.publishPresence(parsed.data.sessionId, {
      connected: true,
      pairingGeneration: credential.pairingGeneration,
      connectedAt,
      rttBucket,
    });
    return { renewed: true, rttBucket };
  }

  @SubscribeMessage("presentation:companion:output-state")
  async relayOutputState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed =
      presentationCompanionOutputStateSchema.safeParse(body);
    if (
      !this.enabled() ||
      !parsed.success ||
      !(await this.requireAuthoritySocket(client, parsed.data))
    ) {
      return emitError(client, sessionIdFrom(body), "NOT_AUTHORITY");
    }
    return this.emitToCurrentCompanion(
      client,
      parsed.data.sessionId,
      "presentation:companion:output-state",
      parsed.data,
    );
  }

  @SubscribeMessage("presentation:companion:annotation-command")
  async relayAnnotationCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed =
      presentationCompanionAnnotationCommandSchema.safeParse(body);
    if (!this.enabled() || !parsed.success) {
      return emitError(client, sessionIdFrom(body), "INVALID_PAYLOAD");
    }
    const credential = await this.requireCompanionSocket(
      client,
      parsed.data.sessionId,
      "write-annotation",
    );
    if (!credential) {
      return emitError(
        client,
        parsed.data.sessionId,
        "STALE_GENERATION",
      );
    }
    if (
      (await this.companion.getAuthority(parsed.data.sessionId)) !==
      parsed.data.authorityEpochId
    ) {
      return emitError(
        client,
        parsed.data.sessionId,
        "NOT_AUTHORITY",
      );
    }
    try {
      await this.rateLimit.consumeDrawing(credential.companionId);
    } catch {
      this.companion.recordCommandRejected?.({
        reasonCode: "RATE_LIMITED",
        sessionId: parsed.data.sessionId,
      });
      return emitError(
        client,
        parsed.data.sessionId,
        "RATE_LIMITED",
      );
    }
    const roomId = presentationCompanionAuthorityRoomId(
      parsed.data.sessionId,
      parsed.data.authorityEpochId,
    );
    const event = createPresentationCompanionEvent({
      type: "presentation:companion:annotation-command",
      roomId,
      sessionId: parsed.data.sessionId,
      userId: companionEventUserId(credential.companionId),
      payload: parsed.data,
    });
    this.server.to(roomId).emit(event.type, event);
    return event;
  }

  @SubscribeMessage("presentation:companion:snapshot-request")
  async relaySnapshotRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed =
      presentationCompanionSnapshotRequestSchema.safeParse(body);
    if (!this.enabled() || !parsed.success) {
      return emitError(client, sessionIdFrom(body), "INVALID_PAYLOAD");
    }
    const credential = await this.requireCompanionSocket(
      client,
      parsed.data.sessionId,
    );
    if (
      !credential ||
      (await this.companion.getAuthority(parsed.data.sessionId)) !==
        parsed.data.authorityEpochId
    ) {
      return emitError(
        client,
        parsed.data.sessionId,
        "NOT_AUTHORITY",
      );
    }
    const roomId = presentationCompanionAuthorityRoomId(
      parsed.data.sessionId,
      parsed.data.authorityEpochId,
    );
    const event = createPresentationCompanionEvent({
      type: "presentation:companion:snapshot-request",
      roomId,
      sessionId: parsed.data.sessionId,
      userId: companionEventUserId(credential.companionId),
      payload: parsed.data,
    });
    this.server.to(roomId).emit(event.type, event);
    return event;
  }

  @SubscribeMessage("presentation:companion:annotation-ack")
  relayAnnotationAck(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    return this.relayPresenterPayload(
      client,
      body,
      presentationCompanionAnnotationAckSchema,
      "presentation:companion:annotation-ack",
    );
  }

  @SubscribeMessage("presentation:companion:annotation-snapshot")
  relayAnnotationSnapshot(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    return this.relayPresenterPayload(
      client,
      body,
      presentationCompanionAnnotationSnapshotSchema,
      "presentation:companion:annotation-snapshot",
    );
  }

  @SubscribeMessage("presentation:companion:laser")
  async relayLaser(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed = presentationCompanionLaserSchema.safeParse(body);
    if (!this.enabled() || !parsed.success) {
      return emitError(client, sessionIdFrom(body), "INVALID_PAYLOAD");
    }
    try {
      await this.rateLimit.consumeLaser(client.id);
    } catch {
      this.companion.recordCommandRejected?.({
        reasonCode: "RATE_LIMITED",
        sessionId: parsed.data.sessionId,
      });
      return emitError(
        client,
        parsed.data.sessionId,
        "RATE_LIMITED",
      );
    }
    if (client.data.presentationCompanionRole === "presenter") {
      if (!(await this.requireAuthoritySocket(client, parsed.data))) {
        return emitError(
          client,
          parsed.data.sessionId,
          "NOT_AUTHORITY",
        );
      }
      return this.emitToCurrentCompanion(
        client,
        parsed.data.sessionId,
        "presentation:companion:laser",
        parsed.data,
      );
    }
    const credential = await this.requireCompanionSocket(
      client,
      parsed.data.sessionId,
    );
    if (
      !credential ||
      (await this.companion.getAuthority(parsed.data.sessionId)) !==
        parsed.data.authorityEpochId
    ) {
      return emitError(
        client,
        parsed.data.sessionId,
        "NOT_AUTHORITY",
      );
    }
    const roomId = presentationCompanionAuthorityRoomId(
      parsed.data.sessionId,
      parsed.data.authorityEpochId,
    );
    const event = createPresentationCompanionEvent({
      type: "presentation:companion:laser",
      roomId,
      sessionId: parsed.data.sessionId,
      userId: companionEventUserId(credential.companionId),
      payload: parsed.data,
    });
    this.server.to(roomId).volatile.emit(event.type, event);
    return event;
  }

  @SubscribeMessage("presentation:companion:signal")
  async relaySignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const parsed = presentationCompanionSignalSchema.safeParse(body);
    if (!this.enabled() || !parsed.success) {
      return emitError(client, sessionIdFrom(body), "INVALID_PAYLOAD");
    }
    const generation = await this.companion.getLatestGeneration(
      parsed.data.sessionId,
    );
    if (generation !== parsed.data.targetGeneration) {
      return emitError(
        client,
        parsed.data.sessionId,
        "STALE_GENERATION",
      );
    }
    try {
      await this.rateLimit.consumeDrawing(client.id);
    } catch {
      this.companion.recordCommandRejected?.({
        reasonCode: "RATE_LIMITED",
        sessionId: parsed.data.sessionId,
      });
      return emitError(
        client,
        parsed.data.sessionId,
        "RATE_LIMITED",
      );
    }
    if (client.data.presentationCompanionRole === "presenter") {
      if (!(await this.requireAuthoritySocket(client, parsed.data))) {
        return emitError(
          client,
          parsed.data.sessionId,
          "NOT_AUTHORITY",
        );
      }
      if (parsed.data.kind === "end" && parsed.data.reason === "failed") {
        this.companion.recordWebRtcFailed?.({
          pairingGeneration: generation,
          sessionId: parsed.data.sessionId,
        });
      }
      return this.emitToGeneration(
        client,
        parsed.data.sessionId,
        generation,
        "presentation:companion:signal",
        parsed.data,
      );
    }
    const credential = await this.requireCompanionSocket(
      client,
      parsed.data.sessionId,
    );
    if (
      !credential ||
      credential.pairingGeneration !== generation ||
      (await this.companion.getAuthority(parsed.data.sessionId)) !==
        parsed.data.authorityEpochId
    ) {
      return emitError(
        client,
        parsed.data.sessionId,
        "NOT_AUTHORITY",
      );
    }
    if (parsed.data.kind === "end" && parsed.data.reason === "failed") {
      this.companion.recordWebRtcFailed?.({
        pairingGeneration: generation,
        sessionId: parsed.data.sessionId,
      });
    }
    const roomId = presentationCompanionAuthorityRoomId(
      parsed.data.sessionId,
      parsed.data.authorityEpochId,
    );
    const event = createPresentationCompanionEvent({
      type: "presentation:companion:signal",
      roomId,
      sessionId: parsed.data.sessionId,
      userId: companionEventUserId(credential.companionId),
      payload: parsed.data,
    });
    this.server.to(roomId).emit(event.type, event);
    return event;
  }

  private async relayPresenterPayload(
    client: Socket,
    body: unknown,
    schema:
      | typeof presentationCompanionAnnotationAckSchema
      | typeof presentationCompanionAnnotationSnapshotSchema,
    type:
      | "presentation:companion:annotation-ack"
      | "presentation:companion:annotation-snapshot",
  ) {
    const parsed = schema.safeParse(body);
    if (
      !this.enabled() ||
      !parsed.success ||
      !(await this.requireAuthoritySocket(client, parsed.data))
    ) {
      return emitError(client, sessionIdFrom(body), "NOT_AUTHORITY");
    }
    return this.emitToCurrentCompanion(
      client,
      parsed.data.sessionId,
      type,
      parsed.data,
    );
  }

  private async emitToCurrentCompanion(
    client: Socket,
    sessionId: string,
    type: PresentationCompanionEvent["type"],
    payload: unknown,
  ) {
    const generation =
      await this.companion.getLatestGeneration(sessionId);
    if (generation === null) {
      return emitError(client, sessionId, "STALE_GENERATION");
    }
    return this.emitToGeneration(
      client,
      sessionId,
      generation,
      type,
      payload,
    );
  }

  private emitToGeneration(
    client: Socket,
    sessionId: string,
    generation: number,
    type: PresentationCompanionEvent["type"],
    payload: unknown,
  ) {
    const roomId = presentationCompanionRoomId(sessionId, generation);
    const userId =
      client.data.presentationCompanionRole === "companion"
        ? companionEventUserId(
            String(client.data.presentationCompanionId),
          )
        : String(client.data.presentationPresenterEventUserId);
    const event = createPresentationCompanionEvent({
      type,
      roomId,
      sessionId,
      userId,
      payload,
    });
    this.server.to(roomId).emit(event.type, event);
    return event;
  }

  private async requireAuthoritySocket(
    client: Socket,
    input: { sessionId: string; authorityEpochId: string },
  ): Promise<boolean> {
    return (
      this.matchesAuthoritySocket(client, input) &&
      (await this.companion.getAuthority(input.sessionId)) ===
        input.authorityEpochId
    );
  }

  private matchesAuthoritySocket(
    client: Socket,
    input: { sessionId: string; authorityEpochId: string },
  ): boolean {
    return (
      client.data.presentationCompanionRole === "presenter" &&
      client.data.presentationSessionId === input.sessionId &&
      client.data.presentationAuthorityEpochId ===
        input.authorityEpochId
    );
  }

  private async authenticatePresenter(
    client: Socket,
    sessionId: string,
  ): Promise<{ userId: string } | null> {
    const authSessionId = readSignedCookie(
      client,
      authSessionCookieName,
    );
    if (!authSessionId) return null;
    try {
      const session =
        await this.sessions.findActiveCompanionSession(sessionId);
      if (!session) return null;
      const { user } = await this.authService.me(authSessionId);
      await this.projectsService.assertCanWriteProject(
        session.project_id,
        user.userId,
      );
      return { userId: user.userId };
    } catch {
      return null;
    }
  }

  private authenticateCompanion(client: Socket, sessionId: string) {
    const token = readSignedCookie(
      client,
      companionAccessCookieName,
    );
    if (!token) return Promise.resolve(null);
    return this.companion.verifyCredential(
      token,
      readUserAgent(client),
      sessionId,
    );
  }

  private async revokeAuthenticatedCompanion(
    client: Socket,
    sessionId: string,
  ): Promise<void> {
    const credential = await this.authenticateCompanion(client, sessionId);
    if (!credential) return;
    await this.companion.revokeSession(sessionId, "disconnected");
  }

  private async requireCompanionSocket(
    client: Socket,
    sessionId: string,
    requiredScope?: CompanionAccessScope,
  ) {
    if (
      client.data.presentationCompanionRole !== "companion" ||
      client.data.presentationSessionId !== sessionId
    ) {
      return null;
    }
    const credential = await this.authenticateCompanion(
      client,
      sessionId,
    );
    if (
      !credential ||
      credential.pairingGeneration !==
        client.data.presentationCompanionGeneration ||
      (requiredScope && !credential.scopes.includes(requiredScope))
    ) {
      return null;
    }
    return credential;
  }

  private enabled(): boolean {
    return config.IPAD_PRESENTER_COMPANION_ENABLED;
  }

  private async publishAuthorityAfterLeaseChange(
    sessionId: string,
    previousAuthorityEpochId: string,
  ): Promise<void> {
    try {
      const currentAuthorityEpochId =
        await this.companion.getAuthority(sessionId);
      if (currentAuthorityEpochId !== previousAuthorityEpochId) {
        await this.publisher.publishAuthorityChanged(
          sessionId,
          currentAuthorityEpochId,
        );
      }
    } catch {
      // Redis recovery is surfaced by the adapter/service health path.
    }
  }
}

type CompanionErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_UNAVAILABLE"
  | "NOT_AUTHORITY"
  | "STALE_GENERATION"
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED";

const errorMessages: Record<CompanionErrorCode, string> = {
  AUTH_REQUIRED: "Authentication required",
  SESSION_UNAVAILABLE: "Presentation session unavailable",
  NOT_AUTHORITY: "Presenter authority unavailable",
  STALE_GENERATION: "Companion credential expired",
  INVALID_PAYLOAD: "Invalid presentation command",
  RATE_LIMITED: "Too many presentation commands",
};

function emitError(
  client: Socket,
  sessionId: string,
  code: CompanionErrorCode,
) {
  const event = createPresentationCompanionEvent({
    type: "presentation:error",
    roomId: client.id,
    sessionId,
    userId: "system",
    payload: { code, message: errorMessages[code] },
  });
  client.emit(event.type, event);
  return { event: event.type, data: event };
}

function readSignedCookie(client: Socket, name: string): string | null {
  const header = firstHeader(client.handshake.headers.cookie);
  const prefix = `${name}=`;
  const pair = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!pair) return null;
  const encoded = pair.slice(prefix.length);
  let value = encoded;
  try {
    value = decodeURIComponent(encoded);
  } catch {
    value = encoded;
  }
  const unsigned = cookieParser.signedCookie(
    value,
    config.COOKIE_SECRET,
  );
  return typeof unsigned === "string" && unsigned.length > 0
    ? unsigned
    : null;
}

function readUserAgent(client: Socket): string {
  return firstHeader(client.handshake.headers["user-agent"]);
}

function firstHeader(
  value: string | string[] | undefined,
): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sessionIdFrom(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "sessionId" in body &&
    typeof body.sessionId === "string" &&
    body.sessionId.length >= 1 &&
    body.sessionId.length <= 128
  ) {
    return body.sessionId;
  }
  return "unavailable";
}

function companionEventUserId(companionId: string): string {
  return `companion:${companionId}`;
}

function presenterEventUserId(userId: string): string {
  const digest = createHmac("sha256", config.SESSION_SECRET)
    .update(userId)
    .digest("base64url");
  return `presenter:${digest}`;
}

function bucketRtt(
  rttMs: number | undefined,
): "fast" | "moderate" | "slow" | "unknown" {
  if (rttMs === undefined) return "unknown";
  if (rttMs <= 100) return "fast";
  if (rttMs <= 300) return "moderate";
  return "slow";
}
