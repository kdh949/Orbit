import { createDemoDeck } from "@orbit/editor-core";
import type { GenerateDeckDesignSelection } from "@orbit/shared";
import { expect, test } from "@playwright/test";

const projectId = "project_ai_ppt_design_pack_smoke";
const jobId = "job_ai_ppt_design_pack_smoke";
const now = "2026-07-22T00:00:00.000Z";

test("selects a curated design pack and hands the generated deck to the editor", async ({
  page,
}) => {
  const generatedDeck = createDemoDeck();
  generatedDeck.projectId = projectId;
  generatedDeck.deckId = "deck_ai_ppt_design_pack_smoke";
  generatedDeck.title = "분기 경영 보고";
  generatedDeck.metadata = {
    ...generatedDeck.metadata,
    sourceType: "ai",
    designProgramSnapshot: {
      version: "program-v2",
      visualConcept: "Executive Korean report",
      paletteRoles: { dominant: "#FFFFFF", focal: "#2563EB" },
      typography: {
        headingFont: "Pretendard",
        bodyFont: "Pretendard",
        typeScale: { title: 56, body: 22 },
      },
      backgroundSequence: ["light"],
      imageStyle: "Evidence-first editorial media",
      surfaceStyle: "Flat executive surfaces",
      compositionIds: ["editorial-split"],
      designPackId: "executive-review",
      designPackVersion: 1,
      selectionMode: "user",
      selectionReason: "explicit-user-selection",
      selectionFallbackUsed: false,
      layoutIds: ["executive-summary-01"],
      layoutCatalogVersion: 1,
    },
  };
  generatedDeck.slides = generatedDeck.slides.slice(0, 1).map((slide) => ({
    ...slide,
    order: 1,
    title: "분기 핵심 성과",
  }));

  let savedSelection: GenerateDeckDesignSelection | null = null;
  let releaseReadyPreview = false;
  const unexpectedApiRequests: string[] = [];

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/api\/(?:v1\/|health(?:\?|$))/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/api/v1/auth/me" && method === "GET") {
      await route.fulfill({
        json: {
          user: {
            userId: "user_ai_ppt_smoke",
            email: "ai-ppt-smoke@example.test",
            displayName: "AI PPT 스모크",
            createdAt: now,
            avatar: null,
          },
          authenticatedAt: now,
          expiresAt: "2026-07-23T00:00:00.000Z",
        },
      });
      return;
    }

    if (
      path === "/api/v1/workspaces/workspace_demo_1/projects" &&
      method === "POST"
    ) {
      await route.fulfill({
        json: {
          projectId,
          workspaceId: "workspace_demo_1",
          title: "분기 경영 보고",
          createdBy: "user_ai_ppt_smoke",
          createdAt: now,
        },
      });
      return;
    }

    if (
      path === `/api/v1/workspaces/workspace_demo_1/projects/${projectId}` &&
      method === "PATCH"
    ) {
      await route.fulfill({ status: 204 });
      return;
    }

    if (
      path === `/api/v1/projects/${projectId}/jobs/generate-deck` &&
      method === "POST"
    ) {
      await route.fulfill({ json: { job: { jobId } } });
      return;
    }

    if (
      path === `/api/v1/projects/${projectId}/jobs/${jobId}/design-selection` &&
      method === "GET"
    ) {
      await route.fulfill({
        json: {
          jobId,
          projectId,
          status: "selecting",
          styleContext: { topic: "분기 경영 보고", tone: "professional" },
          selection: null,
        },
      });
      return;
    }

    if (
      path === `/api/v1/projects/${projectId}/design-pack-options` &&
      method === "POST"
    ) {
      await route.fulfill({
        json: {
          catalogVersion: 1,
          options: [
            {
              id: "executive-review",
              version: 1,
              name: "Executive Review",
              family: "executive-review",
              rationale: "경영 보고 구조에 적합합니다.",
              preview: {
                manifestId: "preview-executive-review-v1",
                coverPreviewId: "preview-executive-cover-v1",
                bodyPreviewId: "preview-executive-body-v1",
              },
            },
          ],
          fallbackUsed: false,
        },
      });
      return;
    }

    if (
      path === `/api/v1/projects/${projectId}/jobs/${jobId}/design-selection` &&
      method === "PUT"
    ) {
      savedSelection = request.postDataJSON() as GenerateDeckDesignSelection;
      await route.fulfill({
        json: {
          jobId,
          projectId,
          status: "selected",
          styleContext: { topic: "분기 경영 보고", tone: "professional" },
          selection: savedSelection,
        },
      });
      return;
    }

    if (
      path === `/api/v1/projects/${projectId}/jobs/${jobId}/deck-preview` &&
      method === "GET"
    ) {
      if (!releaseReadyPreview) {
        await route.fulfill({
          json: {
            jobId,
            projectId,
            status: "composing",
            progress: 40,
            expectedSlideCountRange: { min: 1, max: 1 },
            editable: false,
            outline: [
              {
                order: 1,
                title: "분기 핵심 성과",
                message: "성과를 요약합니다.",
              },
            ],
            deck: null,
            completedSlideIds: [],
            pendingSlideIds: [],
            updatedAt: now,
            error: null,
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          jobId,
          projectId,
          status: "ready",
          progress: 100,
          expectedSlideCountRange: { min: 1, max: 1 },
          editable: false,
          outline: [
            {
              order: 1,
              title: "분기 핵심 성과",
              message: "성과를 요약합니다.",
            },
          ],
          deck: generatedDeck,
          completedSlideIds: [generatedDeck.slides[0]!.slideId],
          pendingSlideIds: [],
          updatedAt: now,
          error: null,
        },
      });
      return;
    }

    if (path === `/api/v1/projects/${projectId}/access` && method === "GET") {
      await route.fulfill({
        json: {
          project: {
            projectId,
            workspaceId: "workspace_demo_1",
            title: generatedDeck.title,
            createdBy: "user_ai_ppt_smoke",
            createdAt: now,
          },
          membership: { role: "owner", status: "accepted" },
        },
      });
      return;
    }

    if (path === `/api/v1/projects/${projectId}/deck` && method === "GET") {
      await route.fulfill({
        json: { projectId, deck: generatedDeck, updatedAt: now },
      });
      return;
    }

    if (path === "/api/health" && method === "GET") {
      await route.fulfill({
        json: {
          status: "ok",
          app: "orbit-api",
          demo: {
            projectId: "project_demo_1",
            sessionId: "session_demo_1",
            workspaceId: "workspace_demo_1",
          },
        },
      });
      return;
    }

    if (
      path ===
        `/api/v1/workspaces/workspace_demo_1/projects/${projectId}/members` &&
      method === "GET"
    ) {
      await route.fulfill({ json: { members: [], requests: [] } });
      return;
    }

    if (path === "/api/v1/runtime-config" && method === "GET") {
      await route.fulfill({
        json: {
          liveSttEngine: "web-speech",
          adaptiveRehearsalCoachEnabled: false,
          focusedPracticeEnabled: false,
          challengeQnaEnabled: false,
          slidePracticeEnabled: false,
          slideQuestionGuidesEnabled: false,
        },
      });
      return;
    }

    unexpectedApiRequests.push(`${method} ${path}`);
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        message: `Unexpected E2E API request: ${method} ${path}`,
      }),
    });
  });

  await page.goto("/createdeck");
  await page.getByLabel("발표 주제").fill("분기 경영 보고");
  await page.getByLabel("타깃 청중").fill("경영진");
  await page
    .getByLabel("상세 내용 및 컨텍스트")
    .fill(
      "핵심 성과와 다음 분기 우선순위를 설명합니다. 1장으로 구성해 주세요.",
    );
  await page.getByRole("button", { name: "다음 단계" }).click();

  await expect(page).toHaveURL(`/project/${projectId}/style-color/${jobId}`);
  await expect(
    page.getByRole("button", { name: "AI 추천 자동 모드" }),
  ).toHaveAttribute("aria-pressed", "true");

  const executivePack = page.getByRole("button", {
    name: "Executive Review 디자인 팩 선택",
  });
  await expect(executivePack).toBeVisible();
  await executivePack.click();
  await page.getByRole("button", { name: "슬라이드 생성" }).click();

  await expect
    .poll(() => savedSelection)
    .toMatchObject({
      systemDesignPackSelection: { id: "executive-review", version: 1 },
    });
  await expect(page).toHaveURL(`/project/${projectId}/generation/${jobId}`);
  await expect(
    page.getByRole("heading", { name: "슬라이드를 만들고 있습니다." }),
  ).toBeVisible();
  releaseReadyPreview = true;

  await expect(page).toHaveURL(`/project/${projectId}`, { timeout: 15_000 });
  await expect(
    page.getByRole("region", { name: "Presentation editor" }),
  ).toBeVisible();
  await expect(
    page.getByText(generatedDeck.title, { exact: true }).first(),
  ).toBeVisible();
  expect(unexpectedApiRequests).toEqual([]);
});
