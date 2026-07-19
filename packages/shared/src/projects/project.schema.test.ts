import { describe, expect, it } from "vitest";

import {
  projectAccessResponseSchema,
  projectApiErrorSchema,
  projectListResponseSchema,
  updateProjectPinRequestSchema,
} from "./project.schema";

describe("project pin contracts", () => {
  it("requires a user-specific pin state in project list items", () => {
    expect(
      projectListResponseSchema.parse([
        {
          projectId: "project_1",
          workspaceId: "workspace_1",
          title: "Pinned deck",
          createdBy: "user_1",
          createdAt: "2026-07-18T00:00:00.000Z",
          isPinned: true,
        },
      ]),
    ).toEqual([expect.objectContaining({ isPinned: true })]);
  });

  it("rejects non-boolean project pin updates", () => {
    expect(updateProjectPinRequestSchema.safeParse({ isPinned: "true" }).success).toBe(
      false,
    );
  });
});

describe("project access contracts", () => {
  it("validates accepted membership responses", () => {
    expect(
      projectAccessResponseSchema.parse({
        project: {
          projectId: "project_1",
          workspaceId: "workspace_1",
          title: "Shared deck",
          createdBy: "user_1",
          createdAt: "2026-07-18T00:00:00.000Z",
        },
        membership: { role: "editor", status: "accepted" },
      }),
    ).toMatchObject({ membership: { role: "editor", status: "accepted" } });
  });

  it("requires structured project API failures", () => {
    expect(
      projectApiErrorSchema.parse({
        code: "PROJECT_ACCESS_UNAVAILABLE",
        message: "프로젝트 권한 정보를 불러오지 못했습니다.",
        details: [],
      }),
    ).toEqual({
      code: "PROJECT_ACCESS_UNAVAILABLE",
      message: "프로젝트 권한 정보를 불러오지 못했습니다.",
      details: [],
    });
  });
});
