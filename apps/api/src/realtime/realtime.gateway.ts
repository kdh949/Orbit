import { createRealtimeEvent } from "@orbit/realtime";
import { demoIds, slideChangedPayloadSchema } from "@orbit/shared";
import { loadOrbitConfig } from "@orbit/config";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import cookieParser from "cookie-parser";
import { Server, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service";
import { authSessionCookieName } from "../auth/auth.constants";
import { ProjectsService } from "../projects/projects.service";
import {
  CanvasShape,
  ConnectedRealtimeUser,
  createCanvasRoom,
  getCanvasRoom,
  getCanvasState,
  updateCanvasShape,
  verifyCanvasRoomPassword
} from "./canvas-room.store";
import { resolveAllowedWebOrigins } from "../common/web-origin";

const orbitConfig = loadOrbitConfig(process.env, { service: "api" });
const realtimeCorsOrigins = resolveAllowedWebOrigins(
  orbitConfig.WEB_ORIGIN
);

@WebSocketGateway({
  cors: {
    credentials: true,
    origin: realtimeCorsOrigins
  }
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService
  ) {}

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    client.data.realtimeUser = buildConnectedUser(client);
    client.emit("server:hello", {
      message: "connected",
      socketId: client.id
    });
    void this.emitUsers();
  }

  handleDisconnect(client: Socket) {
    const roomId = readSocketRoomId(client);
    const projectId = readSocketProjectId(client);
    void this.emitUsers();

    if (roomId) {
      void this.emitRoomUsers(roomId);
    }
    if (projectId) {
      void this.emitProjectPresence(projectId);
    }
  }

  @SubscribeMessage("project:join")
  async handleProjectJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: string }
  ) {
    const projectId = readProjectId(body);
    if (!projectId) {
      return emitProjectError(client, "Project ID is required.");
    }

    const sessionId = readSocketSessionId(client);
    if (!sessionId) {
      return emitProjectError(client, "Authentication required.");
    }

    try {
      const { user } = await this.authService.me(sessionId);
      const project = await this.projectsService.assertCanReadProject(
        projectId,
        user.userId
      );
      const roomName = projectSocketRoomName(project.projectId);

      const previousProjectId = readSocketProjectId(client);
      if (previousProjectId && previousProjectId !== project.projectId) {
        client.leave(projectSocketRoomName(previousProjectId));
        await this.emitProjectPresence(previousProjectId);
      }

      await client.join(roomName);
      client.data.projectId = project.projectId;
      client.data.userId = user.userId;
      client.data.userEmail = user.email ?? "";

      const event = createRealtimeEvent({
        type: "project-joined",
        roomId: project.projectId,
        userId: user.userId,
        payload: { projectId: project.projectId }
      });

      this.server.to(roomName).emit("project-joined", event);
      await this.emitProjectPresence(project.projectId);
      return event;
    } catch {
      return emitProjectError(client, "Project member permission required.");
    }
  }

  @SubscribeMessage("slide:changed")
  handleSlideChanged(@MessageBody() body: unknown) {
    const payload = slideChangedPayloadSchema.parse(body);
    const event = createRealtimeEvent({
      type: "slide-changed",
      roomId: demoIds.projectId,
      sessionId: demoIds.sessionId,
      payload
    });

    this.server
      .to(projectSocketRoomName(event.roomId))
      .emit("slide-changed", event);
    return event;
  }

  @SubscribeMessage("room:create")
  handleRoomCreate(@MessageBody() body: unknown) {
    const password = readPassword(body);
    if (!password) {
      return {
        event: "room:error",
        data: { message: "Room password is required." }
      };
    }

    const room = createCanvasRoom(createRoomId(), password);
    return {
      event: "room:created",
      data: {
        roomId: room.roomId,
        createdAt: room.createdAt
      }
    };
  }

  @SubscribeMessage("room:join")
  async handleRoomJoin(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket
  ) {
    const payload = readRoomPasswordPayload(body);
    if (!payload) {
      return {
        event: "room:error",
        data: { message: "Room ID and password are required." }
      };
    }

    const room = getCanvasRoom(payload.roomId);
    if (!room) {
      return {
        event: "room:error",
        data: { message: "Room does not exist." }
      };
    }

    if (!verifyCanvasRoomPassword(payload.roomId, payload.password)) {
      return {
        event: "room:error",
        data: { message: "Password does not match." }
      };
    }

    const previousRoomId = readSocketRoomId(client);
    if (previousRoomId) {
      client.leave(canvasSocketRoomName(previousRoomId));
      await this.emitRoomUsers(previousRoomId);
    }

    client.join(canvasSocketRoomName(room.roomId));
    client.data.canvasRoomId = room.roomId;
    await this.emitRoomUsers(room.roomId);

    return {
      event: "room:joined",
      data: {
        roomId: room.roomId,
        joinedAt: new Date().toISOString()
      }
    };
  }

  @SubscribeMessage("users:list")
  async handleUsersList() {
    return {
      event: "users:list",
      data: await this.users()
    };
  }

  @SubscribeMessage("room:users")
  async handleRoomUsers(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket
  ) {
    const roomId = readRoomId(body) || readSocketRoomId(client);
    if (!roomId || readSocketRoomId(client) !== roomId) {
      return {
        event: "room:error",
        data: { message: "Join the room before reading room users." }
      };
    }

    return {
      event: "room:users",
      data: await this.roomUsers(roomId)
    };
  }

  @SubscribeMessage("canvas:state")
  handleCanvasState(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket
  ) {
    const roomId = readRoomId(body) || readSocketRoomId(client);
    const room = roomId ? getCanvasRoom(roomId) : null;

    if (!room || readSocketRoomId(client) !== room.roomId) {
      return {
        event: "room:error",
        data: { message: "Join the room before reading canvas state." }
      };
    }

    return {
      event: "canvas:state",
      data: getCanvasState(room.roomId)
    };
  }

  @SubscribeMessage("canvas:update")
  handleCanvasUpdate(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket
  ) {
    const shape = normalizeCanvasShape(body);
    if (!shape) {
      return;
    }

    const joinedRoomId = readSocketRoomId(client);
    if (joinedRoomId !== shape.roomId) {
      return {
        event: "room:error",
        data: { message: "You can only update the room you joined." }
      };
    }

    if (!updateCanvasShape(shape)) {
      return {
        event: "room:error",
        data: { message: "Room does not exist." }
      };
    }

    client.broadcast
      .to(canvasSocketRoomName(shape.roomId))
      .emit("canvas:update", shape);

    return {
      event: "canvas:update",
      data: shape
    };
  }

  private async emitUsers() {
    this.server.emit("users:list", await this.users());
  }

  private async emitRoomUsers(roomId: string) {
    this.server
      .to(canvasSocketRoomName(roomId))
      .emit("room:users", await this.roomUsers(roomId));
  }

  private async emitProjectPresence(projectId: string) {
    const event = createRealtimeEvent({
      type: "project-presence",
      roomId: projectId,
      userId: demoIds.userId,
      payload: {
        projectId,
        users: await this.projectUsers(projectId)
      }
    });

    this.server
      .to(projectSocketRoomName(projectId))
      .emit("project:presence", event);
  }

  private async users() {
    return (await this.server.fetchSockets())
      .map(readSocketRealtimeUser)
      .filter((user): user is ConnectedRealtimeUser => Boolean(user))
      .sort((a, b) =>
      a.connectedAt.localeCompare(b.connectedAt)
    );
  }

  private async roomUsers(roomId: string) {
    return (await this.server.in(canvasSocketRoomName(roomId)).fetchSockets())
      .map(readSocketRealtimeUser)
      .filter((user): user is ConnectedRealtimeUser => Boolean(user))
      .sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
  }

  private async projectUsers(projectId: string) {
    return (await this.server.in(projectSocketRoomName(projectId)).fetchSockets())
      .map((socket) => {
        const user = readSocketRealtimeUser(socket);
        if (!user) {
          return null;
        }

        return {
          connectedAt: user.connectedAt,
          email: typeof socket.data.userEmail === "string" ? socket.data.userEmail : "",
          id: user.id,
          userId: typeof socket.data.userId === "string" ? socket.data.userId : ""
        };
      })
      .filter(
        (
          user
        ): user is {
          connectedAt: string;
          email: string;
          id: string;
          userId: string;
        } => Boolean(user)
      )
      .sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
  }
}

