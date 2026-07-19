import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { demoIds } from "@orbit/shared";
import { DataSource, QueryFailedError, Repository } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import { ProjectEntity } from "./project.entity";
import { ProjectMemberEntity } from "./project-member.entity";
import { ProjectsService } from "./projects.service";

type ProjectFindOptions = {
  where: Partial<ProjectEntity> & { projectId?: unknown };
  order?: Partial<Record<keyof ProjectEntity, "ASC" | "DESC">>;
};

type ProjectMemberFindOptions = {
  where: Partial<ProjectMemberEntity> & { role?: unknown };
};

function findOperatorValues(value: unknown): unknown[] | null {
  if (typeof value === "object" && value !== null && "_value" in value) {
    const candidate = (value as { _value?: unknown })._value;
    return Array.isArray(candidate) ? candidate : [candidate];
  }

  return null;
}

function createProjectRepository(initialProjects: ProjectEntity[] = []) {
  const projects = initialProjects;

  const repository = {
    create(input: Partial<ProjectEntity>): ProjectEntity {
      return input as ProjectEntity;
    },
    async save(project: ProjectEntity): Promise<ProjectEntity> {
      const index = projects.findIndex(
        (item) => item.projectId === project.projectId,
      );
      if (index >= 0) {
        projects[index] = project;
      } else {
        projects.push(project);
      }

      return project;
    },
    async find(options: ProjectFindOptions): Promise<ProjectEntity[]> {
      const projectIdValues = findOperatorValues(options.where.projectId);
      const filtered = projects.filter((project) => {
        if (project.workspaceId !== options.where.workspaceId) {
          return false;
        }

        if (projectIdValues) {
          return projectIdValues.includes(project.projectId);
        }

        return true;
      });
      if (options.order?.createdAt === "DESC") {
        return filtered.sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime(),
        );
      }
      return filtered;
    },
    async findOne(options: ProjectFindOptions): Promise<ProjectEntity | null> {
      return (
        projects.find(
          (project) => project.projectId === options.where.projectId,
        ) ?? null
      );
    },
    async delete(where: Partial<ProjectEntity>): Promise<void> {
      const index = projects.findIndex(
        (project) =>
          project.projectId === where.projectId &&
          (!where.workspaceId || project.workspaceId === where.workspaceId),
      );
      if (index >= 0) {
        projects.splice(index, 1);
      }
    },
  };

  return repository as unknown as Repository<ProjectEntity>;
}

function createProjectMemberRepository(initialMembers: ProjectMemberEntity[] = []) {
  const members = initialMembers;

  const repository = {
    create(input: Partial<ProjectMemberEntity>): ProjectMemberEntity {
      return input as ProjectMemberEntity;
    },
    async save(member: ProjectMemberEntity): Promise<ProjectMemberEntity> {
      const index = members.findIndex(
        (item) => item.projectId === member.projectId && item.userId === member.userId,
      );
      if (index >= 0) {
        members[index] = member;
      } else {
        members.push(member);
      }

      return member;
    },
    async find(options: ProjectMemberFindOptions): Promise<ProjectMemberEntity[]> {
      const roleValues = findOperatorValues(options.where.role);
      return members.filter((member) => {
        if (options.where.userId && member.userId !== options.where.userId) {
          return false;
        }
        if (options.where.status && member.status !== options.where.status) {
          return false;
        }
        if (roleValues && !roleValues.includes(member.role)) {
          return false;
        }
        return true;
      });
    },
    async findOne(options: ProjectMemberFindOptions): Promise<ProjectMemberEntity | null> {
      return (
        members.find((member) => {
          if (options.where.projectId && member.projectId !== options.where.projectId) {
            return false;
          }
          if (options.where.userId && member.userId !== options.where.userId) {
            return false;
          }
          if (options.where.status && member.status !== options.where.status) {
            return false;
          }
          return true;
        }) ?? null
      );
    },
    async delete(where: Partial<ProjectMemberEntity>): Promise<void> {
      const index = members.findIndex(
        (member) => member.projectId === where.projectId && member.userId === where.userId,
      );
      if (index >= 0) {
        members.splice(index, 1);
      }
    },
  };

  return repository as unknown as Repository<ProjectMemberEntity>;
}

