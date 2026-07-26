import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  createActivitySlide,
  createDemoDeck,
  sanitizeCommunityTemplate,
} from "@orbit/editor-core";
import type {
  CommunityTemplateCategory,
  CommunityTemplateSnapshot,
} from "@orbit/shared/community-templates";
import type { Project } from "@orbit/shared/projects";
import { deckSchema } from "@orbit/shared/deck";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource, EntityManager } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { DecksService } from "../decks/decks.service";
import { ProjectsService } from "../projects/projects.service";
import { CommunityTemplatesService } from "./community-templates.service";

type TemplateState = {
  template_id: string;
  owner_user_id: string | null;
  source_project_id: string | null;
  source_deck_id: string;
  source_deck_version: number;
  title: string;
  category: CommunityTemplateCategory;
  snapshot_json: CommunityTemplateSnapshot;
  preview_json: unknown;
  created_at: string;
};

class CommunityTemplateTestDatabase {
  readonly templates = new Map<string, TemplateState>();
  readonly requests = new Map<
    string,
    {
      userId: string;
      clientRequestId: string;
      templateId: string;
      projectId: string;
    }
  >();
  readonly usages = new Map<string, { count: number; projectId: string }>();
  readonly projects = new Map<string, Project>();
  readonly deckIds = new Map<string, string>();
  readonly sourceProjects = new Map<
    string,
    {
      project_id: string;
      workspace_id: string;
      title: string;
      created_at: string;
    }
  >();
  readonly queries: string[] = [];

  async transaction<T>(
    run: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const snapshot = {
      requests: new Map(this.requests),
      usages: new Map(this.usages),
      projects: new Map(this.projects),
      deckIds: new Map(this.deckIds),
    };
    try {
      return await run(this as unknown as EntityManager);
    } catch (error) {
      replaceMap(this.requests, snapshot.requests);
      replaceMap(this.usages, snapshot.usages);
      replaceMap(this.projects, snapshot.projects);
      replaceMap(this.deckIds, snapshot.deckIds);
      throw error;
    }
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const query = sql.replace(/\s+/g, " ").trim();
    this.queries.push(query);

    if (query.startsWith("SELECT pg_advisory_xact_lock")) return [] as T;
    if (
      query.includes("FROM community_categories") &&
      query.includes("category_id = $1")
    ) {
      return [{ category_id: params[0] }] as T;
    }
    if (
      query.includes("FROM community_templates") &&
      query.includes("source_project_id = $1") &&
      query.includes("deleted_at IS NULL")
    ) {
      const sourceProjectId = String(params[0]);
      const existing = [...this.templates.values()].find(
        (template) => template.source_project_id === sourceProjectId,
      );
      return (existing ? [{ template_id: existing.template_id }] : []) as T;
    }
    if (
      query.includes("FROM projects") &&
      query.includes("workspace_id = $2")
    ) {
      const [projectId, workspaceId] = params as [string, string];
      const project = this.sourceProjects.get(projectId);
      return (
        project?.workspace_id === workspaceId ? [{ project_id: projectId }] : []
      ) as T;
    }
    if (
      query.includes("INNER JOIN project_members") &&
      query.includes("role = 'owner'")
    ) {
      const [workspaceId, userId] = params as [string, string];
      return [...this.sourceProjects.values()]
        .filter(
          (project) =>
            project.workspace_id === workspaceId && userId === "user_owner",
        )
        .map((project) => ({
          project_id: project.project_id,
          title: project.title,
          created_at: project.created_at,
        })) as T;
    }
    if (query.startsWith("INSERT INTO community_templates")) {
      const [
        templateId,
        ownerUserId,
        sourceProjectId,
        sourceDeckId,
        sourceVersion,
        title,
        category,
        ,
        snapshot,
        preview,
        createdAt,
      ] = params as [
        string,
        string,
        string,
        string,
        number,
        string,
        CommunityTemplateCategory,
        string,
        CommunityTemplateSnapshot,
        unknown,
        string,
      ];
      const row: TemplateState = {
        template_id: templateId,
        owner_user_id: ownerUserId,
        source_project_id: sourceProjectId,
        source_deck_id: sourceDeckId,
        source_deck_version: sourceVersion,
        title,
        category,
        snapshot_json: snapshot,
        preview_json: preview,
        created_at: createdAt,
      };
      this.templates.set(templateId, row);
      return [row] as T;
    }
    if (
      query.includes("FROM community_template_use_requests") &&
      query.includes("JOIN projects")
    ) {
      const [userId, clientRequestId] = params as [string, string];
      const request = this.requests.get(`${userId}:${clientRequestId}`);
      if (!request) return [] as T;
      const project = this.projects.get(request.projectId)!;
      return [
        {
          template_id: request.templateId,
          project_id: project.projectId,
          workspace_id: project.workspaceId,
          title: project.title,
          created_by: project.createdBy,
          created_at: project.createdAt,
          deck_id: this.deckIds.get(project.projectId),
        },
      ] as T;
    }
    if (
      query.includes("FROM community_templates") &&
      query.includes("snapshot_json") &&
      query.includes("FOR SHARE")
    ) {
      const row = this.templates.get(String(params[0]));
      return (row ? [row] : []) as T;
    }
    if (query.startsWith("INSERT INTO community_template_usages")) {
      const [templateId, userId, , projectId] = params as [
        string,
        string,
        string,
        string,
      ];
      const key = `${templateId}:${userId}`;
      const current = this.usages.get(key);
      this.usages.set(key, { count: (current?.count ?? 0) + 1, projectId });
      return [] as T;
    }
    if (query.startsWith("INSERT INTO community_template_use_requests")) {
      const [userId, clientRequestId, templateId, projectId] = params as [
        string,
        string,
        string,
        string,
      ];
      this.requests.set(`${userId}:${clientRequestId}`, {
        userId,
        clientRequestId,
        templateId,
        projectId,
      });
      return [] as T;
    }
    if (
      query.includes("FROM community_template_usages") &&
      query.includes("last_used_at DESC")
    ) {
      return [] as T;
    }
    if (
      query.includes("FROM community_templates") &&
      query.includes("preview_json")
    ) {
      const [search, category, limit, offset] = params as [
        string | null,
        CommunityTemplateCategory | null,
        number,
        number,
      ];
      return [...this.templates.values()]
        .filter(
          (template) =>
            (!search || template.title.includes(search)) &&
            (!category || template.category === category),
        )
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(offset, offset + limit) as T;
    }

    throw new Error(`Unhandled test query: ${query}`);
  }
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>) {
  target.clear();
  source.forEach((value, key) => target.set(key, value));
}