function buildConnectedUser(client: Socket): ConnectedRealtimeUser {
  const headers = client.handshake.headers;
  const userAgent = firstHeader(headers["user-agent"]) || "unknown";

  return {
    id: client.id,
    connectedAt: new Date().toISOString(),
    transport: client.conn.transport.name,
    environment: {
      browserLabel: parseBrowserLabel(userAgent)
    }
  };
}

function readSocketRealtimeUser(socket: Pick<Socket, "data">): ConnectedRealtimeUser | null {
  const value = socket.data.realtimeUser;
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.connectedAt !== "string" ||
    typeof value.transport !== "string" ||
    !isRecord(value.environment) ||
    typeof value.environment.browserLabel !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    connectedAt: value.connectedAt,
    transport: value.transport,
    environment: { browserLabel: value.environment.browserLabel },
  };
}

function normalizeCanvasShape(value: unknown): CanvasShape | null {
  if (!isRecord(value)) {
    return null;
  }

  const roomId = typeof value.roomId === "string" ? value.roomId : "";
  const id = typeof value.id === "string" ? value.id : "";
  const kind =
    value.kind === "circle" ? "circle" : value.kind === "rect" ? "rect" : null;
  const x = normalizeNumber(value.x);
  const y = normalizeNumber(value.y);

  if (!roomId || !id || !kind || x === null || y === null) {
    return null;
  }

  const shape: CanvasShape = {
    roomId,
    id,
    kind,
    x,
    y
  };

  const width = normalizeNumber(value.width);
  const height = normalizeNumber(value.height);
  const radius = normalizeNumber(value.radius);

  if (width !== null) {
    shape.width = width;
  }
  if (height !== null) {
    shape.height = height;
  }
  if (radius !== null) {
    shape.radius = radius;
  }
  if (typeof value.fill === "string") {
    shape.fill = value.fill;
  }

  return shape;
}

