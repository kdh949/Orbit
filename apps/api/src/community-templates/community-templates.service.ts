import { randomUUID } from "node:crypto";
import {
  CommunityTemplateSanitizationError,
  materializeCommunityTemplate,
  sanitizeCommunityTemplate,
} from "@orbit/editor-core/community-templates";
import {
  communityTemplateApiErrorCodeSchema,
  communityTemplateApiErrorSchema,
  communityTemplateCardSchema,
  communityTemplateCategoryListResponseSchema,
  communityTemplateCommentListResponseSchema,
  communityTemplateCommentResponseSchema,
  communityTemplateDetailSchema,
  communityTemplateDiscoverCardSchema,
  communityTemplateDiscoverResponseSchema,
  communityTemplateEngagementResponseSchema,
  communityTemplateIdSchema,
  communityTemplateListResponseSchema,
  communityTemplateModerationListResponseSchema,
  communityTemplateReportSchema,
  communityTemplatePreviewSchema,
  communityTemplateRecentResponseSchema,
  communityTemplateSnapshotSchema,
  communityTemplateSourceListResponseSchema,
  communityTemplateTagIdSchema,
  communityTemplateTagListResponseSchema,
  createCommunityTemplateReportResponseSchema,
  publishCommunityTemplateRequestSchema,
  publishCommunityTemplateResponseSchema,
  unpublishCommunityTemplateResponseSchema,
  updateCommunityTemplateReportResponseSchema,
  updateCommunityTemplateResponseSchema,
  useCommunityTemplateRequestSchema,
  useCommunityTemplateResponseSchema,
} from "@orbit/shared/community-templates";
import type {
  CommunityTemplateApiErrorCode,
  CommunityTemplateCard,
  CommunityTemplateCategory,
  CommunityTemplateCommentListQuery,
  CommunityTemplateDiscoverQuery,
  CommunityTemplateListQuery,
  CommunityTemplateModerationQuery,
  CommunityTemplateTagListQuery,
  CreateCommunityTemplateReportRequest,
  PublishCommunityTemplateRequest,
  UpdateCommunityTemplateReportRequest,
  UpdateCommunityTemplateRequest,
  UseCommunityTemplateRequest,
  UseCommunityTemplateResponse,
} from "@orbit/shared/community-templates";
import {
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { DataSource, EntityManager } from "typeorm";

import { DecksService } from "../decks/decks.service";
import { ProjectsService } from "../projects/projects.service";

type PublicTemplateRow = {
  template_id: string;
  title: string;
  category: CommunityTemplateCategory;
  preview_json: unknown;
  created_at: Date | string;
};

type StoredTemplateRow = PublicTemplateRow & {
  snapshot_json: unknown;
  source_deck_version: number;
};

type SourceProjectRow = {
  project_id: string;
  title: string;
  created_at: Date | string;
  already_published: boolean;
};

type ExistingUseRow = {
  template_id: string;
  project_id: string;
  workspace_id: string;
  title: string;
  created_by: string;
  created_at: Date | string;
  deck_id: string;
};

type UseTransactionResult = {
  response: UseCommunityTemplateResponse;
  category?: CommunityTemplateCategory;
  slideCount?: number;
  idempotent: boolean;
};

type CommunityDiscoverRow = PublicTemplateRow & {
  category_name: string;
  tags: unknown;
  description: string;
  snapshot_json?: unknown;
  owner_user_id: string;
  display_name: string;
  avatar_type: "official" | "uploaded" | null;
  avatar_id: string | null;
  like_count: number;
  view_count: number;
  share_count: number;
  comment_count: number;
  use_count: number;
  liked_by_me: boolean;
};

type CommunityCommentRow = {
  comment_id: string;
  template_id: string;
  author_user_id: string;
  display_name: string;
  avatar_type: "official" | "uploaded" | null;
  avatar_id: string | null;
  body: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type CommunityReportRow = PublicTemplateRow & {
  report_id: string;
  reporter_user_id: string;
  reporter_display_name: string;
  reporter_avatar_type: "official" | "uploaded" | null;
  reporter_avatar_id: string | null;
  reason: CreateCommunityTemplateReportRequest["reason"];
  details: string;
  status: UpdateCommunityTemplateReportRequest["status"];
  resolution_note: string | null;
  report_created_at: Date | string;
  report_updated_at: Date | string;
};

@Injectable()
export class CommunityTemplatesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly projectsService: ProjectsService,
    private readonly decksService: DecksService,
    @Optional()
    @InjectPinoLogger(CommunityTemplatesService.name)
    private readonly logger?: PinoLogger,
  ) {}

  async listCategories() {
    const rows = await this.dataSource.query<
      Array<{ category_id: CommunityTemplateCategory; name: string }>
    >(
      `
        SELECT category_id, name
        FROM community_categories
        WHERE active = true
        ORDER BY sort_order ASC
      `,
    );
    return communityTemplateCategoryListResponseSchema.parse({
      items: rows.map((row) => ({
        categoryId: row.category_id,
        name: row.name,
      })),
    });
  }

  async listTags(query: CommunityTemplateTagListQuery) {
    const rows = await this.dataSource.query<
      Array<{ tag_id: string; name: string; usage_count: number }>
    >(
      `
        SELECT
          tags.tag_id,
          tags.name,
          COUNT(DISTINCT CASE
            WHEN templates.deleted_at IS NULL THEN links.template_id
          END)::int AS usage_count
        FROM community_tags tags
        LEFT JOIN community_template_tags links ON links.tag_id = tags.tag_id
        LEFT JOIN community_templates templates
          ON templates.template_id = links.template_id
        WHERE ($1::text IS NULL OR tags.name ILIKE '%' || $1 || '%')
        GROUP BY tags.tag_id, tags.name
        HAVING (
          $2::text = 'all'
          OR COUNT(DISTINCT CASE
            WHEN templates.deleted_at IS NULL THEN links.template_id
          END) > 0
        )
        ORDER BY
          CASE WHEN $3::text = 'popular' THEN COUNT(DISTINCT CASE
            WHEN templates.deleted_at IS NULL THEN links.template_id
          END) END DESC,
          lower(tags.name) ASC
        LIMIT $4
      `,
      [query.query ?? null, query.scope, query.sort, query.limit],
    );
    return communityTemplateTagListResponseSchema.parse({
      items: rows.map((row) => ({
        tagId: row.tag_id,
        name: row.name,
        usageCount: Number(row.usage_count),
      })),
    });
  }

  async list(query: CommunityTemplateListQuery) {
    try {
      const offset = (query.page - 1) * query.limit;
      const rows = await this.dataSource.query<PublicTemplateRow[]>(
        `
          SELECT template_id, title, category_id AS category, preview_json, created_at
          FROM community_templates
          WHERE deleted_at IS NULL
            AND ($1::text IS NULL OR title ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR category_id = $2)
          ORDER BY created_at DESC, template_id DESC
          LIMIT $3 OFFSET $4
        `,
        [
          query.query ?? null,
          query.categoryId ?? query.category ?? null,
          query.limit + 1,
          offset,
        ],
      );
      const hasMore = rows.length > query.limit;
      return communityTemplateListResponseSchema.parse({
        items: this.parsePublicCards(rows.slice(0, query.limit)),
        page: query.page,
        hasMore,
      });
    } catch (error) {
      throw toCommunityTemplateException(error, "read");
    }
  }

  async listRecent(userId: string) {
    try {
      const rows = await this.dataSource.query<PublicTemplateRow[]>(
        `
          SELECT
            community_templates.template_id,
            community_templates.title,
            community_templates.category_id AS category,
            community_templates.preview_json,
            community_templates.created_at
          FROM community_template_usages
          INNER JOIN community_templates
            ON community_templates.template_id = community_template_usages.template_id
          WHERE community_template_usages.user_id = $1
            AND community_templates.deleted_at IS NULL
          ORDER BY community_template_usages.last_used_at DESC
          LIMIT 4
        `,
        [userId],
      );
      return communityTemplateRecentResponseSchema.parse({
        items: this.parsePublicCards(rows).slice(0, 4),
      });
    } catch (error) {
      throw toCommunityTemplateException(error, "read");
    }
  }

  async listSources(workspaceId: string, userId: string) {
    try {
      const rows = await this.dataSource.query<SourceProjectRow[]>(
        `
          SELECT
            projects.project_id,
            projects.title,
            projects.created_at,
            EXISTS(
              SELECT 1
              FROM community_templates templates
              WHERE templates.source_project_id = projects.project_id
                AND templates.deleted_at IS NULL
            ) AS already_published
          FROM projects
          INNER JOIN project_members
            ON project_members.project_id = projects.project_id
          WHERE projects.workspace_id = $1
            AND project_members.user_id = $2
            AND project_members.role = 'owner'
            AND project_members.status = 'accepted'
          ORDER BY projects.created_at DESC, projects.project_id DESC
        `,
        [workspaceId, userId],
      );
      const items = await Promise.all(
        rows.map(async (row) => {
          let unavailableReason:
            | "ALREADY_PUBLISHED"
            | "SOURCE_DECK_NOT_FOUND"
            | "ACTIVITY_UNSUPPORTED"
            | "SANITIZATION_FAILED"
            | "SNAPSHOT_TOO_LARGE"
            | null = row.already_published ? "ALREADY_PUBLISHED" : null;
          if (!unavailableReason) {
            try {
              const { deck } = await this.decksService.getDeck(row.project_id);
              sanitizeCommunityTemplate(deck);
            } catch (error) {
              if (error instanceof NotFoundException) {
                unavailableReason = "SOURCE_DECK_NOT_FOUND";
              } else if (error instanceof CommunityTemplateSanitizationError) {
                unavailableReason =
                  error.code === "COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED"
                    ? "ACTIVITY_UNSUPPORTED"
                    : error.code === "COMMUNITY_TEMPLATE_SNAPSHOT_TOO_LARGE"
                      ? "SNAPSHOT_TOO_LARGE"
                      : "SANITIZATION_FAILED";
              } else {
                throw error;
              }
            }
          }
          return {
            projectId: row.project_id,
            title: row.title,
            createdAt: toIso(row.created_at),
            publishable: unavailableReason === null,
            unavailableReason,
          };
        }),
      );
      return communityTemplateSourceListResponseSchema.parse({ items });
    } catch (error) {
      throw toCommunityTemplateException(error, "read");
    }
  }

  async publish(
    workspaceId: string,
    input: PublishCommunityTemplateRequest,
    userId: string,
  ) {
    const request = publishCommunityTemplateRequestSchema.parse(input);
    const categoryId = request.categoryId ?? request.category!;
    let templateId: string | undefined;
    try {
      const sourceRows = await this.dataSource.query<
        Array<{ project_id: string }>
      >(
        `
          SELECT project_id
          FROM projects
          WHERE project_id = $1 AND workspace_id = $2
        `,
        [request.sourceProjectId, workspaceId],
      );
      if (!sourceRows[0]) {
        throw communityTemplateException(
          "COMMUNITY_TEMPLATE_SOURCE_NOT_FOUND",
          HttpStatus.NOT_FOUND,
          "공개할 원본 프로젝트를 찾을 수 없습니다.",
        );
      }

      const existingRows = await this.dataSource.query<Array<{ template_id: string }>>(
        `SELECT template_id FROM community_templates WHERE source_project_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [request.sourceProjectId],
      );
      if (existingRows[0]) {
        throw communityTemplateException(
          "COMMUNITY_TEMPLATE_ALREADY_PUBLISHED",
          HttpStatus.CONFLICT,
          "이미 커뮤니티에 공개된 프로젝트입니다.",
        );
      }

      const categoryRows = await this.dataSource.query<
        Array<{ category_id: string }>
      >(
        `SELECT category_id FROM community_categories WHERE category_id = $1 AND active = true`,
        [categoryId],
      );
      if (!categoryRows[0]) {
        throw communityTemplateException(
          "COMMUNITY_TEMPLATE_CATEGORY_NOT_FOUND",
          HttpStatus.BAD_REQUEST,
          "선택한 대표 주제를 사용할 수 없습니다.",
        );
      }

      try {
        await this.projectsService.assertIsProjectOwner(
          request.sourceProjectId,
          userId,
        );
      } catch (error) {
        if (error instanceof ForbiddenException) {
          throw communityTemplateException(
            "COMMUNITY_TEMPLATE_OWNER_REQUIRED",
            HttpStatus.FORBIDDEN,
            "프로젝트 소유자만 템플릿을 공개할 수 있습니다.",
          );
        }
        if (error instanceof NotFoundException) {
          throw communityTemplateException(
            "COMMUNITY_TEMPLATE_SOURCE_NOT_FOUND",
            HttpStatus.NOT_FOUND,
            "공개할 원본 프로젝트를 찾을 수 없습니다.",
          );
        }
        throw error;
      }

      let deck: Awaited<ReturnType<DecksService["getDeck"]>>["deck"];
      try {
        ({ deck } = await this.decksService.getDeck(request.sourceProjectId));
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw communityTemplateException(
            "COMMUNITY_TEMPLATE_SOURCE_NOT_FOUND",
            HttpStatus.NOT_FOUND,
            "공개할 원본 프로젝트를 찾을 수 없습니다.",
          );
        }
        throw error;
      }
      const snapshot = sanitizeCommunityTemplate(deck);
      const preview = communityTemplatePreviewSchema.parse({
        canvas: snapshot.canvas,
        theme: snapshot.theme,
        slide: snapshot.slides[0],
      });
      templateId = communityTemplateIdSchema.parse(
        `community_template_${randomUUID()}`,
      );
      const createdAt = new Date().toISOString();

      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `
          INSERT INTO community_templates (
            template_id,
            owner_user_id,
            source_project_id,
            source_deck_id,
            source_deck_version,
            title,
            category_id,
            description,
            snapshot_json,
            preview_json,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            templateId,
            userId,
            request.sourceProjectId,
            deck.deckId,
            deck.version,
            request.title,
            categoryId,
            request.description ?? "",
            snapshot,
            preview,
            createdAt,
          ],
        );
        if (request.tags.length > 0) {
          await this.replaceTemplateTags(
            manager,
            templateId!,
            request.tags,
            userId,
          );
        }
      });

      const card = communityTemplateCardSchema.parse({
        templateId,
        title: request.title,
        category: categoryId,
        preview,
        createdAt,
      });
      this.logger?.info(
        {
          event: "community_template.published",
          templateId,
          sourceProjectId: request.sourceProjectId,
          sourceDeckId: deck.deckId,
          sourceVersion: deck.version,
          categoryId,
          tagCount: request.tags.length,
          slideCount: snapshot.slides.length,
        },
        "Community template published.",
      );
      return publishCommunityTemplateResponseSchema.parse({ template: card });
    } catch (error) {
      const exception = toCommunityTemplateException(error, "publish");
      this.logger?.error(
        {
          event: "community_template.publish_failed",
          templateId,
          sourceProjectId: request.sourceProjectId,
          workspaceId,
          categoryId,
          errorCode: readCommunityTemplateErrorCode(exception),
        },
        "Community template publish failed.",
      );
      throw exception;
    }
  }

  async use(
    workspaceId: string,
    rawTemplateId: string,
    input: UseCommunityTemplateRequest,
    userId: string,
  ): Promise<UseCommunityTemplateResponse> {
    const request = useCommunityTemplateRequestSchema.parse(input);
    const templateId = communityTemplateIdSchema.parse(rawTemplateId);
    try {
      const result = await this.dataSource.transaction((manager) =>
        this.useInTransaction(
          manager,
          workspaceId,
          templateId,
          request.clientRequestId,
          userId,
        ),
      );
      this.logger?.info(
        {
          event: "community_template.used",
          templateId,
          projectId: result.response.project.projectId,
          deckId: result.response.deckId,
          category: result.category,
          slideCount: result.slideCount,
          idempotent: result.idempotent,
        },
        "Community template used.",
      );
      return result.response;
    } catch (error) {
      const exception = toCommunityTemplateException(error, "use");
      this.logger?.error(
        {
          event: "community_template.use_failed",
          templateId,
          workspaceId,
          userId,
          clientRequestId: request.clientRequestId,
          errorCode: readCommunityTemplateErrorCode(exception),
        },
        "Community template use failed.",
      );
      throw exception;
    }
  }

  async discover(query: CommunityTemplateDiscoverQuery, userId: string) {
    const offset = (query.page - 1) * query.limit;
    const orderBy =
      query.sort === "latest"
        ? "created_at DESC, template_id DESC"
        : query.sort === "views"
          ? "view_count DESC, created_at DESC, template_id DESC"
          : query.sort === "likes"
            ? "like_count DESC, created_at DESC, template_id DESC"
        : query.sort === "recommended"
          ? "((like_count * 3 + comment_count * 2 + use_count * 2 + view_count + share_count * 2) / POWER(EXTRACT(EPOCH FROM (now() - created_at)) / 86400 + 2, 0.45)) DESC, created_at DESC"
          : "(like_count * 3 + comment_count * 2 + use_count * 2 + view_count + share_count * 2) DESC, created_at DESC";
    const rows = await this.dataSource.query<CommunityDiscoverRow[]>(
      `
        WITH community AS (
          SELECT
            templates.template_id,
            templates.title,
            templates.category_id AS category,
            categories.name AS category_name,
            templates.description,
            templates.preview_json,
            templates.created_at,
            templates.owner_user_id,
            users.display_name,
            users.avatar_type,
            users.avatar_id,
            (SELECT COUNT(*)::int FROM community_template_likes likes WHERE likes.template_id = templates.template_id) AS like_count,
            (SELECT COUNT(*)::int FROM community_template_views views WHERE views.template_id = templates.template_id) AS view_count,
            (SELECT COUNT(*)::int FROM community_template_shares shares WHERE shares.template_id = templates.template_id) AS share_count,
            (SELECT COUNT(*)::int FROM community_template_comments comments WHERE comments.template_id = templates.template_id) AS comment_count,
            COALESCE((SELECT SUM(usages.use_count)::int FROM community_template_usages usages WHERE usages.template_id = templates.template_id), 0) AS use_count,
            EXISTS(
              SELECT 1 FROM community_template_likes mine
              WHERE mine.template_id = templates.template_id AND mine.user_id = $4
            ) AS liked_by_me,
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object('tagId', tags.tag_id, 'name', tags.name)
                ORDER BY lower(tags.name)
              )
              FROM community_template_tags template_tags
              INNER JOIN community_tags tags ON tags.tag_id = template_tags.tag_id
              WHERE template_tags.template_id = templates.template_id
            ), '[]'::jsonb) AS tags
          FROM community_templates templates
          INNER JOIN users ON users.user_id = templates.owner_user_id
          INNER JOIN community_categories categories
            ON categories.category_id = templates.category_id
          WHERE ($1::text IS NULL OR templates.title ILIKE '%' || $1 || '%' OR users.display_name ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR templates.category_id = $2)
            AND (
              $3::text[] IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM unnest($3::text[]) requested_tags(tag_id)
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM community_template_tags matched_tags
                  WHERE matched_tags.template_id = templates.template_id
                    AND matched_tags.tag_id = requested_tags.tag_id
                )
              )
            )
            AND templates.deleted_at IS NULL
        )
        SELECT * FROM community
        ORDER BY ${orderBy}
        LIMIT $5 OFFSET $6
      `,
      [
        query.query ?? null,
        query.categoryId ?? query.category ?? null,
        query.tagIds?.length ? query.tagIds : null,
        userId,
        query.limit + 1,
        offset,
      ],
    );
    return communityTemplateDiscoverResponseSchema.parse({
      items: rows.slice(0, query.limit).map((row) => this.toDiscoverCard(row)),
      page: query.page,
      hasMore: rows.length > query.limit,
    });
  }

  async getCommunityDetail(templateId: string, userId: string) {
    const rows = await this.dataSource.query<CommunityDiscoverRow[]>(
      `
        SELECT
          templates.template_id,
          templates.title,
          templates.category_id AS category,
          categories.name AS category_name,
          templates.description,
          templates.preview_json,
          templates.snapshot_json,
          templates.created_at,
          templates.owner_user_id,
          users.display_name,
          users.avatar_type,
          users.avatar_id,
          (SELECT COUNT(*)::int FROM community_template_likes likes WHERE likes.template_id = templates.template_id) AS like_count,
          (SELECT COUNT(*)::int FROM community_template_views views WHERE views.template_id = templates.template_id) AS view_count,
          (SELECT COUNT(*)::int FROM community_template_shares shares WHERE shares.template_id = templates.template_id) AS share_count,
          (SELECT COUNT(*)::int FROM community_template_comments comments WHERE comments.template_id = templates.template_id) AS comment_count,
          COALESCE((SELECT SUM(usages.use_count)::int FROM community_template_usages usages WHERE usages.template_id = templates.template_id), 0) AS use_count,
          EXISTS(
            SELECT 1 FROM community_template_likes mine
            WHERE mine.template_id = templates.template_id AND mine.user_id = $2
          ) AS liked_by_me,
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('tagId', tags.tag_id, 'name', tags.name)
              ORDER BY lower(tags.name)
            )
            FROM community_template_tags template_tags
            INNER JOIN community_tags tags ON tags.tag_id = template_tags.tag_id
            WHERE template_tags.template_id = templates.template_id
          ), '[]'::jsonb) AS tags
        FROM community_templates templates
        INNER JOIN users ON users.user_id = templates.owner_user_id
        INNER JOIN community_categories categories
          ON categories.category_id = templates.category_id
        WHERE templates.template_id = $1
          AND templates.deleted_at IS NULL
      `,
      [templateId, userId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException("커뮤니티 템플릿을 찾을 수 없습니다.");
    return communityTemplateDetailSchema.parse({
      ...this.toDiscoverCard(row),
      snapshot: row.snapshot_json,
      ownedByMe: row.owner_user_id === userId,
    });
  }

  async setLike(templateId: string, userId: string, liked: boolean) {
    await this.assertCommunityTemplateExists(templateId);
    if (liked) {
      await this.dataSource.query(
        `INSERT INTO community_template_likes (template_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [templateId, userId],
      );
    } else {
      await this.dataSource.query(
        `DELETE FROM community_template_likes WHERE template_id = $1 AND user_id = $2`,
        [templateId, userId],
      );
    }
    this.logger?.info(
      { event: liked ? "community_template.liked" : "community_template.unliked", templateId, userId },
      "Community template like state changed.",
    );
    return this.readEngagement(templateId, userId);
  }

  async listMine(query: CommunityTemplateDiscoverQuery, userId: string) {
    const rows = await this.dataSource.query<CommunityDiscoverRow[]>(
      `
        SELECT
          templates.template_id, templates.title, templates.category_id AS category,
          categories.name AS category_name,
          templates.description, templates.preview_json, templates.created_at,
          templates.owner_user_id, users.display_name, users.avatar_type, users.avatar_id,
          (SELECT COUNT(*)::int FROM community_template_likes WHERE template_id = templates.template_id) AS like_count,
          (SELECT COUNT(*)::int FROM community_template_views WHERE template_id = templates.template_id) AS view_count,
          (SELECT COUNT(*)::int FROM community_template_shares WHERE template_id = templates.template_id) AS share_count,
          (SELECT COUNT(*)::int FROM community_template_comments WHERE template_id = templates.template_id) AS comment_count,
          COALESCE((SELECT SUM(use_count)::int FROM community_template_usages WHERE template_id = templates.template_id), 0) AS use_count,
          EXISTS(SELECT 1 FROM community_template_likes WHERE template_id = templates.template_id AND user_id = $2) AS liked_by_me,
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('tagId', tags.tag_id, 'name', tags.name)
              ORDER BY lower(tags.name)
            )
            FROM community_template_tags template_tags
            INNER JOIN community_tags tags ON tags.tag_id = template_tags.tag_id
            WHERE template_tags.template_id = templates.template_id
          ), '[]'::jsonb) AS tags
        FROM community_templates templates
        INNER JOIN users ON users.user_id = templates.owner_user_id
        INNER JOIN community_categories categories
          ON categories.category_id = templates.category_id
        WHERE templates.owner_user_id = $2
          AND templates.deleted_at IS NULL
          AND ($1::text IS NULL OR templates.title ILIKE '%' || $1 || '%')
        ORDER BY templates.created_at DESC, templates.template_id DESC
        LIMIT $3 OFFSET $4
      `,
      [query.query ?? null, userId, query.limit + 1, (query.page - 1) * query.limit],
    );
    return communityTemplateDiscoverResponseSchema.parse({
      items: rows.slice(0, query.limit).map((row) => this.toDiscoverCard(row)),
      page: query.page,
      hasMore: rows.length > query.limit,
    });
  }

  async updateTemplate(
    templateId: string,
    input: UpdateCommunityTemplateRequest,
    userId: string,
  ) {
    const categoryId = input.categoryId ?? input.category;
    if (categoryId) {
      const categories = await this.dataSource.query<Array<{ category_id: string }>>(
        `SELECT category_id FROM community_categories WHERE category_id = $1 AND active = true`,
        [categoryId],
      );
      if (!categories[0]) {
        throw communityTemplateException(
          "COMMUNITY_TEMPLATE_CATEGORY_NOT_FOUND",
          HttpStatus.BAD_REQUEST,
          "선택한 대표 주제를 사용할 수 없습니다.",
        );
      }
    }
    const rows = await this.dataSource.query<
      Array<{
        template_id: string;
        title: string;
        category: CommunityTemplateCategory;
        description: string;
        updated_at: Date | string;
      }>
    >(
      `
        UPDATE community_templates
        SET
          title = COALESCE($3, title),
          category_id = COALESCE($4, category_id),
          description = COALESCE($5, description),
          updated_at = now()
        WHERE template_id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
        RETURNING template_id, title, category_id AS category, description, updated_at
      `,
      [templateId, userId, input.title ?? null, categoryId ?? null, input.description ?? null],
    );
    if (!rows[0]) await this.throwTemplateOwnerError(templateId, userId);
    if (input.tags !== undefined) {
      await this.dataSource.transaction((manager) =>
        this.replaceTemplateTags(manager, templateId, input.tags!, userId),
      );
    }
    const row = rows[0]!;
    this.logger?.info(
      { event: "community_template.metadata_updated", templateId, userId },
      "Community template metadata updated.",
    );
    return updateCommunityTemplateResponseSchema.parse({
      templateId: row.template_id,
      title: row.title,
      category: row.category,
      description: row.description,
      updatedAt: toIso(row.updated_at),
    });
  }

  async unpublishTemplate(templateId: string, userId: string) {
    const rows = await this.dataSource.query<Array<{ template_id: string }>>(
      `
        UPDATE community_templates
        SET deleted_at = now(), deleted_by_user_id = $2, updated_at = now()
        WHERE template_id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
        RETURNING template_id
      `,
      [templateId, userId],
    );
    if (!rows[0]) await this.throwTemplateOwnerError(templateId, userId);
    this.logger?.info(
      { event: "community_template.unpublished", templateId, userId },
      "Community template unpublished.",
    );
    return unpublishCommunityTemplateResponseSchema.parse({ templateId, unpublished: true });
  }

  async createReport(
    templateId: string,
    input: CreateCommunityTemplateReportRequest,
    userId: string,
  ) {
    const ownerRows = await this.dataSource.query<Array<{ owner_user_id: string }>>(
      `SELECT owner_user_id FROM community_templates WHERE template_id = $1 AND deleted_at IS NULL`,
      [templateId],
    );
    if (!ownerRows[0]) throw new NotFoundException("커뮤니티 템플릿을 찾을 수 없습니다.");
    if (ownerRows[0].owner_user_id === userId) {
      throw new ForbiddenException("내가 공개한 자료는 신고할 수 없습니다.");
    }
    const reportId = `community_report_${randomUUID()}`;
    try {
      const rows = await this.dataSource.query<Array<{ created_at: Date | string }>>(
        `
          INSERT INTO community_template_reports (
            report_id, template_id, reporter_user_id, reason, details
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING created_at
        `,
        [reportId, templateId, userId, input.reason, input.details ?? ""],
      );
      this.logger?.info(
        { event: "community_template.report_created", reportId, templateId, userId, reason: input.reason },
        "Community template report created.",
      );
      return createCommunityTemplateReportResponseSchema.parse({
        reportId,
        status: "open",
        createdAt: toIso(rows[0]!.created_at),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("이미 신고한 자료입니다.");
      }
      throw error;
    }
  }

  async listReports(query: CommunityTemplateModerationQuery, userId: string) {
    await this.assertModerator(userId);
    const rows = await this.dataSource.query<CommunityReportRow[]>(
      `${this.reportSelectSql()}
       WHERE ($1::text IS NULL OR reports.status = $1)
       ORDER BY reports.created_at DESC, reports.report_id DESC
       LIMIT $2 OFFSET $3`,
      [query.status ?? null, query.limit + 1, (query.page - 1) * query.limit],
    );
    return communityTemplateModerationListResponseSchema.parse({
      items: rows.slice(0, query.limit).map((row) => this.toReport(row)),
      page: query.page,
      hasMore: rows.length > query.limit,
    });
  }

  async updateReport(
    reportId: string,
    input: UpdateCommunityTemplateReportRequest,
    moderatorUserId: string,
  ) {
    await this.assertModerator(moderatorUserId);
    const rows = await this.dataSource.query<Array<{ template_id: string }>>(
      `
        UPDATE community_template_reports
        SET status = $2, resolution_note = $3, reviewed_by_user_id = $4, updated_at = now()
        WHERE report_id = $1
        RETURNING template_id
      `,
      [reportId, input.status, input.resolutionNote ?? null, moderatorUserId],
    );
    if (!rows[0]) throw new NotFoundException("신고 내역을 찾을 수 없습니다.");
    if (input.hideTemplate) {
      await this.dataSource.query(
        `
          UPDATE community_templates
          SET deleted_at = COALESCE(deleted_at, now()),
              deleted_by_user_id = $2,
              moderation_note = $3,
              updated_at = now()
          WHERE template_id = $1
        `,
        [rows[0].template_id, moderatorUserId, input.resolutionNote ?? "신고 검토에 따른 비공개"],
      );
    }
    const report = await this.readReport(reportId);
    this.logger?.info(
      { event: "community_template.report_reviewed", reportId, templateId: rows[0].template_id, moderatorUserId, status: input.status, hidden: input.hideTemplate },
      "Community template report reviewed.",
    );
    return updateCommunityTemplateReportResponseSchema.parse({ report });
  }

  async recordView(templateId: string, userId: string) {
    await this.assertCommunityTemplateExists(templateId);
    await this.dataSource.query(
      `
        INSERT INTO community_template_views (template_id, user_id, viewed_on)
        VALUES ($1, $2, CURRENT_DATE)
        ON CONFLICT (template_id, user_id, viewed_on)
        DO UPDATE SET viewed_at = community_template_views.viewed_at
      `,
      [templateId, userId],
    );
    return this.readEngagement(templateId, userId);
  }

  async recordShare(templateId: string, userId: string) {
    await this.assertCommunityTemplateExists(templateId);
    await this.dataSource.query(
      `INSERT INTO community_template_shares (share_id, template_id, user_id) VALUES ($1, $2, $3)`,
      [`community_share_${randomUUID()}`, templateId, userId],
    );
    this.logger?.info(
      { event: "community_template.shared", templateId, userId },
      "Community template shared.",
    );
    return this.readEngagement(templateId, userId);
  }

  async listComments(
    templateId: string,
    query: CommunityTemplateCommentListQuery,
    userId: string,
  ) {
    await this.assertCommunityTemplateExists(templateId);
    const rows = await this.dataSource.query<CommunityCommentRow[]>(
      `
        SELECT comments.*, users.display_name, users.avatar_type, users.avatar_id
        FROM community_template_comments comments
        INNER JOIN users ON users.user_id = comments.author_user_id
        WHERE comments.template_id = $1
        ORDER BY comments.created_at DESC, comments.comment_id DESC
        LIMIT $2 OFFSET $3
      `,
      [templateId, query.limit + 1, (query.page - 1) * query.limit],
    );
    return communityTemplateCommentListResponseSchema.parse({
      items: rows.slice(0, query.limit).map((row) => this.toComment(row, userId)),
      page: query.page,
      hasMore: rows.length > query.limit,
    });
  }

  async createComment(
    templateId: string,
    input: { body: string },
    userId: string,
  ) {
    await this.assertCommunityTemplateExists(templateId);
    const commentId = `community_comment_${randomUUID()}`;
    const rows = await this.dataSource.query<CommunityCommentRow[]>(
      `
        WITH inserted AS (
          INSERT INTO community_template_comments (comment_id, template_id, author_user_id, body)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        )
        SELECT inserted.*, users.display_name, users.avatar_type, users.avatar_id
        FROM inserted INNER JOIN users ON users.user_id = inserted.author_user_id
      `,
      [commentId, templateId, userId, input.body],
    );
    this.logger?.info(
      { event: "community_template.comment_created", templateId, commentId, userId },
      "Community template comment created.",
    );
    return communityTemplateCommentResponseSchema.parse({
      comment: this.toComment(rows[0]!, userId),
    });
  }

  async updateComment(
    templateId: string,
    commentId: string,
    input: { body: string },
    userId: string,
  ) {
    const rows = await this.dataSource.query<CommunityCommentRow[]>(
      `
        WITH updated AS (
          UPDATE community_template_comments
          SET body = $4, updated_at = now()
          WHERE comment_id = $1 AND template_id = $2 AND author_user_id = $3
          RETURNING *
        )
        SELECT updated.*, users.display_name, users.avatar_type, users.avatar_id
        FROM updated INNER JOIN users ON users.user_id = updated.author_user_id
      `,
      [commentId, templateId, userId, input.body],
    );
    if (!rows[0]) await this.throwCommentMutationError(templateId, commentId, userId);
    this.logger?.info(
      { event: "community_template.comment_updated", templateId, commentId, userId },
      "Community template comment updated.",
    );
    return communityTemplateCommentResponseSchema.parse({
      comment: this.toComment(rows[0]!, userId),
    });
  }

  async deleteComment(templateId: string, commentId: string, userId: string) {
    const rows = await this.dataSource.query<Array<{ comment_id: string }>>(
      `
        DELETE FROM community_template_comments
        WHERE comment_id = $1 AND template_id = $2 AND author_user_id = $3
        RETURNING comment_id
      `,
      [commentId, templateId, userId],
    );
    if (!rows[0]) await this.throwCommentMutationError(templateId, commentId, userId);
    this.logger?.info(
      { event: "community_template.comment_deleted", templateId, commentId, userId },
      "Community template comment deleted.",
    );
    return { deleted: true };
  }

  private async useInTransaction(
    manager: EntityManager,
    workspaceId: string,
    templateId: string,
    clientRequestId: string,
    userId: string,
  ): Promise<UseTransactionResult> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`${userId}:${clientRequestId}`],
    );
    const existingRows = await manager.query<ExistingUseRow[]>(
      `
        SELECT
          community_template_use_requests.template_id,
          projects.project_id,
          projects.workspace_id,
          projects.title,
          projects.created_by,
          projects.created_at,
          decks.deck_id
        FROM community_template_use_requests
        INNER JOIN projects
          ON projects.project_id = community_template_use_requests.project_id
        INNER JOIN decks ON decks.project_id = projects.project_id
        WHERE community_template_use_requests.user_id = $1
          AND community_template_use_requests.client_request_id = $2
        FOR UPDATE
      `,
      [userId, clientRequestId],
    );
    const existing = existingRows[0];
    if (existing) {
      if (existing.template_id !== templateId) {
        throw communityTemplateException(
          "COMMUNITY_TEMPLATE_USE_CONFLICT",
          HttpStatus.CONFLICT,
          "같은 요청 ID가 다른 템플릿에 사용되었습니다.",
        );
      }
      return {
        response: useCommunityTemplateResponseSchema.parse({
          templateId,
          project: {
            projectId: existing.project_id,
            workspaceId: existing.workspace_id,
            title: existing.title,
            createdBy: existing.created_by,
            createdAt: toIso(existing.created_at),
          },
          deckId: existing.deck_id,
        }),
        idempotent: true,
      };
    }

    const templateRows = await manager.query<StoredTemplateRow[]>(
      `
        SELECT
          template_id,
          title,
          category_id AS category,
          snapshot_json,
          preview_json,
          source_deck_version,
          created_at
        FROM community_templates
        WHERE template_id = $1
          AND deleted_at IS NULL
        FOR SHARE
      `,
      [templateId],
    );
    const template = templateRows[0];
    if (!template) {
      throw communityTemplateException(
        "COMMUNITY_TEMPLATE_NOT_FOUND",
        HttpStatus.NOT_FOUND,
        "커뮤니티 템플릿을 찾을 수 없습니다.",
      );
    }
    const snapshot = communityTemplateSnapshotSchema.parse(
      template.snapshot_json,
    );
    const createdAt = new Date();
    const project = await this.projectsService.createInTransaction(
      manager,
      workspaceId,
      { title: template.title },
      userId,
      createdAt,
    );
    const deck = materializeCommunityTemplate({
      snapshot,
      projectId: project.projectId,
      title: project.title,
    });
    await this.decksService.createInitialDeckInTransaction(
      manager,
      deck,
      createdAt.toISOString(),
    );
    await manager.query(
      `
        INSERT INTO community_template_usages (
          template_id,
          user_id,
          last_used_at,
          use_count,
          last_project_id
        )
        VALUES ($1, $2, $3, 1, $4)
        ON CONFLICT (template_id, user_id)
        DO UPDATE SET
          last_used_at = EXCLUDED.last_used_at,
          use_count = community_template_usages.use_count + 1,
          last_project_id = EXCLUDED.last_project_id
      `,
      [templateId, userId, createdAt.toISOString(), project.projectId],
    );
    await manager.query(
      `
        INSERT INTO community_template_use_requests (
          user_id,
          client_request_id,
          template_id,
          project_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        userId,
        clientRequestId,
        templateId,
        project.projectId,
        createdAt.toISOString(),
      ],
    );

    return {
      response: useCommunityTemplateResponseSchema.parse({
        templateId,
        project,
        deckId: deck.deckId,
      }),
      category: template.category,
      slideCount: snapshot.slides.length,
      idempotent: false,
    };
  }

  private parsePublicCards(rows: PublicTemplateRow[]): CommunityTemplateCard[] {
    return rows.flatMap((row) => {
      const result = communityTemplateCardSchema.safeParse({
        templateId: row.template_id,
        title: row.title,
        category: row.category,
        preview: row.preview_json,
        createdAt: toIso(row.created_at),
      });
      if (result.success) return [result.data];
      this.logger?.error(
        {
          event: "community_template.read_failed",
          templateId: row.template_id,
          errorCode: "COMMUNITY_TEMPLATE_SCHEMA_NOT_READY",
        },
        "Community template row skipped.",
      );
      return [];
    });
  }

  private toDiscoverCard(row: CommunityDiscoverRow) {
    return communityTemplateDiscoverCardSchema.parse({
      templateId: row.template_id,
      title: row.title,
      category: row.category,
      categoryName: row.category_name,
      tags: row.tags,
      description: row.description,
      preview: row.preview_json,
      createdAt: toIso(row.created_at),
      author: {
        userId: row.owner_user_id,
        displayName: row.display_name,
        avatarUrl: communityAvatarUrl(
          row.owner_user_id,
          row.avatar_type,
          row.avatar_id,
        ),
      },
      stats: {
        likeCount: Number(row.like_count),
        viewCount: Number(row.view_count),
        shareCount: Number(row.share_count),
        commentCount: Number(row.comment_count),
        useCount: Number(row.use_count),
      },
      likedByMe: row.liked_by_me,
    });
  }

  private async replaceTemplateTags(
    manager: Pick<EntityManager, "query">,
    templateId: string,
    names: string[],
    userId: string,
  ) {
    await manager.query(
      `DELETE FROM community_template_tags WHERE template_id = $1`,
      [templateId],
    );
    for (const name of names) {
      const tagId = communityTemplateTagIdSchema.parse(
        "community_tag_" + randomUUID(),
      );
      const rows = await manager.query<Array<{ tag_id: string }>>(
        `
          INSERT INTO community_tags (tag_id, name, created_by_user_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (lower(btrim(name)))
          DO UPDATE SET updated_at = community_tags.updated_at
          RETURNING tag_id
        `,
        [tagId, name, userId],
      );
      await manager.query(
        `
          INSERT INTO community_template_tags (template_id, tag_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [templateId, rows[0]!.tag_id],
      );
    }
  }

  private toComment(row: CommunityCommentRow, userId: string) {
    return {
      commentId: row.comment_id,
      templateId: row.template_id,
      body: row.body,
      author: {
        userId: row.author_user_id,
        displayName: row.display_name,
        avatarUrl: communityAvatarUrl(
          row.author_user_id,
          row.avatar_type,
          row.avatar_id,
        ),
      },
      ownedByMe: row.author_user_id === userId,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  private async assertCommunityTemplateExists(templateId: string) {
    const rows = await this.dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM community_templates WHERE template_id = $1 AND deleted_at IS NULL) AS exists`,
      [templateId],
    );
    if (!rows[0]?.exists) throw new NotFoundException("커뮤니티 템플릿을 찾을 수 없습니다.");
  }

  private async readEngagement(templateId: string, userId: string) {
    const rows = await this.dataSource.query<
      Array<{
        like_count: number;
        view_count: number;
        share_count: number;
        comment_count: number;
        use_count: number;
        liked_by_me: boolean;
      }>
    >(
      `
        SELECT
          (SELECT COUNT(*)::int FROM community_template_likes WHERE template_id = $1) AS like_count,
          (SELECT COUNT(*)::int FROM community_template_views WHERE template_id = $1) AS view_count,
          (SELECT COUNT(*)::int FROM community_template_shares WHERE template_id = $1) AS share_count,
          (SELECT COUNT(*)::int FROM community_template_comments WHERE template_id = $1) AS comment_count,
          COALESCE((SELECT SUM(use_count)::int FROM community_template_usages WHERE template_id = $1), 0) AS use_count,
          EXISTS(SELECT 1 FROM community_template_likes WHERE template_id = $1 AND user_id = $2) AS liked_by_me
      `,
      [templateId, userId],
    );
    const row = rows[0]!;
    return communityTemplateEngagementResponseSchema.parse({
      templateId,
      stats: {
        likeCount: Number(row.like_count),
        viewCount: Number(row.view_count),
        shareCount: Number(row.share_count),
        commentCount: Number(row.comment_count),
        useCount: Number(row.use_count),
      },
      likedByMe: row.liked_by_me,
    });
  }

  private async throwCommentMutationError(
    templateId: string,
    commentId: string,
    userId: string,
  ): Promise<never> {
    const rows = await this.dataSource.query<Array<{ author_user_id: string }>>(
      `SELECT author_user_id FROM community_template_comments WHERE template_id = $1 AND comment_id = $2`,
      [templateId, commentId],
    );
    if (!rows[0]) throw new NotFoundException("댓글을 찾을 수 없습니다.");
    if (rows[0].author_user_id !== userId) {
      throw new ForbiddenException("내 댓글만 수정하거나 삭제할 수 있습니다.");
    }
    throw new NotFoundException("댓글을 찾을 수 없습니다.");
  }

  private async throwTemplateOwnerError(templateId: string, userId: string): Promise<never> {
    const rows = await this.dataSource.query<Array<{ owner_user_id: string; deleted_at: Date | string | null }>>(
      `SELECT owner_user_id, deleted_at FROM community_templates WHERE template_id = $1`,
      [templateId],
    );
    if (!rows[0] || rows[0].deleted_at) {
      throw new NotFoundException("커뮤니티 템플릿을 찾을 수 없습니다.");
    }
    if (rows[0].owner_user_id !== userId) {
      throw new ForbiddenException("내가 공개한 자료만 관리할 수 있습니다.");
    }
    throw new NotFoundException("커뮤니티 템플릿을 찾을 수 없습니다.");
  }

  private async assertModerator(userId: string) {
    const rows = await this.dataSource.query<Array<{ allowed: boolean }>>(
      `SELECT is_community_moderator AS allowed FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!rows[0]?.allowed) throw new ForbiddenException("커뮤니티 운영자 권한이 필요합니다.");
  }

  private reportSelectSql() {
    return `
      SELECT
        reports.report_id, reports.reason, reports.details, reports.status,
        reports.resolution_note, reports.created_at AS report_created_at,
        reports.updated_at AS report_updated_at,
        reports.reporter_user_id, reporters.display_name AS reporter_display_name,
        reporters.avatar_type AS reporter_avatar_type,
        reporters.avatar_id AS reporter_avatar_id,
        templates.template_id, templates.title, templates.category_id AS category,
        templates.preview_json, templates.created_at
      FROM community_template_reports reports
      INNER JOIN community_templates templates ON templates.template_id = reports.template_id
      INNER JOIN users reporters ON reporters.user_id = reports.reporter_user_id
    `;
  }

  private async readReport(reportId: string) {
    const rows = await this.dataSource.query<CommunityReportRow[]>(
      `${this.reportSelectSql()} WHERE reports.report_id = $1`,
      [reportId],
    );
    if (!rows[0]) throw new NotFoundException("신고 내역을 찾을 수 없습니다.");
    return this.toReport(rows[0]);
  }

  private toReport(row: CommunityReportRow) {
    return communityTemplateReportSchema.parse({
      reportId: row.report_id,
      template: this.parsePublicCards([row])[0],
      reporter: {
        userId: row.reporter_user_id,
        displayName: row.reporter_display_name,
        avatarUrl: communityAvatarUrl(
          row.reporter_user_id,
          row.reporter_avatar_type,
          row.reporter_avatar_id,
        ),
      },
      reason: row.reason,
      details: row.details,
      status: row.status,
      resolutionNote: row.resolution_note,
      createdAt: toIso(row.report_created_at),
      updatedAt: toIso(row.report_updated_at),
    });
  }
}

function toCommunityTemplateException(
  error: unknown,
  operation: "publish" | "use" | "read",
): HttpException {
  if (operation === "publish" && isUniqueViolation(error)) {
    return communityTemplateException(
      "COMMUNITY_TEMPLATE_ALREADY_PUBLISHED",
      HttpStatus.CONFLICT,
      "이미 커뮤니티에 공개된 프로젝트입니다.",
    );
  }
  if (error instanceof HttpException) {
    const code = readCommunityTemplateErrorCode(error);
    if (code) return error;
  }
  if (error instanceof CommunityTemplateSanitizationError) {
    if (error.code === "COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED") {
      return communityTemplateException(
        error.code,
        HttpStatus.UNPROCESSABLE_ENTITY,
        "활동 장표가 포함된 프로젝트는 템플릿으로 공개할 수 없습니다.",
      );
    }
    if (error.code === "COMMUNITY_TEMPLATE_SNAPSHOT_TOO_LARGE") {
      return communityTemplateException(
        error.code,
        HttpStatus.PAYLOAD_TOO_LARGE,
        "템플릿 크기 제한을 초과했습니다.",
      );
    }
    return communityTemplateException(
      error.code,
      HttpStatus.UNPROCESSABLE_ENTITY,
      "프로젝트를 안전한 템플릿으로 변환할 수 없습니다.",
    );
  }
  const message =
    operation === "read"
      ? "커뮤니티 템플릿을 불러올 수 없습니다."
      : operation === "publish"
        ? "커뮤니티 템플릿을 공개할 수 없습니다."
        : "커뮤니티 템플릿을 사용할 수 없습니다.";
  return communityTemplateException(
    "COMMUNITY_TEMPLATE_SCHEMA_NOT_READY",
    HttpStatus.SERVICE_UNAVAILABLE,
    message,
  );
}

function communityTemplateException(
  code: CommunityTemplateApiErrorCode,
  status: HttpStatus,
  message: string,
) {
  return new HttpException(
    communityTemplateApiErrorSchema.parse({ code, message, details: [] }),
    status,
  );
}

function readCommunityTemplateErrorCode(
  error: HttpException,
): CommunityTemplateApiErrorCode | undefined {
  const response = error.getResponse();
  if (
    typeof response !== "object" ||
    response === null ||
    !("code" in response)
  ) {
    return undefined;
  }
  const result = communityTemplateApiErrorCodeSchema.safeParse(response.code);
  return result.success ? result.data : undefined;
}

function toIso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function communityAvatarUrl(
  userId: string,
  avatarType: "official" | "uploaded" | null,
  avatarId: string | null,
) {
  if (avatarType === "official" && avatarId) {
    return `/avatars/${encodeURIComponent(avatarId)}.png`;
  }
  if (avatarType === "uploaded" && avatarId) {
    return `/api/v1/auth/avatar/users/${encodeURIComponent(userId)}`;
  }
  return null;
}