function createFixture() {
  const database = new CommunityTemplateTestDatabase();
  const sourceDeck = createDemoDeck();
  sourceDeck.slides[0]!.speakerNotes = "PRIVATE_TEMPLATE_MARKER_9f31";
  sourceDeck.slides[0]!.thumbnailUrl = "https://private.example/internal";
  const snapshot = sanitizeCommunityTemplate(sourceDeck);
  const preview = {
    canvas: snapshot.canvas,
    theme: snapshot.theme,
    slide: snapshot.slides[0]!,
  };
  database.sourceProjects.set(sourceDeck.projectId, {
    project_id: sourceDeck.projectId,
    workspace_id: "workspace_demo_1",
    title: sourceDeck.title,
    created_at: "2026-07-20T00:00:00.000Z",
  });
  database.templates.set("community_template_seed", {
    template_id: "community_template_seed",
    owner_user_id: "user_private",
    source_project_id: null,
    source_deck_id: "deck_private",
    source_deck_version: 9,
    title: "교육 템플릿",
    category: "education",
    snapshot_json: snapshot,
    preview_json: preview,
    created_at: "2026-07-21T00:00:00.000Z",
  });

  let createdProjectCount = 0;
  const projectsService = {
    assertIsProjectOwner: vi.fn(async () => undefined),
    createInTransaction: vi.fn(
      async (_manager, workspaceId, input, userId, createdAt) => {
        createdProjectCount += 1;
        const project: Project = {
          projectId: `project_created_${createdProjectCount}`,
          workspaceId,
          title: input.title,
          createdBy: userId,
          createdAt: createdAt.toISOString(),
        };
        database.projects.set(project.projectId, project);
        return project;
      },
    ),
  } as unknown as ProjectsService;
  const decksService = {
    getDeck: vi.fn(async () => ({
      projectId: sourceDeck.projectId,
      deck: sourceDeck,
      updatedAt: "2026-07-21T00:00:00.000Z",
    })),
    createInitialDeckInTransaction: vi.fn(async (_manager, deck) => {
      database.deckIds.set(deck.projectId, deck.deckId);
      return { deck, snapshot: {}, updatedAt: "2026-07-21T00:00:00.000Z" };
    }),
  } as unknown as DecksService;
  const logger = { info: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
  const service = new CommunityTemplatesService(
    database as unknown as DataSource,
    projectsService,
    decksService,
    logger,
  );

  return { database, decksService, logger, projectsService, service, snapshot };
}

describe("CommunityTemplatesService", () => {
  it("returns only public card fields from list storage rows", async () => {
    const { service } = createFixture();

    const response = await service.list({ page: 1, limit: 24 });
    const json = JSON.stringify(response);

    expect(response.items).toHaveLength(1);
    expect(json).not.toMatch(
      /owner_user_id|source_project_id|source_deck_id|snapshot_json/,
    );
    expect(response.items[0]).toMatchObject({
      templateId: "community_template_seed",
      category: "education",
    });
  });

  it("applies search, category, and bounded pagination", async () => {
    const { database, service } = createFixture();
    const seed = database.templates.get("community_template_seed")!;
    database.templates.set("community_template_business", {
      ...seed,
      template_id: "community_template_business",
      title: "분기 비즈니스 리뷰",
      category: "business",
      created_at: "2026-07-22T00:00:00.000Z",
    });

    await expect(
      service.list({
        query: "비즈니스",
        category: "business",
        page: 1,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          templateId: "community_template_business",
          title: "분기 비즈니스 리뷰",
          category: "business",
        },
      ],
      page: 1,
      hasMore: false,
    });
    await expect(service.list({ page: 1, limit: 1 })).resolves.toMatchObject({
      items: [{ templateId: "community_template_business" }],
      hasMore: true,
    });
  });

  it("lists only owner source projects in the requested workspace", async () => {
    const { service } = createFixture();
    expect(await service.listSources("workspace_demo_1", "user_owner")).toEqual(
      {
        items: [
          {
            projectId: "project_demo_1",
            title: "ORBIT Demo Deck",
            createdAt: "2026-07-20T00:00:00.000Z",
            publishable: true,
            unavailableReason: null,
          },
        ],
      },
    );
    expect(await service.listSources("workspace_demo_1", "user_other")).toEqual(
      {
        items: [],
      },
    );
  });

  it("publishes only the server-sanitized current Deck without private content", async () => {
    const { database, service } = createFixture();
    const response = await service.publish(
      "workspace_demo_1",
      {
        sourceProjectId: "project_demo_1",
        title: "공개 템플릿",
        category: "business",
        tags: [],
        rightsConfirmed: true,
      },
      "user_owner",
    );
    const stored = database.templates.get(response.template.templateId)!;
    const json = JSON.stringify(stored.snapshot_json);

    expect(json).not.toContain("PRIVATE_TEMPLATE_MARKER_9f31");
    expect(json).not.toContain("https://private.example/internal");
    expect(response.template).not.toHaveProperty("sourceProjectId");
    expect(response.template).not.toHaveProperty("ownerUserId");
  });

  it("maps non-owner publish attempts to the bounded owner error", async () => {
    const { projectsService, service } = createFixture();
    vi.mocked(projectsService.assertIsProjectOwner).mockRejectedValueOnce(
      new ForbiddenException("private"),
    );

    await expect(
      service.publish(
        "workspace_demo_1",
        {
          sourceProjectId: "project_demo_1",
          title: "공개 템플릿",
          category: "business",
          tags: [],
          rightsConfirmed: true,
        },
        "user_other",
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: "COMMUNITY_TEMPLATE_OWNER_REQUIRED" },
    });
  });

  it("returns bounded source-not-found and activity-unsupported errors", async () => {
    const { database, decksService, service } = createFixture();
    const publishInput = {
      sourceProjectId: "project_demo_1",
      title: "공개 템플릿",
      category: "business" as const,
      tags: [],
      rightsConfirmed: true as const,
    };
    database.sourceProjects.clear();
    await expect(
      service.publish("workspace_demo_1", publishInput, "user_owner"),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: "COMMUNITY_TEMPLATE_SOURCE_NOT_FOUND" },
    });

    const source = createDemoDeck();
    database.sourceProjects.set(source.projectId, {
      project_id: source.projectId,
      workspace_id: "workspace_demo_1",
      title: source.title,
      created_at: "2026-07-20T00:00:00.000Z",
    });
    vi.mocked(decksService.getDeck).mockRejectedValueOnce(
      new NotFoundException("private deck lookup detail"),
    );

    await expect(
      service.publish("workspace_demo_1", publishInput, "user_owner"),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: "COMMUNITY_TEMPLATE_SOURCE_NOT_FOUND" },
    });

    const activity = createActivitySlide(source, "satisfaction");
    const activityDeck = deckSchema.parse({
      ...source,
      slides: [...source.slides, activity],
    });
    vi.mocked(decksService.getDeck).mockResolvedValueOnce({
      projectId: source.projectId,
      deck: activityDeck,
      updatedAt: "2026-07-21T00:00:00.000Z",
    });

    await expect(
      service.publish("workspace_demo_1", publishInput, "user_owner"),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: "COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED" },
    });
  });

  it("returns the same project for an idempotent use retry", async () => {
    const { database, projectsService, service } = createFixture();
    const request = { clientRequestId: "6d620d1a-4d0d-4b40-b430-68875d5942b1" };

    const first = await service.use(
      "workspace_demo_1",
      "community_template_seed",
      request,
      "user_reader",
    );
    const second = await service.use(
      "workspace_demo_1",
      "community_template_seed",
      request,
      "user_reader",
    );

    expect(second).toEqual(first);
    expect(projectsService.createInTransaction).toHaveBeenCalledTimes(1);
    expect(database.projects).toHaveLength(1);
    expect(
      database.usages.get("community_template_seed:user_reader")?.count,
    ).toBe(1);
  });

  it("rejects reuse of the same idempotency key for another template", async () => {
    const { database, service, snapshot } = createFixture();
    const seed = database.templates.get("community_template_seed")!;
    database.templates.set("community_template_other", {
      ...seed,
      template_id: "community_template_other",
      snapshot_json: snapshot,
    });
    const request = { clientRequestId: "6d620d1a-4d0d-4b40-b430-68875d5942b1" };
    await service.use(
      "workspace_demo_1",
      "community_template_seed",
      request,
      "user_reader",
    );

    await expect(
      service.use(
        "workspace_demo_1",
        "community_template_other",
        request,
        "user_reader",
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "COMMUNITY_TEMPLATE_USE_CONFLICT" },
    });
  });

  it("rolls back project and idempotency state when initial Deck creation fails", async () => {
    const { database, decksService, service } = createFixture();
    vi.mocked(
      decksService.createInitialDeckInTransaction,
    ).mockRejectedValueOnce(new Error("deck write failed"));

    await expect(
      service.use(
        "workspace_demo_1",
        "community_template_seed",
        { clientRequestId: "6d620d1a-4d0d-4b40-b430-68875d5942b1" },
        "user_reader",
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "COMMUNITY_TEMPLATE_SCHEMA_NOT_READY" },
    });
    expect(database.projects).toHaveLength(0);
    expect(database.requests).toHaveLength(0);
    expect(database.usages).toHaveLength(0);
  });

  it("uses an immutable snapshot after the source project has been deleted", async () => {
    const { database, service } = createFixture();
    database.sourceProjects.clear();

    const result = await service.use(
      "workspace_demo_1",
      "community_template_seed",
      { clientRequestId: "6d620d1a-4d0d-4b40-b430-68875d5942b1" },
      "user_reader",
    );

    expect(result.project.projectId).toMatch(/^project_created_/);
    expect(result.deckId).toMatch(/^deck_/);
  });
});
