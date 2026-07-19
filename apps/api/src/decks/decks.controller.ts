import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { ProjectsService } from "../projects/projects.service";
import { DecksService } from "./decks.service";

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

@Controller("api/v1/projects/:projectId")
export class DecksController {
  constructor(
    private readonly authService: AuthService,
    private readonly decksService: DecksService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get("deck")
  async getDeck(
    @Param("projectId") projectId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.decksService.getDeck(projectId);
  }

  @Put("deck")
  async putDeck(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.decksService.putDeck(projectId, body);
  }

  @Get("deck/import-quality")
  async getPptxImportQuality(
    @Param("projectId") projectId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.decksService.getPptxImportQuality(projectId);
  }

  @Post("deck/patches")
  async appendPatch(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.decksService.appendPatch(projectId, body);
  }

  @Post("deck/exports")
  async createExport(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.decksService.createExportJob(projectId, body);
  }

  @Get("deck/ooxml-sync-state")
  async getOoxmlSyncState(
    @Param("projectId") projectId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.decksService.getOoxmlSyncState(projectId);
  }

  @Post("deck/ooxml-sync/retry")
  async retryOoxmlSync(
    @Param("projectId") projectId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.decksService.retryOoxmlSync(projectId);
  }

  @Post("deck/semantic-cues")
  async createSemanticCueExtractionJob(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.decksService.createSemanticCueExtractionJob(projectId, body);
  }

  @Post("deck/speaker-notes/suggestions")
  async createSpeakerNotesSuggestionJob(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.decksService.createSpeakerNotesSuggestionJob(projectId, body);
  }

  @Get("snapshots")
  async listSnapshots(
    @Param("projectId") projectId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.decksService.listSnapshots(projectId);
  }

  @Post("snapshots/:snapshotId/restore")
  async restoreSnapshot(
    @Param("projectId") projectId: string,
    @Param("snapshotId") snapshotId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.decksService.restoreSnapshot(projectId, snapshotId);
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
