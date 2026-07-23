import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getDeckResponseSchema,
  getOoxmlSyncStateResponseSchema,
  jobSchema,
  ooxmlReferenceTemplateGenerationJobResultSchema,
  ooxmlReferenceTemplateGenerationRequestSchema,
  ooxmlReferenceTemplateOptionsResponseSchema,
  type Deck,
  type DeckElement,
} from "../../packages/shared/src";
import {
  expect,
  test,
  type APIRequestContext,
  type Download,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import { authenticateE2ePage } from "./authenticatedProject";

const realE2eEnabled = process.env.OOXML_REFERENCE_REAL_E2E === "1";
const selectedTemplateId =
  process.env.OOXML_REFERENCE_REAL_E2E_TEMPLATE_ID ?? "operating-review";
const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";

test.describe("AI PPT OOXML reference template real vertical", () => {
  test.skip(
    !realE2eEnabled,
    "OOXML_REFERENCE_REAL_E2E=1 and approved private source/calibration are required.",
  );

  test("generates, edits, syncs, and exports the exact approved template", async ({
    page,
  }) => {
    test.setTimeout(20 * 60_000);
    const selectedTemplateVersion = parsePositiveInteger(
      process.env.OOXML_REFERENCE_REAL_E2E_TEMPLATE_VERSION ?? "1",
      "OOXML_REFERENCE_REAL_E2E_TEMPLATE_VERSION",
    );
    const approved = await readApprovedTemplateIdentity(
      selectedTemplateId,
      selectedTemplateVersion,
    );
    await authenticateE2ePage(page, "ooxml-reference-real");
    const option = await requireActualCatalogOption(
      page.request,
      approved.templateId,
      approved.version,
    );
    let previewResponseCount = 0;
    page.on("response", (response) => {
      if (isGenerationPreviewResponse(response)) previewResponseCount += 1;
    });

    await page.goto("/createdeck");
    await page.getByRole("button", { name: "원본 템플릿 충실도" }).click();
    await page
      .getByRole("button", {
        name: `${option.name} 버전 ${option.version} 선택`,
        exact: true,
      })
      .click();
    await page.getByLabel("발표 주제").fill("실제 OOXML 원본 충실도 검증");
    await page.getByLabel("타깃 청중").fill("품질 검수 담당자");
    await page
      .getByLabel("상세 내용 및 컨텍스트")
      .fill(
        "실제 API, queue, Python publication, 제한 편집과 export를 검증합니다.",
      );

    const generationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/v1\/projects\/[^/]+\/ooxml-reference-template-generations$/.test(
          new URL(response.url()).pathname,
        ),
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: "선택한 원본으로 생성" }).click();
    const generationResponse = await generationResponsePromise;
    await expectSuccessfulResponse(generationResponse);
    const generationRequest =
      ooxmlReferenceTemplateGenerationRequestSchema.parse(
        generationResponse.request().postDataJSON(),
      );
    expect(generationRequest.templateSelection).toEqual({
      mode: "user",
      templateId: approved.templateId,
      version: approved.version,
    });
    const generationPayload = (await generationResponse.json()) as {
      job?: unknown;
    };
    const queuedJob = jobSchema.parse(generationPayload.job);

    const completedJob = await waitForTerminalJob(
      page.request,
      queuedJob.jobId,
      15 * 60_000,
    );
    expect(completedJob.status).toBe("succeeded");
    const result = ooxmlReferenceTemplateGenerationJobResultSchema.parse(
      completedJob.result,
    );
    expect(result.templateSnapshot).toMatchObject({
      catalogTemplateId: approved.templateId,
      catalogTemplateVersion: approved.version,
      sourceSha256: approved.sourceSha256,
    });

    await page.waitForURL(
      `/project/${encodeURIComponent(queuedJob.projectId)}`,
      { timeout: 60_000 },
    );
    await expect(
      page.getByRole("region", { name: "Presentation editor" }),
    ).toBeVisible();
    expect(previewResponseCount).toBeGreaterThan(0);

    const generated = await fetchDeck(page.request, queuedJob.projectId);
    expect(generated.metadata.ooxmlReferenceTemplateSnapshot).toMatchObject({
      catalogTemplateId: approved.templateId,
      catalogTemplateVersion: approved.version,
      sourceSha256: approved.sourceSha256,
      generationId: queuedJob.jobId,
    });
    const target = requireEditableTextSlot(generated);
    await selectSlide(page, target.slideId);
    const editor = await beginInlineEditing(
      page,
      generated,
      target.element.elementId,
    );
    const editMarker = ` · 실제편집-${Date.now()}`;
    await moveCaretToEnd(editor);
    await editor.pressSequentially(editMarker);

    const patchResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/v1/projects/${encodeURIComponent(queuedJob.projectId)}/deck/patches`,
      { timeout: 60_000 },
    );
    await editor.press(`${primaryModifier}+S`);
    const patchResponse = await patchResponsePromise;
    await expectSuccessfulResponse(patchResponse);
    await expect(
      page.getByRole("textbox", { name: "텍스트 편집" }),
    ).toHaveCount(0);

    const persisted = await waitForEditedDeck(
      page.request,
      queuedJob.projectId,
      target.element.elementId,
      editMarker,
    );
    const persistedElement = requireElement(
      persisted,
      target.slideId,
      target.element.elementId,
    );
    expect(persistedElement).toMatchObject({
      x: target.element.x,
      y: target.element.y,
      width: target.element.width,
      height: target.element.height,
      rotation: target.element.rotation,
      zIndex: target.element.zIndex,
    });

    const syncState = await waitForZeroWarningSync(
      page.request,
      queuedJob.projectId,
      10 * 60_000,
    );
    const syncedDeck = await fetchDeck(page.request, queuedJob.projectId);
    expect(syncState.deckVersion).toBe(syncedDeck.version);
    expect(syncState.syncedDeckVersion).toBe(syncedDeck.version);
    expect(syncState.warningCount ?? 0).toBe(0);

    const download = await exportPptx(page, queuedJob.projectId);
    const bytes = await readDownload(download);
    expect(download.suggestedFilename()).toMatch(/\.pptx$/i);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.includes(Buffer.from("ppt/presentation.xml"))).toBe(true);
  });
});

type ApprovedTemplateIdentity = {
  templateId: string;
  version: number;
  sourceSha256: string;
};

type EditableTextSlot = {
  slideId: string;
  element: Extract<DeckElement, { type: "text" }>;
};

async function readApprovedTemplateIdentity(
  templateId: string,
  version: number,
): Promise<ApprovedTemplateIdentity> {
  const catalogPath = path.join(
    process.cwd(),
    "services/python-worker/app/ai/design_library/ooxml-reference-templates/catalog.json",
  );
  const value = JSON.parse(await readFile(catalogPath, "utf8")) as {
    templates?: Array<Record<string, unknown>>;
  };
  const template = value.templates?.find(
    (candidate) =>
      candidate.templateId === templateId && candidate.version === version,
  );
  if (!template) {
    throw new Error(
      `Repository catalog does not contain ${templateId}@${version}.`,
    );
  }
  const sourceSha256 = template.sourceSha256;
  if (
    typeof sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sourceSha256)
  ) {
    throw new Error(
      `Repository catalog has no exact source SHA-256 for ${templateId}@${version}.`,
    );
  }
  return { sourceSha256, templateId, version };
}

async function requireActualCatalogOption(
  request: APIRequestContext,
  templateId: string,
  version: number,
) {
  const response = await request.get("/api/v1/ooxml-reference-templates");
  expect(response.ok(), await response.text()).toBe(true);
  const options = ooxmlReferenceTemplateOptionsResponseSchema.parse(
    await response.json(),
  ).options;
  const option = options.find(
    (candidate) =>
      candidate.templateId === templateId && candidate.version === version,
  );
  if (!option) {
    throw new Error(
      `Actual catalog does not expose exact template ${templateId}@${version}.`,
    );
  }
  return option;
}

async function waitForTerminalJob(
  request: APIRequestContext,
  jobId: string,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  for (;;) {
    const response = await request.get(
      `/api/v1/jobs/${encodeURIComponent(jobId)}`,
    );
    expect(response.ok(), await response.text()).toBe(true);
    const job = jobSchema.parse(await response.json());
    if (job.status === "succeeded") return job;
    if (job.status === "failed") {
      throw new Error(
        `OOXML reference generation failed: ${job.error?.code ?? "unknown"}`,
      );
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("OOXML reference generation timed out.");
    }
    await delay(2_000);
  }
}

async function fetchDeck(
  request: APIRequestContext,
  projectId: string,
): Promise<Deck> {
  const response = await request.get(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return getDeckResponseSchema.parse(await response.json()).deck;
}

function requireEditableTextSlot(deck: Deck): EditableTextSlot {
  for (const slide of deck.slides) {
    const element = slide.elements.find(
      (candidate): candidate is Extract<DeckElement, { type: "text" }> =>
        candidate.type === "text" &&
        candidate.locked !== true &&
        candidate.props.text.trim().length > 0,
    );
    if (element) return { element, slideId: slide.slideId };
  }
  throw new Error("Generated Deck has no editable text slot.");
}

async function selectSlide(page: Page, slideId: string): Promise<void> {
  const button = page
    .getByLabel("슬라이드 목록", { exact: true })
    .locator(`button[data-slide-id="${slideId}"]`);
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "true");
}

async function beginInlineEditing(
  page: Page,
  deck: Deck,
  elementId: string,
): Promise<Locator> {
  const stage = page.getByTestId("editor-stage-shell");
  await expect(stage).toBeVisible();
  const stageBox = await stage.boundingBox();
  const debugText = await page
    .getByTestId("editor-elements-debug")
    .textContent();
  const frame = (
    JSON.parse(debugText ?? "[]") as Array<{
      elementId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>
  ).find((candidate) => candidate.elementId === elementId);
  if (!stageBox || !frame) {
    throw new Error(`Unable to locate editable text slot ${elementId}.`);
  }
  const scale = stageBox.width / deck.canvas.width;
  await page.mouse.dblclick(
    stageBox.x + (frame.x + Math.min(20, frame.width / 4)) * scale,
    stageBox.y + (frame.y + Math.min(20, frame.height / 4)) * scale,
  );
  const editor = page.getByRole("textbox", { name: "텍스트 편집" });
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  return editor;
}

async function moveCaretToEnd(editor: Locator): Promise<void> {
  await editor.evaluate((root) => {
    (root as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function waitForEditedDeck(
  request: APIRequestContext,
  projectId: string,
  elementId: string,
  marker: string,
): Promise<Deck> {
  const startedAt = Date.now();
  for (;;) {
    const deck = await fetchDeck(request, projectId);
    const element = deck.slides
      .flatMap((slide) => slide.elements)
      .find((candidate) => candidate.elementId === elementId);
    if (element?.type === "text" && element.props.text.includes(marker)) {
      return deck;
    }
    if (Date.now() - startedAt >= 60_000) {
      throw new Error("Edited text slot was not persisted.");
    }
    await delay(1_000);
  }
}

function requireElement(deck: Deck, slideId: string, elementId: string) {
  const element = deck.slides
    .find((slide) => slide.slideId === slideId)
    ?.elements.find((candidate) => candidate.elementId === elementId);
  if (!element) throw new Error(`Persisted element is missing: ${elementId}.`);
  return element;
}

async function waitForZeroWarningSync(
  request: APIRequestContext,
  projectId: string,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  for (;;) {
    const response = await request.get(
      `/api/v1/projects/${encodeURIComponent(projectId)}/deck/ooxml-sync-state`,
    );
    expect(response.ok(), await response.text()).toBe(true);
    const state = getOoxmlSyncStateResponseSchema.parse(
      await response.json(),
    ).ooxmlSyncState;
    if (state.status === "synced") {
      if ((state.warningCount ?? 0) !== 0) {
        throw new Error("OOXML sync succeeded with warnings.");
      }
      return state;
    }
    if (state.status === "warning" || state.status === "failed") {
      throw new Error(
        `OOXML sync failed closed: ${state.issueCode ?? state.status}.`,
      );
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`OOXML sync timed out in ${state.status} state.`);
    }
    await delay(2_000);
  }
}

async function exportPptx(page: Page, projectId: string): Promise<Download> {
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page.getByRole("menuitem", { name: /^PPTX 내보내기\.\.\./ }).click();
  const dialog = page.getByRole("dialog", { name: "프레젠테이션 내보내기" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: /^PPTX/ }).check();
  const exportResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/projects/${encodeURIComponent(projectId)}/deck/exports`,
    { timeout: 60_000 },
  );
  const downloadPromise = page.waitForEvent("download", {
    timeout: 10 * 60_000,
  });
  await dialog.getByRole("button", { name: "내보내기", exact: true }).click();
  await expectSuccessfulResponse(await exportResponsePromise);
  return downloadPromise;
}

async function readDownload(download: Download): Promise<Buffer> {
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Downloaded PPTX path is unavailable.");
  return readFile(downloadPath);
}

function isGenerationPreviewResponse(response: Response): boolean {
  return (
    response.request().method() === "GET" &&
    /\/api\/v1\/projects\/[^/]+\/ooxml-reference-template-generations\/[^/]+\/preview$/.test(
      new URL(response.url()).pathname,
    )
  );
}

async function expectSuccessfulResponse(response: Response): Promise<void> {
  if (response.ok()) return;
  throw new Error(
    `Request failed with ${response.status()} ${response.statusText()}: ${await response.text()}`,
  );
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