function createService(args?: {
  projects?: ProjectEntity[];
  members?: ProjectMemberEntity[];
  users?: Array<{ user_id: string; email: string }>;
  transactionQueries?: string[];
}) {
  const projects = args?.projects ?? [];
  const members = args?.members ?? [];
  const users = args?.users ?? [];
  const dataSource = {
    async query(query: string, params: unknown[]) {
      if (query.includes("FROM users") && query.includes("WHERE lower(email) = lower($1)")) {
        const email = String(params[0]).toLowerCase();
        return users.filter((user) => user.email.toLowerCase() === email);
      }
      if (query.includes("FROM project_members")) {
        const projectId = String(params[0]);
        return members
          .filter((member) => member.projectId === projectId)
          .map((member) => ({
            user_id: member.userId,
            email: users.find((user) => user.user_id === member.userId)?.email ?? `${member.userId}@example.com`,
            role: member.role,
            status: member.status,
            created_at: member.createdAt,
          }));
      }
      return [];
    },
    async transaction<T>(callback: (manager: {
      create: <Entity>(entity: new () => Entity, input: Partial<Entity>) => Entity;
      query: (query: string, params?: unknown[]) => Promise<unknown[]>;
      save: <Entity>(entity: Entity) => Promise<Entity>;
      update: (entity: unknown, where: Partial<ProjectMemberEntity>, input: Partial<ProjectMemberEntity>) => Promise<void>;
    }) => Promise<T>) {
      return callback({
        async query(query) {
          args?.transactionQueries?.push(query);
          if (query.includes("to_regclass")) return [];
          return [];
        },
        create(_entity, input) {
          return input as never;
        },
        async save(entity) {
          if (
            entity &&
            typeof entity === "object" &&
            "workspaceId" in entity &&
            "title" in entity
          ) {
            return createProjectRepository(projects).save(
              entity as unknown as ProjectEntity,
            ) as unknown as Promise<typeof entity>;
          }
          if (
            entity &&
            typeof entity === "object" &&
            "projectId" in entity &&
            "userId" in entity
          ) {
            return createProjectMemberRepository(members).save(
              entity as unknown as ProjectMemberEntity,
            ) as unknown as Promise<typeof entity>;
          }
          return entity;
        },
        async update(_entity, where, input) {
          const member = members.find(
            (candidate) =>
              candidate.projectId === where.projectId &&
              candidate.userId === where.userId &&
              (!where.status || candidate.status === where.status),
          );
          if (member && input.role) {
            member.role = input.role;
          }
        },
      });
    },
  } as unknown as DataSource;

  return new ProjectsService(
    dataSource,
    createProjectRepository(projects),
    createProjectMemberRepository(members),
  );
}

