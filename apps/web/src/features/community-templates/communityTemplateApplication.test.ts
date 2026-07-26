import { createDemoDeck, sanitizeCommunityTemplate } from "@orbit/editor-core";
import type { CommunityTemplateCard } from "@orbit/shared/community-templates";
import { describe, expect, it, vi } from "vitest";

import {
  createCommunityTemplateApplyAttempt,
  executeCommunityTemplateApply,
} from "./communityTemplateApplication";

const snapshot = sanitizeCommunityTemplate(createDemoDeck());
const card: CommunityTemplateCard = {
  templateId: "community_template_apply",
  title: "즉시 적용 템플릿",
  category: "business",
  preview: {
    canvas: snapshot.canvas,
    theme: snapshot.theme,
    slide: snapshot.slides[0],
  },
  createdAt: "2026-07-21T00:00:00.000Z",
};

describe("community template application", () => {
  it("reuses the same UUID when retrying the failed card instance", () => {
    const createRequestId = vi
      .fn()
      .mockReturnValueOnce("6d620d1a-4d0d-4b40-b430-68875d5942b1")
      .mockReturnValueOnce("8b8ad789-9df9-43b8-87cd-eab672365aae");
    const first = createCommunityTemplateApplyAttempt(
      "all:community_template_apply",
      card,
      null,
      createRequestId,
    );
    const retry = createCommunityTemplateApplyAttempt(
      "all:community_template_apply",
      card,
      { ...first, message: "다시 시도해 주세요." },
      createRequestId,
    );
    const otherInstance = createCommunityTemplateApplyAttempt(
      "recent:community_template_apply",
      card,
      { ...first, message: "다시 시도해 주세요." },
      createRequestId,
    );

    expect(retry.clientRequestId).toBe(first.clientRequestId);
    expect(otherInstance.clientRequestId).not.toBe(first.clientRequestId);
    expect(createRequestId).toHaveBeenCalledTimes(2);
  });

  it("invalidates projects and recent templates before closing and navigating", async () => {
    const invalidateProjects = vi.fn(async () => undefined);
    const invalidateRecent = vi.fn(async () => undefined);
    const closeGallery = vi.fn();
    const navigate = vi.fn();
    const useTemplate = vi.fn(async () => ({
      templateId: card.templateId,
      project: {
        projectId: "project_from_template",
        workspaceId: "workspace_demo_1",
        title: card.title,
        createdBy: "user_demo_1",
        createdAt: "2026-07-21T00:00:00.000Z",
      },
      deckId: "deck_from_template",
    }));
    const attempt = createCommunityTemplateApplyAttempt(
      "all:community_template_apply",
      card,
      null,
      () => "6d620d1a-4d0d-4b40-b430-68875d5942b1",
    );

    await executeCommunityTemplateApply(
      { attempt, workspaceId: "workspace_demo_1" },
      {
        closeGallery,
        invalidateProjects,
        invalidateRecent,
        navigate,
        useTemplate,
      },
    );

    expect(useTemplate).toHaveBeenCalledWith({
      workspaceId: "workspace_demo_1",
      templateId: card.templateId,
      clientRequestId: attempt.clientRequestId,
    });
    expect(invalidateProjects).toHaveBeenCalledOnce();
    expect(invalidateRecent).toHaveBeenCalledOnce();
    expect(closeGallery).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/project/project_from_template");
  });

  it("keeps the gallery open when use fails", async () => {
    const closeGallery = vi.fn();
    const navigate = vi.fn();
    const attempt = createCommunityTemplateApplyAttempt(
      "all:community_template_apply",
      card,
      null,
      () => "6d620d1a-4d0d-4b40-b430-68875d5942b1",
    );

    await expect(
      executeCommunityTemplateApply(
        { attempt, workspaceId: "workspace_demo_1" },
        {
          closeGallery,
          invalidateProjects: vi.fn(),
          invalidateRecent: vi.fn(),
          navigate,
          useTemplate: vi.fn(async () => {
            throw new Error("network detail must not reach the DOM");
          }),
        },
      ),
    ).rejects.toThrow("network detail must not reach the DOM");
    expect(closeGallery).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
