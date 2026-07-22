import { createDemoDeck } from "@orbit/editor-core";
import type { OoxmlReferenceTemplateGenerationRequest } from "@orbit/shared";
import { expect, test } from "@playwright/test";

const projectId = "project_ooxml_reference_e2e";
const jobId = "job_ooxml_reference_e2e";
const exportJobId = "job_ooxml_reference_export_e2e";
const now = "2026-07-22T00:00:00.000Z";

test("keeps the reference mode and catalog unavailable while the global flag is off", async ({
  page,
}) => {
  let catalogRequests = 0;
  await page.route(/\/api\/(?:v1\/|health(?:\?|$))/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/runtime-config") {
      await route.fulfill({ json: runtimeConfig(false) });
      return;
    }
    if (path === "/api/v1/auth/me") {
      await route.fulfill({ json: authSession() });
      return;
    }
    if (path === "/api/v1/ooxml-reference-templates") {
      catalogRequests += 1;
    }
    await route.fulfill({ status: 404, json: { message: "not found" } });
  });

  await page.goto("/createdeck");

  await expect(
    page.getByRole("button", { name: "AI 추천 디자인" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "원본 템플릿 충실도" }),
  ).toHaveCount(0);
  expect(catalogRequests).toBe(0);
});

test("selects an exact approved reference version and exports the generated reference deck", async ({
  page,
}) => {
  const generatedDeck = createReferenceDeck();
  let generationRequest: OoxmlReferenceTemplateGenerationRequest | null = null;
  let exportRequested = false;
  const unexpectedApiRequests: string[] = [];

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/api\/(?:v1\/|jobs\/|health(?:\?|$))/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/api/v1/runtime-config" && method === "GET") {
      await route.fulfill({ json: runtimeConfig(true) });
      return;
    }
    if (path === "/api/v1/auth/me" && method === "GET") {
      await route.fulfill({ json: authSession() });
      return;
    }
    if (path === "/api/v1/ooxml-reference-templates" && method === "GET") {
      await route.fulfill({
        json: {
          options: [
            {
              templateId: "operating-review",
              version: 1,
              name: "Operating Review",
              description: "운영 지표와 실행 과제 보고",
              preview: { coverAssetId: "cover", bodyAssetId: "body" },
              editableRanges: [
                {
                  contentType: "text",
                  mutationPolicy: "text-content",
                  slotCount: 4,
                },
              ],
            },
          ],
        },
      });
      return;
    }
    if (
      path.startsWith(
        "/api/v1/ooxml-reference-templates/operating-review/versions/1/previews/",
      ) &&
      method === "GET"
    ) {
      await route.fulfill({
        body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        contentType: "image/png",
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
          title: generatedDeck.title,
          createdBy: "user_ooxml_reference_e2e",
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
      path ===
        `/api/v1/projects/${projectId}/ooxml-reference-template-generations` &&
      method === "POST"
    ) {
      generationRequest =
        request.postDataJSON() as OoxmlReferenceTemplateGenerationRequest;
      await route.fulfill({
        json: { job: queuedJob(jobId, "ooxml-reference-template-generation") },
      });
      return;
    }
    if (
      path ===
        `/api/v1/projects/${projectId}/ooxml-reference-template-generations/${jobId}/preview` &&
      method === "GET"
    ) {
      await route.fulfill({
        json: {
          jobId,
          projectId,
          status: "succeeded",
          progress: 100,
          editable: false,
          outline: [{ order: 1, title: "운영 핵심 성과" }],
          completedSlides: [
            {
              slideId: generatedDeck.slides[0]!.slideId,
              order: 1,
              renderAssetFileId: "file_reference_render_1",
            },
          ],
          pendingSlideOrders: [],
          deckId: generatedDeck.deckId,
          updatedAt: now,
          error: null,
        },
      });
      return;
    }
    if (
      path ===
        `/api/v1/projects/${projectId}/assets/file_reference_render_1/content` &&
      method === "GET"
    ) {
      await route.fulfill({
        body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        contentType: "image/png",
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
            createdBy: "user_ooxml_reference_e2e",
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
    if (
      path === `/api/v1/projects/${projectId}/deck/import-quality` &&
      method === "GET"
    ) {
      await route.fulfill({ json: { importQuality: null } });
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
      path === `/api/v1/projects/${projectId}/presentation-sessions` &&
      method === "GET"
    ) {
      await route.fulfill({ json: { sessions: [] } });
      return;
    }
    if (
      path === `/api/v1/projects/${projectId}/deck/ooxml-sync-state` &&
      method === "GET"
    ) {
      await route.fulfill({
        json: {
          ooxmlSyncState: {
            status: "synced",
            deckId: generatedDeck.deckId,
            deckVersion: generatedDeck.version,
            syncedDeckVersion: generatedDeck.version,
            retryable: false,
            warningCount: 0,
          },
        },
      });
      return;
    }
    if (
      path === `/api/v1/projects/${projectId}/deck/exports` &&
      method === "POST"
    ) {
      exportRequested = true;
      expect(request.postDataJSON()).toEqual({ format: "pptx" });
      await route.fulfill({
        json: { job: queuedJob(exportJobId, "deck-export") },
      });
      return;
    }
    if (path === `/api/jobs/${exportJobId}` && method === "GET") {
      await route.fulfill({
        json: {
          ...queuedJob(exportJobId, "deck-export"),
          status: "succeeded",
          progress: 100,
          message: "Export completed",
          result: {
            deckId: generatedDeck.deckId,
            fileId: "file_reference_export_1",
            url: "/api/v1/files/file_reference_export_1/download",
            format: "pptx",
            warnings: [],
          },
        },
      });
      return;
    }

    unexpectedApiRequests.push(`${method} ${path}`);
    await route.fulfill({
      status: 404,
      json: { message: "unexpected request" },
    });
  });

  await page.goto("/createdeck");
  await page.getByRole("button", { name: "원본 템플릿 충실도" }).click();
  await page
    .getByRole("button", { name: "Operating Review 버전 1 선택" })
    .click();
  await page.getByLabel("발표 주제").fill("2026 하반기 운영 리뷰");
  await page.getByLabel("타깃 청중").fill("경영진");
  await page
    .getByLabel("상세 내용 및 컨텍스트")
    .fill("핵심 KPI와 실행 과제를 1장으로 정리합니다.");
  await page.getByRole("button", { name: "선택한 원본으로 생성" }).click();

  await expect
    .poll(() => generationRequest)
    .toMatchObject({
      templateSelection: {
        mode: "user",
        templateId: "operating-review",
        version: 1,
      },
    });
  await expect(page).toHaveURL(`/project/${projectId}`, { timeout: 15_000 });
  await expect(
    page.getByRole("region", { name: "Presentation editor" }),
  ).toBeVisible();
  await expect(page.getByTitle("슬라이드 추가")).toHaveCount(0);

  await page.getByRole("button", { name: "파일" }).click();
  await page.getByText("PPTX 내보내기...", { exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "프레젠테이션 내보내기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "내보내기" }).click();
  await expect.poll(() => exportRequested).toBe(true);
  expect(unexpectedApiRequests).toEqual([]);
});

function createReferenceDeck() {
  const deck = createDemoDeck();
  deck.projectId = projectId;
  deck.deckId = "deck_ooxml_reference_e2e";
  deck.title = "2026 하반기 운영 리뷰";
  deck.metadata = {
    ...deck.metadata,
    sourceType: "import",
    generatedBy: "ai",
    ooxmlReferenceTemplateSnapshot: {
      catalogTemplateId: "operating-review",
      catalogTemplateVersion: 1,
      sourceSha256: "a".repeat(64),
      generationId: jobId,
    },
  };
  deck.slides = deck.slides.slice(0, 1).map((slide) => ({
    ...slide,
    order: 1,
    title: "운영 핵심 성과",
  }));
  return deck;
}

function queuedJob(
  id: string,
  type: "ooxml-reference-template-generation" | "deck-export",
) {
  return {
    jobId: id,
    projectId,
    type,
    status: "queued",
    progress: 0,
    message: "Job queued",
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

function runtimeConfig(ooxmlReferenceTemplatesEnabled: boolean) {
  return {
    liveSttEngine: "web-speech",
    adaptiveRehearsalCoachEnabled: false,
    focusedPracticeEnabled: false,
    challengeQnaEnabled: false,
    slidePracticeEnabled: false,
    slideQuestionGuidesEnabled: false,
    ooxmlReferenceTemplatesEnabled,
  };
}

function authSession() {
  return {
    user: {
      userId: "user_ooxml_reference_e2e",
      email: "ooxml-reference-e2e@example.test",
      displayName: "OOXML 레퍼런스 E2E",
      createdAt: now,
      avatar: null,
    },
    authenticatedAt: now,
    expiresAt: "2026-07-23T00:00:00.000Z",
  };
}