function readPassword(value: unknown) {
  if (!isRecord(value) || typeof value.password !== "string") {
    return "";
  }
  return value.password.trim();
}

function readRoomPasswordPayload(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.roomId !== "string" ||
    typeof value.password !== "string"
  ) {
    return null;
  }

  return {
    roomId: value.roomId.trim(),
    password: value.password.trim()
  };
}

function readRoomId(value: unknown) {
  if (!isRecord(value) || typeof value.roomId !== "string") {
    return "";
  }
  return value.roomId.trim();
}

function readProjectId(value: unknown) {
  if (!isRecord(value) || typeof value.projectId !== "string") {
    return "";
  }
  return value.projectId.trim();
}

function readSocketRoomId(client: Socket) {
  return typeof client.data.canvasRoomId === "string"
    ? client.data.canvasRoomId
    : "";
}

function readSocketProjectId(client: Socket) {
  return typeof client.data.projectId === "string"
    ? client.data.projectId
    : "";
}

function readSocketSessionId(client: Socket): string | null {
  const cookieHeader = firstHeader(client.handshake.headers.cookie);
  const signedValue = readCookieValue(cookieHeader, authSessionCookieName);
  if (!signedValue) {
    return null;
  }

  const unsigned = cookieParser.signedCookie(
    signedValue,
    orbitConfig.COOKIE_SECRET
  );
  return typeof unsigned === "string" && unsigned.length > 0 ? unsigned : null;
}

function readCookieValue(cookieHeader: string, name: string): string {
  const prefix = `${name}=`;
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!pair) {
    return "";
  }

  const value = pair.slice(prefix.length);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function canvasSocketRoomName(roomId: string) {
  return `canvas:${roomId}`;
}

function projectSocketRoomName(projectId: string) {
  return `project:${projectId}`;
}

function emitProjectError(client: Socket, message: string) {
  const payload = {
    event: "project:error",
    data: { message }
  };
  client.emit("project:error", payload.data);
  return payload;
}

function createRoomId() {
  return `room_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function normalizeNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function parseBrowserLabel(userAgent: string) {
  if (userAgent.includes("Edg/")) {
    return "Microsoft Edge";
  }
  if (userAgent.includes("Chrome/")) {
    return "Chrome";
  }
  if (userAgent.includes("Firefox/")) {
    return "Firefox";
  }
  if (userAgent.includes("Safari/") && !userAgent.includes("Chrome/")) {
    return "Safari";
  }
  if (userAgent.includes("curl/")) {
    return "curl";
  }
  return "Unknown client";
}
