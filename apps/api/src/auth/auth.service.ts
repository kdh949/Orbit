import { randomUUID } from "node:crypto";
import {
  authResponseSchema,
  authSessionSchema,
  authUserSchema,
  loginRequestSchema,
  meResponseSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from "@orbit/shared/auth";
import {
  createProjectTagDefinitionRequestSchema,
  projectTagDefinitionsResponseSchema,
} from "@orbit/shared/projects";
import type {
  AuthResponse,
  AuthAvatar,
  AuthSession,
  AuthUser,
  LoginRequest,
  MeResponse,
  OfficialAvatarId,
  RegisterRequest,
  UpdateProfileRequest,
} from "@orbit/shared/auth";
import type {
  CreateProjectTagDefinitionRequest,
  ProjectTagDefinitionsResponse,
} from "@orbit/shared/projects";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { DataSource } from "typeorm";
import { authSessionTtlSeconds } from "./auth.constants";
import { AUTH_SESSION_STORE, AuthSessionStore } from "./auth-session.store";

type UserRow = {
  user_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  avatar_type: "official" | "uploaded" | null;
  avatar_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type UserProjectTagsRow = {
  project_tags: unknown;
};

export interface AuthResult extends AuthResponse {
  session: AuthSession;
  sessionId: string;
}

/** ORBIT-8 인증의 계정 생성, 비밀번호 검증, Redis 세션 생성을 담당한다. */
@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AUTH_SESSION_STORE)
    private readonly sessions: AuthSessionStore,
    @Optional()
    @InjectPinoLogger(AuthService.name)
    private readonly logger?: PinoLogger
  ) {}

  async getProjectTags(userId: string): Promise<ProjectTagDefinitionsResponse> {
    const rows = await this.dataSource.query<UserProjectTagsRow[]>(
      `SELECT project_tags FROM users WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (!rows[0]) {
      throw new UnauthorizedException("Authentication required");
    }
    return projectTagDefinitionsResponseSchema.parse({ tags: rows[0].project_tags });
  }

  async createProjectTag(
    userId: string,
    input: CreateProjectTagDefinitionRequest
  ): Promise<ProjectTagDefinitionsResponse> {
    const tag = createProjectTagDefinitionRequestSchema.parse(input);
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<UserProjectTagsRow[]>(
        `SELECT project_tags FROM users WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );
      if (!rows[0]) {
        throw new UnauthorizedException("Authentication required");
      }
      const current = projectTagDefinitionsResponseSchema.parse({
        tags: rows[0].project_tags,
      }).tags;
      if (current.some((item) => item.name.toLocaleLowerCase() === tag.name.toLocaleLowerCase())) {
        throw new ConflictException("Project tag name already exists");
      }
      if (current.length >= 12) {
        throw new BadRequestException("Project tags cannot exceed 12");
      }
      const tags = [...current, tag];
      await manager.query(
        `UPDATE users SET project_tags = $2::jsonb, updated_at = now() WHERE user_id = $1`,
        [userId, JSON.stringify(tags)]
      );
      this.logger?.info(
        { event: "user.project_tag_created", userId, tagName: tag.name, tagColor: tag.color },
        "User project tag created."
      );
      return projectTagDefinitionsResponseSchema.parse({ tags });
    });
  }

  /** 이메일/비밀번호를 정규화하고 Argon2id hash만 저장한 뒤 새 세션을 만든다. */
  async register(input: RegisterRequest): Promise<AuthResult> {
    const credentials = registerRequestSchema.parse(input);
    const existingUser = await this.findUserByEmail(credentials.email);
    if (existingUser) {
      throw new ConflictException("Email already registered");
    }

    const now = new Date();
    const passwordHash = await argon2.hash(credentials.password, {
      type: argon2.argon2id
    });

    try {
      const rows = await this.dataSource.query<UserRow[]>(
        `
          INSERT INTO users (user_id, email, display_name, password_hash, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $5)
          RETURNING user_id, email, display_name, password_hash, avatar_type, avatar_id, created_at, updated_at
        `,
        [
          `user_${randomUUID()}`,
          credentials.email,
          credentials.displayName,
          passwordHash,
          now
        ]
      );

      return this.createSession(this.toAuthUser(rows[0]));
    } catch (error: unknown) {
      const constraint = getPostgresUniqueConstraint(error);
      if (constraint === "uq_users_display_name_normalized") {
        throw new ConflictException("Nickname already in use");
      }
      if (constraint || isPostgresUniqueViolation(error)) {
        throw new ConflictException("Email already registered");
      }

      throw error;
    }
  }

  /** 저장된 Argon2id hash와 입력 비밀번호를 비교해 로그인 세션을 만든다. */
  async login(input: LoginRequest): Promise<AuthResult> {
    const credentials = loginRequestSchema.parse(input);
    const user = await this.findUserByEmail(credentials.email);
    if (!user) {
      throw invalidCredentials();
    }

    const passwordMatches = await argon2.verify(
      user.password_hash,
      credentials.password
    );
    if (!passwordMatches) {
      throw invalidCredentials();
    }

    return this.createSession(this.toAuthUser(user));
  }

  /** Redis에 저장된 세션을 조회하고 만료된 세션은 즉시 삭제한다. */
  async me(sessionId: string): Promise<MeResponse> {
    const session = await this.sessions.get(sessionId);
    if (!session) {
      throw new UnauthorizedException("Authentication required");
    }

    if (isExpired(session)) {
      await this.sessions.delete(sessionId);
      throw new UnauthorizedException("Authentication required");
    }

    return meResponseSchema.parse(session);
  }

  /** 로그아웃 요청은 세션이 없어도 성공으로 보고 남아 있는 Redis 세션만 삭제한다. */
  async logout(sessionId: string | null): Promise<void> {
    if (sessionId) {
      await this.sessions.delete(sessionId);
    }
  }

  /** 현재 세션의 사용자 아바타 선택을 DB와 Redis 세션에 함께 반영한다. */
  async updateAvatar(
    sessionId: string,
    userId: string,
    avatar: AuthAvatar
  ): Promise<AuthUser> {
    const avatarId = avatar.kind === "official" ? avatar.avatarId : avatar.fileId;
    await this.dataSource.query(
      `
        UPDATE users
        SET avatar_type = $2, avatar_id = $3, updated_at = now()
        WHERE user_id = $1
      `,
      [userId, avatar.kind, avatarId]
    );
    const userRow = await this.findUserById(userId);
    if (!userRow) {
      throw new UnauthorizedException("Authentication required");
    }
    const user = this.toAuthUser(userRow);
    await this.refreshCurrentSession(sessionId, userId, user);
    return user;
  }

  /** 닉네임 변경을 영속화하고 현재 브라우저의 세션 사용자 정보도 갱신한다. */
  async updateProfile(
    sessionId: string,
    userId: string,
    input: UpdateProfileRequest
  ): Promise<AuthUser> {
    const profile = updateProfileRequestSchema.parse(input);
    try {
      await this.dataSource.query(
        `UPDATE users
         SET display_name = $2, updated_at = now()
         WHERE user_id = $1`,
        [userId, profile.displayName]
      );
    } catch (error: unknown) {
      if (getPostgresUniqueConstraint(error) === "uq_users_display_name_normalized") {
        throw new ConflictException("Nickname already in use");
      }
      throw error;
    }

    const userRow = await this.findUserById(userId);
    if (!userRow) {
      throw new UnauthorizedException("Authentication required");
    }
    const user = this.toAuthUser(userRow);
    await this.refreshCurrentSession(sessionId, userId, user);
    this.logger?.info(
      { event: "user.profile_updated", userId },
      "User profile updated."
    );
    return user;
  }

  /** 인증 성공 시 7일 TTL의 session payload를 만들고 session id와 함께 반환한다. */
  private async createSession(user: AuthUser): Promise<AuthResult> {
    const authenticatedAt = new Date();
    const expiresAt = new Date(
      authenticatedAt.getTime() + authSessionTtlSeconds * 1000
    );
    const session = authSessionSchema.parse({
      user,
      authenticatedAt: authenticatedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    const sessionId = `session_${randomUUID()}`;

    await this.sessions.set(sessionId, session, authSessionTtlSeconds);

    return {
      ...authResponseSchema.parse({ user }),
      session,
      sessionId
    };
  }

  /** email 대소문자 차이를 무시하고 기존 사용자를 찾는다. */
  private async findUserByEmail(email: string): Promise<UserRow | undefined> {
    const rows = await this.dataSource.query<UserRow[]>(
      `
        SELECT user_id, email, display_name, password_hash, avatar_type, avatar_id, created_at, updated_at
        FROM users
        WHERE lower(email) = lower($1)
      `,
      [email]
    );

    return rows[0];
  }

  private async findUserById(userId: string): Promise<UserRow | undefined> {
    const rows = await this.dataSource.query<UserRow[]>(
      `
        SELECT user_id, email, display_name, password_hash, avatar_type, avatar_id, created_at, updated_at
        FROM users
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId]
    );

    return rows[0];
  }

  /** DB row의 snake_case 필드를 외부 응답용 auth user 계약으로 변환한다. */
  private toAuthUser(row: UserRow): AuthUser {
    return authUserSchema.parse({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      createdAt: toIso(row.created_at),
      avatar: toAuthAvatar(row),
    });
  }

  private async refreshCurrentSession(
    sessionId: string,
    userId: string,
    user: AuthUser
  ): Promise<void> {
    const session = await this.sessions.get(sessionId);
    if (session?.user.userId !== userId) return;

    const remainingTtlSeconds = Math.ceil(
      (new Date(session.expiresAt).getTime() - Date.now()) / 1000
    );
    if (remainingTtlSeconds > 0) {
      await this.sessions.set(sessionId, { ...session, user }, remainingTtlSeconds);
    }
  }
}

function toAuthAvatar(row: UserRow): AuthAvatar | null {
  if (row.avatar_type === "official" && row.avatar_id) {
    return { kind: "official", avatarId: row.avatar_id as OfficialAvatarId };
  }
  if (row.avatar_type === "uploaded" && row.avatar_id) {
    return { kind: "uploaded", fileId: row.avatar_id };
  }
  return null;
}

/** 가입 여부를 드러내지 않는 공통 로그인 실패 예외를 만든다. */
function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException("Invalid email or password");
}

/** Postgres unique index 충돌을 회원가입 중복 이메일 오류로 해석한다. */
function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function getPostgresUniqueConstraint(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "23505" ||
    !("constraint" in error)
  ) {
    return null;
  }
  return typeof error.constraint === "string" ? error.constraint : null;
}

/** TypeORM query 결과의 날짜 타입 차이를 ISO 문자열로 통일한다. */
function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/** 세션의 expiresAt이 현재 시각을 지났는지 확인한다. */
function isExpired(session: AuthSession): boolean {
  return new Date(session.expiresAt).getTime() <= Date.now();
}
