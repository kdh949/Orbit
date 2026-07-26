import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { duplicateSavedDesignPackRequestSchema } from "@orbit/shared/deck";
import { AuthService } from "../auth/auth.service";
import { getCurrentUser, type SignedCookieRequest } from "../auth/current-user";
import { parseRequest } from "../common/zod-request";
import { SavedDesignPacksService } from "./saved-design-packs.service";

@Controller("api/v1/design-packs")
export class SavedDesignPacksController {
  constructor(
    private readonly authService: AuthService,
    private readonly service: SavedDesignPacksService
  ) {}

  @Get()
  async list(@Req() request: SignedCookieRequest) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.list(user.userId);
  }

  @Get(":packId")
  async get(@Param("packId") packId: string, @Req() request: SignedCookieRequest) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.get(packId, user.userId);
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: SignedCookieRequest) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.create(user.userId, body);
  }

  @Patch(":packId")
  async update(
    @Param("packId") packId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.update(packId, user.userId, body);
  }

  @Post(":packId/duplicate")
  async duplicate(
    @Param("packId") packId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseRequest(duplicateSavedDesignPackRequestSchema, body ?? {});
    const user = await getCurrentUser(this.authService, request);
    return this.service.duplicate(packId, user.userId, input.name);
  }

  @Post(":packId/default")
  async setDefault(
    @Param("packId") packId: string,
    @Req() request: SignedCookieRequest
  ) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.setDefault(packId, user.userId);
  }

  @Delete(":packId")
  async delete(
    @Param("packId") packId: string,
    @Req() request: SignedCookieRequest
  ) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.delete(packId, user.userId);
  }
}