describe("ProjectsService", () => {
  it("returns a structured service unavailable error when access membership lookup fails", async () => {
    const project = new ProjectEntity();
    project.projectId = "project_schema_drift";
    project.workspaceId = demoIds.workspaceId;
    project.title = "Schema drift";
    project.createdBy = "user_owner";
    project.createdAt = new Date("2026-07-18T00:00:00.000Z");
    const memberRepository = createProjectMemberRepository();
    vi.spyOn(memberRepository, "findOne").mockRejectedValue(
      new QueryFailedError("SELECT", [], new Error("missing column")),
    );
    const service = new ProjectsService(
      { query: vi.fn() } as unknown as DataSource,
      createProjectRepository([project]),
      memberRepository,
    );

    const failure = await service
      .getProjectAccess(project.projectId, "user_owner")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure).toMatchObject({
      response: {
        code: "PROJECT_ACCESS_UNAVAILABLE",
        message: "프로젝트 권한 정보를 불러오지 못했습니다.",
        details: [],
      },
      status: 503,
    });
  });

  it("returns a structured service unavailable error when member listing fails", async () => {
    const project = new ProjectEntity();
    project.projectId = "project_members_schema_drift";
    project.workspaceId = demoIds.workspaceId;
    project.title = "Members schema drift";
    project.createdBy = "user_owner";
    project.createdAt = new Date("2026-07-18T00:00:00.000Z");
    const memberRepository = createProjectMemberRepository();
    vi.spyOn(memberRepository, "findOne").mockRejectedValue(
      new QueryFailedError("SELECT", [], new Error("missing column")),
    );
    const service = new ProjectsService(
      { query: vi.fn() } as unknown as DataSource,
      createProjectRepository([project]),
      memberRepository,
    );

    const failure = await service
      .listMembers(demoIds.workspaceId, project.projectId, "user_owner")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure).toMatchObject({
      response: {
        code: "PROJECT_MEMBERS_UNAVAILABLE",
        message: "프로젝트 구성원 정보를 불러오지 못했습니다.",
        details: [],
      },
      status: 503,
    });
  });

  it("creates and lists projects inside the demo workspace", async () => {
    const service = createService();

    const project = await service.create(demoIds.workspaceId, {
      title: "Quarterly Review",
    }, "user_1");
    const projects = await service.list(demoIds.workspaceId, "user_1");

    expect(project.projectId).toMatch(/^project_/);
    expect(project.workspaceId).toBe(demoIds.workspaceId);
    expect(project.createdBy).toBe("user_1");
    expect(project.title).toBe("Quarterly Review");
    expect(projects).toEqual([{ ...project, isPinned: false }]);
  });

  it("rejects workspace access outside the demo boundary", async () => {
    const service = createService();

    await expect(service.list("workspace_other", "user_1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.create("workspace_other", { title: "Nope" }, "user_1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lists newest projects first", async () => {
    const older = new ProjectEntity();
    older.projectId = "project_old";
    older.workspaceId = demoIds.workspaceId;
    older.title = "Old";
    older.createdBy = demoIds.userId;
    older.createdAt = new Date("2026-06-28T00:00:00.000Z");
    const newer = new ProjectEntity();
    newer.projectId = "project_new";
    newer.workspaceId = demoIds.workspaceId;
    newer.title = "New";
    newer.createdBy = demoIds.userId;
    newer.createdAt = new Date("2026-06-29T00:00:00.000Z");
    const olderMember = new ProjectMemberEntity();
    olderMember.projectId = older.projectId;
    olderMember.userId = "user_1";
    olderMember.role = "viewer";
    olderMember.status = "accepted";
    olderMember.createdAt = older.createdAt;
    const newerMember = new ProjectMemberEntity();
    newerMember.projectId = newer.projectId;
    newerMember.userId = "user_1";
    newerMember.role = "editor";
    newerMember.status = "accepted";
    newerMember.createdAt = newer.createdAt;
    const service = createService({
      projects: [older, newer],
      members: [olderMember, newerMember],
    });

    await expect(service.list(demoIds.workspaceId, "user_1")).resolves.toMatchObject([
      { projectId: "project_new" },
      { projectId: "project_old" },
    ]);
  });

  it("lists only accepted member projects for the current user", async () => {
    const accepted = new ProjectEntity();
    accepted.projectId = "project_accepted";
    accepted.workspaceId = demoIds.workspaceId;
    accepted.title = "Accepted";
    accepted.createdBy = "user_owner";
    accepted.createdAt = new Date("2026-06-29T00:00:00.000Z");
    const pending = new ProjectEntity();
    pending.projectId = "project_pending";
    pending.workspaceId = demoIds.workspaceId;
    pending.title = "Pending";
    pending.createdBy = "user_owner";
    pending.createdAt = new Date("2026-06-30T00:00:00.000Z");
    const otherUser = new ProjectEntity();
    otherUser.projectId = "project_other";
    otherUser.workspaceId = demoIds.workspaceId;
    otherUser.title = "Other";
    otherUser.createdBy = "user_owner";
    otherUser.createdAt = new Date("2026-06-30T01:00:00.000Z");

    const acceptedMember = new ProjectMemberEntity();
    acceptedMember.projectId = accepted.projectId;
    acceptedMember.userId = "user_1";
    acceptedMember.role = "viewer";
    acceptedMember.status = "accepted";
    acceptedMember.createdAt = accepted.createdAt;
    const pendingMember = new ProjectMemberEntity();
    pendingMember.projectId = pending.projectId;
    pendingMember.userId = "user_1";
    pendingMember.role = "editor";
    pendingMember.status = "pending";
    pendingMember.createdAt = pending.createdAt;
    const otherMember = new ProjectMemberEntity();
    otherMember.projectId = otherUser.projectId;
    otherMember.userId = "user_2";
    otherMember.role = "owner";
    otherMember.status = "accepted";
    otherMember.createdAt = otherUser.createdAt;

    const service = createService({
      projects: [accepted, pending, otherUser],
      members: [acceptedMember, pendingMember, otherMember],
    });

    await expect(service.list(demoIds.workspaceId, "user_1")).resolves.toEqual([
      expect.objectContaining({ projectId: "project_accepted" }),
    ]);
  });

  it("stores project pins independently for each accepted member", async () => {
    const project = new ProjectEntity();
    project.projectId = "project_shared_pin";
    project.workspaceId = demoIds.workspaceId;
    project.title = "Shared pin";
    project.createdBy = "user_owner";
    project.createdAt = new Date("2026-07-18T00:00:00.000Z");

    const owner = new ProjectMemberEntity();
    owner.projectId = project.projectId;
    owner.userId = "user_owner";
    owner.role = "owner";
    owner.status = "accepted";
    owner.isPinned = false;
    owner.createdAt = project.createdAt;

    const viewer = new ProjectMemberEntity();
    viewer.projectId = project.projectId;
    viewer.userId = "user_viewer";
    viewer.role = "viewer";
    viewer.status = "accepted";
    viewer.isPinned = false;
    viewer.createdAt = project.createdAt;

    const service = createService({
      projects: [project],
      members: [owner, viewer],
    });

    await expect(
      service.updatePin(
        demoIds.workspaceId,
        project.projectId,
        owner.userId,
        true,
      ),
    ).resolves.toEqual({ projectId: project.projectId, isPinned: true });
    await expect(service.list(demoIds.workspaceId, owner.userId)).resolves.toEqual([
      expect.objectContaining({ projectId: project.projectId, isPinned: true }),
    ]);
    await expect(service.list(demoIds.workspaceId, viewer.userId)).resolves.toEqual([
      expect.objectContaining({ projectId: project.projectId, isPinned: false }),
    ]);
  });

  it("deletes a project only when the requester is owner", async () => {
    const project = new ProjectEntity();
    project.projectId = "project_owned";
    project.workspaceId = demoIds.workspaceId;
    project.title = "Owned";
    project.createdBy = "user_owner";
    project.createdAt = new Date("2026-06-30T00:00:00.000Z");
    const owner = new ProjectMemberEntity();
    owner.projectId = project.projectId;
    owner.userId = "user_owner";
    owner.role = "owner";
    owner.status = "accepted";
    owner.createdAt = project.createdAt;
    const service = createService({
      projects: [project],
      members: [owner],
    });

    await expect(
      service.delete(demoIds.workspaceId, project.projectId, "user_owner"),
    ).resolves.toEqual({ projectId: project.projectId });
    await expect(service.list(demoIds.workspaceId, "user_owner")).resolves.toEqual([]);
  });

  it("rejects project deletion from non-owners", async () => {
    const project = new ProjectEntity();
    project.projectId = "project_editor";
    project.workspaceId = demoIds.workspaceId;
    project.title = "Editor";
    project.createdBy = "user_owner";
    project.createdAt = new Date("2026-06-30T00:00:00.000Z");
    const editor = new ProjectMemberEntity();
    editor.projectId = project.projectId;
    editor.userId = "user_editor";
    editor.role = "editor";
    editor.status = "accepted";
    editor.createdAt = project.createdAt;
    const service = createService({
      projects: [project],
      members: [editor],
    });

    await expect(
      service.delete(demoIds.workspaceId, project.projectId, "user_editor"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns not found for an unknown project", async () => {
    const service = createService();

    await expect(
      service.getAccessibleProject("project_missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("auto-creates the demo project when demo project access is requested", async () => {
    const service = createService();

    const project = await service.getAccessibleProject(demoIds.projectId);
    const projects = await service.list(demoIds.workspaceId, demoIds.userId);

    expect(project.projectId).toBe(demoIds.projectId);
    expect(project.workspaceId).toBe(demoIds.workspaceId);
    expect(project.createdBy).toBe(demoIds.userId);
    expect(project.title).toBe("ORBIT Demo Project");
    expect(projects).toEqual([]);
  });

  it("creates a pending project access request for a non-member", async () => {
    const project = new ProjectEntity();
    project.projectId = "project_shared";
    project.workspaceId = demoIds.workspaceId;
    project.title = "Shared";
    project.createdBy = "user_owner";
    project.createdAt = new Date("2026-06-30T00:00:00.000Z");
    const service = createService({ projects: [project] });

    const response = await service.requestAccess("project_shared", "user_requester", "viewer");

    expect(response.membership).toEqual({
      role: "viewer",
      status: "pending",
    });
    await expect(service.getProjectAccess("project_shared", "user_requester")).resolves.toMatchObject({
      membership: {
        role: "viewer",
        status: "pending",
      },
    });
  });

  it("rejects project writes from accepted viewers", async () => {
    const project = new ProjectEntity();
    project.projectId = "project_readonly";
    project.workspaceId = demoIds.workspaceId;
    project.title = "Read only";
    project.createdBy = "user_owner";
    project.createdAt = new Date("2026-06-30T00:00:00.000Z");
    const viewer = new ProjectMemberEntity();
    viewer.projectId = project.projectId;
    viewer.userId = "user_viewer";
    viewer.role = "viewer";
    viewer.status = "accepted";
    viewer.createdAt = project.createdAt;
    const service = createService({
      projects: [project],
      members: [viewer],
    });

    await expect(
      service.assertCanWriteProject("project_readonly", "user_viewer"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
