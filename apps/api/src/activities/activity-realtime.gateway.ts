import { loadOrbitConfig } from "@orbit/config";
import {
  presentationAudienceRoomId,
  presentationPresenterRoomId,
} from "@orbit/realtime";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import cookieParser from "cookie-parser";
import type { Server, Socket } from "socket.io";

import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { resolveAllowedWebOrigins } from "../common/web-origin";
import {
  audienceAccessCookieName,
  verifyAudienceAccessToken,
} from "../presentation-sessions/audience-access-cookie";
import { PresentationSessionAccessService } from "../presentation-sessions/presentation-session-access.service";
import { ProjectsService } from "../projects/projects.service";
import { ActivityRealtimePublisher } from "./activity-realtime.publisher";

const config = loadOrbitConfig(process.env, { service: "api" });

@WebSocketGateway({
  cors: {
    credentials: true,
    origin: resolveAllowedWebOrigins(config.WEB_ORIGIN),
  },
})
export class ActivityRealtimeGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly presentationSessionAccess: PresentationSessionAccessService,
    private readonly publisher: ActivityRealtimePublisher,
  ) {}

  afterInit(server: Server): void {
    this.publisher.attach(server);
  }

  @SubscribeMessage("presentation:presenter:join")
  async joinPresenter(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const input = readJoinInput(body);
    const authSessionId = readSignedCookie(client, authSessionCookieName);
    if (!input || !authSessionId) return emitPresentationError(client);
    try {
      const { user } = await this.authService.me(authSessionId);
      await this.projectsService.assertCanWriteProject(
        input.projectId,
        user.userId,
      );
      await this.presentationSessionAccess.assertPresenterSession(
        input.projectId,
        input.sessionId,
      );
      await client.join(presentationPresenterRoomId(input.sessionId));
      client.data.presentationSessionId = input.sessionId;
      client.data.presentationRole = "presenter";
      return {
        joined: true,
        sessionId: input.sessionId,
        role: "presenter" as const,
      };
    } catch {
      return emitPresentationError(client);
    }
  }

  @SubscribeMessage("presentation:audience:join")
  async joinAudience(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ) {
    const input = readJoinInput(body);
    const token = readSignedCookie(client, audienceAccessCookieName);
    if (!input || !token) return emitPresentationError(client);
    const payload = verifyAudienceAccessToken(
      config,
      token,
      readUserAgent(client),
    );
    if (
      !payload ||
      payload.sessionId !== input.sessionId ||
      payload.projectId !== input.projectId
    ) {
      return emitPresentationError(client);
    }
    try {
      await this.presentationSessionAccess.assertAudienceAccess(
        input.sessionId,
        input.projectId,
      );
      await client.join(presentationAudienceRoomId(input.sessionId));
      client.data.presentationSessionId = input.sessionId;
      client.data.presentationRole = "audience";
      return {
        joined: true,
        sessionId: input.sessionId,
        role: "audience" as const,
      };
    } catch {
      return emitPresentationError(client);
    }
  }
}

function readJoinInput(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("sessionId" in value) ||
    !("projectId" in value) ||
    typeof value.sessionId !== "string" ||
    typeof value.projectId !== "string" ||
    value.sessionId.length === 0 ||
    value.projectId.length === 0
  ) {
    return null;
  }
  return { sessionId: value.sessionId, projectId: value.projectId };
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
  const unsigned = cookieParser.signedCookie(value, config.COOKIE_SECRET);
  return typeof unsigned === "string" && unsigned.length > 0 ? unsigned : null;
}

function readUserAgent(client: Socket): string {
  return firstHeader(client.handshake.headers["user-agent"]);
}

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function emitPresentationError(client: Socket) {
  const payload = { message: "Presentation room access required" };
  client.emit("presentation:error", payload);
  return { event: "presentation:error", data: payload };
}
