import { loadOrbitConfig } from "@orbit/config";
import {
  authResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from "@orbit/shared/auth";
import { createProjectTagDefinitionRequestSchema } from "@orbit/shared/projects";
import type { AuthResponse } from "@orbit/shared/auth";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { authCookieOptions, clearAuthCookieOptions } from "./auth-cookie";
import { authSessionCookieName } from "./auth.constants";
import { AuthService, type AuthResult } from "./auth.service";

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

/** ORBIT-8 인증 API의 HTTP 요청을 검증하고 세션 쿠키를 응답에 연결한다. */
@Controller("api/v1/auth")
export class AuthController {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(private readonly authService: AuthService) {}

  /** 회원가입 요청 본문을 검증한 뒤 새 계정 세션을 HttpOnly 쿠키로 내려준다. */
  @Post("register")
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.authService.register(
      parseAuthRequest(registerRequestSchema, body)
    );
    return this.finishAuthResponse(response, result);
  }

  /** 로그인 요청 본문을 검증한 뒤 기존 계정 세션을 HttpOnly 쿠키로 내려준다. */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.authService.login(
      parseAuthRequest(loginRequestSchema, body)
    );
    return this.finishAuthResponse(response, result);
  }

  /** 현재 쿠키의 세션을 삭제하고 브라우저의 세션 쿠키도 함께 지운다. */
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: SignedCookieRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    await this.authService.logout(getSignedSessionId(request));
    response.clearCookie(
      authSessionCookieName,
      clearAuthCookieOptions(this.config)
    );

    return logoutResponseSchema.parse({ ok: true });
  }

  /** signed cookie에 담긴 세션 id로 현재 로그인 사용자를 조회한다. */
  @Get("me")
  async me(
    @Req() request: SignedCookieRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    const sessionId = getSignedSessionId(request);
    if (!sessionId) {
      response.clearCookie(
        authSessionCookieName,
        clearAuthCookieOptions(this.config)
      );
      throw new UnauthorizedException("Authentication required");
    }

    return this.authService.me(sessionId);
  }

  /** 현재 사용자의 닉네임을 DB와 현재 세션에 함께 반영한다. */
  @Patch("profile")
  async updateProfile(
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseAuthRequest(updateProfileRequestSchema, body);
    const sessionId = requireSignedSessionId(request);
    const session = await this.authService.me(sessionId);
    const user = await this.authService.updateProfile(
      sessionId,
      session.user.userId,
      input
    );
    return authResponseSchema.parse({ user });
  }

  @Get("project-tags")
  async getProjectTags(@Req() request: SignedCookieRequest) {
    const sessionId = requireSignedSessionId(request);
    const session = await this.authService.me(sessionId);
    return this.authService.getProjectTags(session.user.userId);
  }

  @Post("project-tags")
  async createProjectTag(
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseAuthRequest(createProjectTagDefinitionRequestSchema, body);
    const sessionId = requireSignedSessionId(request);
    const session = await this.authService.me(sessionId);
    return this.authService.createProjectTag(session.user.userId, input);
  }

  /** Redis 세션 id를 브라우저에 직접 노출하지 않고 signed HttpOnly cookie로 설정한다. */
  private setSessionCookie(
    response: Response,
    sessionId: string,
    expiresAt: string
  ): void {
    response.cookie(
      authSessionCookieName,
      sessionId,
      authCookieOptions(this.config, expiresAt)
    );
  }

  /** 회원가입/로그인 성공 응답에서 쿠키 설정과 응답 schema 검증을 한 곳에서 처리한다. */
  private finishAuthResponse(
    response: Response,
    result: AuthResult
  ): AuthResponse {
    this.setSessionCookie(response, result.sessionId, result.session.expiresAt);
    return authResponseSchema.parse({ user: result.user });
  }
}

/** 외부 입력 body를 shared 인증 schema로 검증하고 실패 시 400 응답으로 바꾼다. */
function parseAuthRequest<T>(
  schema: z.ZodType<T>,
  body: unknown
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: "Invalid request body",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  return result.data;
}

function requireSignedSessionId(request: SignedCookieRequest): string {
  const sessionId = getSignedSessionId(request);
  if (!sessionId) throw new UnauthorizedException("Authentication required");
  return sessionId;
}

/** cookie-parser가 검증한 signed cookie에서 세션 id만 안전하게 꺼낸다. */
function getSignedSessionId(request: SignedCookieRequest): string | null {
  const value = request.signedCookies?.[authSessionCookieName];
  return typeof value === "string" && value.length > 0 ? value : null;
}
