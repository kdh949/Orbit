import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";

import { AuthService } from "../auth/auth.service";
import {
  getCurrentUser,
  type SignedCookieRequest,
} from "../auth/current-user";
import { OoxmlReferenceTemplatesService } from "./ooxml-reference-templates.service";

@Controller("api/v1/ooxml-reference-templates")
export class OoxmlReferenceTemplatesController {
  constructor(
    private readonly authService: AuthService,
    private readonly templatesService: OoxmlReferenceTemplatesService,
  ) {}

  @Get()
  async listOptions(@Req() request: SignedCookieRequest) {
    await getCurrentUser(this.authService, request);
    return this.templatesService.listOptions();
  }

  @Get(":templateId/versions/:version/previews/:assetId")
  async readPreview(
    @Param("templateId") templateId: string,
    @Param("version") version: string,
    @Param("assetId") assetId: string,
    @Req() request: SignedCookieRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    await getCurrentUser(this.authService, request);
    const preview = await this.templatesService.readPreview(
      templateId,
      version,
      assetId,
    );
    response.setHeader("content-type", preview.contentType);
    response.setHeader("cache-control", "private, max-age=300");
    response.setHeader("x-content-type-options", "nosniff");
    return new StreamableFile(Buffer.from(preview.body));
  }
}
