import {
  authResponseSchema,
  updateOfficialAvatarRequestSchema,
} from "@orbit/shared/auth";
import type { AuthUser } from "@orbit/shared/auth";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { parseRequest } from "../common/zod-request";
import { ProfileAvatarService } from "./profile-avatar.service";

const maxProfileAvatarBytes = 3 * 1024 * 1024;

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

@Controller("api/v1/auth/avatar")
export class ProfileAvatarController {
  constructor(
    private readonly authService: AuthService,
    private readonly profileAvatarService: ProfileAvatarService,
  ) {}

  @Post("official")
  async selectOfficialAvatar(
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const input = parseRequest(updateOfficialAvatarRequestSchema, body ?? {});
    const current = await this.getCurrentUser(request);
    const user = await this.authService.updateAvatar(current.sessionId, current.user.userId, {
      kind: "official",
      avatarId: input.avatarId,
    });
    return authResponseSchema.parse({ user });
  }

  @Put("upload")
  @HttpCode(HttpStatus.OK)
  async uploadAvatar(@Req() request: SignedCookieRequest) {
    const current = await this.getCurrentUser(request);
    const mimeType = request.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    const avatar = await this.profileAvatarService.storeUploadedAvatar(
      current.user.userId,
      mimeType,
      await readAvatarBody(request),
    );
    const user = await this.authService.updateAvatar(
      current.sessionId,
      current.user.userId,
      avatar,
    );
    return authResponseSchema.parse({ user });
  }

  @Get(":fileId")
  async readAvatar(
    @Param("fileId") fileId: string,
    @Req() request: SignedCookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const current = await this.getCurrentUser(request);
    const avatar = await this.profileAvatarService.openUploadedAvatar(current.user.userId, fileId);
    response.setHeader("cache-control", "private, no-cache");
    response.setHeader("content-type", avatar.contentType);
    response.setHeader("content-length", String(avatar.contentLength));
    return new StreamableFile(avatar.body);
  }

  @Get("users/:userId")
  async readCommunityAvatar(
    @Param("userId") userId: string,
    @Req() request: SignedCookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.getCurrentUser(request);
    const avatar = await this.profileAvatarService.openCommunityAvatar(userId);
    response.setHeader("cache-control", "private, max-age=300");
    response.setHeader("content-type", avatar.contentType);
    response.setHeader("content-length", String(avatar.contentLength));
    return new StreamableFile(avatar.body);
  }

  private async getCurrentUser(request: SignedCookieRequest): Promise<{ sessionId: string; user: AuthUser }> {
    const sessionId = getSignedSessionId(request);
    if (!sessionId) throw new UnauthorizedException("Authentication required");
    return { sessionId, user: (await this.authService.me(sessionId)).user };
  }
}

function getSignedSessionId(request: SignedCookieRequest): string | null {
  const value = request.signedCookies?.[authSessionCookieName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readAvatarBody(request: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxProfileAvatarBytes) {
      throw new BadRequestException("Profile image must be 3MiB or smaller.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
