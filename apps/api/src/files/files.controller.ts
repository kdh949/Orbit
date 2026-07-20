import {
  assetUploadUrlRequestSchema,
  completeAssetUploadRequestSchema,
} from "@orbit/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
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
import { normalizeHttpOrigin } from "../common/web-origin";
import { parseRequest } from "../common/zod-request";
import { ProjectsService } from "../projects/projects.service";
import { FilesService } from "./files.service";

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

@Controller("api/v1/projects/:projectId/assets")
export class FilesController {
  constructor(
    private readonly authService: AuthService,
    private readonly filesService: FilesService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  async listFiles(
    @Param("projectId") projectId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.filesService.list(projectId);
  }

  @Post("upload-url")
  async createUploadUrl(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const input = parseRequest(assetUploadUrlRequestSchema, body ?? {});
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.filesService.createUploadUrl(
      projectId,
      input,
      normalizeHttpOrigin(request.get("origin")),
    );
  }

  @Post("complete")
  async completeUpload(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const input = parseRequest(completeAssetUploadRequestSchema, body ?? {});
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.filesService.completeUpload(projectId, input);
  }

  @Get(":fileId/content")
  async readContent(
    @Param("projectId") projectId: string,
    @Param("fileId") fileId: string,
    @Req() request: SignedCookieRequest,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    const asset = await this.filesService.openUploadedAssetContent(
      projectId,
      fileId,
      ifNoneMatch,
    );

    response.setHeader("cache-control", asset.cacheControl);
    response.setHeader("etag", asset.etag);

    if (asset.status === "not-modified") {
      response.status(304).end();
      return;
    }

    response.setHeader("content-type", asset.contentType);
    response.setHeader("content-length", String(asset.contentLength));
    return new StreamableFile(asset.body);
  }

  @Delete(":fileId")
  async deleteFile(
    @Param("projectId") projectId: string,
    @Param("fileId") fileId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return {
      fileId,
      deletedAt: await this.filesService.deleteUploadedAsset(projectId, fileId),
    };
  }

  // local upload proxy가 받은 파일 binary를 서비스 계층 저장 흐름으로 넘긴다.
  @Put(":fileId/content")
  @HttpCode(204)
  async uploadContent(
    @Param("projectId") projectId: string,
    @Param("fileId") fileId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    await this.filesService.storeUploadContent(
      projectId,
      fileId,
      await readRequestBody(request),
    );
  }

  private async getCurrentUser(request: SignedCookieRequest) {
    const sessionId = getSignedSessionId(request);
    if (!sessionId) {
      throw new UnauthorizedException("Authentication required");
    }

    return (await this.authService.me(sessionId)).user;
  }
}

function getSignedSessionId(request: SignedCookieRequest): string | null {
  const value = request.signedCookies?.[authSessionCookieName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Express request stream에서 파일 binary를 하나의 Buffer로 모은다.
async function readRequestBody(request: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
