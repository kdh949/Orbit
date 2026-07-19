import { createDemoDeck } from "@orbit/editor-core";
import type { Deck, DeckPatch, ProjectMemberRole } from "@orbit/shared";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from "@playwright/test";

import {
  addAuthenticatedProjectMember,
  createAuthenticatedProject,
} from "./authenticatedProject";

const opaqueOverflowElementIds = [
  "el_quality_opaque_overflow_primary",
  "el_quality_opaque_overflow_secondary",
] as const;
const opaqueOverlapElementIds = [
  "el_quality_opaque_overlap_alpha",
  "el_quality_opaque_overlap_beta",
] as const;
const opaqueGridElementId = "el_quality_opaque_grid_media";

const qualityViewports = [
  { height: 800, width: 320 },
  { height: 1024, width: 768 },
  { height: 768, width: 1024 },
  { height: 900, width: 1440 },
] as const;

type QualityDebugState = {
  currentSlideId: string | null;
  selectedElementIds: string[];
  validationHighlightElementIds: string[];
};

type DeckMutationProbe = {
  deckPuts: Request[];
  patchRequests: Request[];
};

type QualityActor = {
  context: BrowserContext | null;
  page: Page;
};

function createQualityRecoveryDeck(): Deck {
  const deck = structuredClone(createDemoDeck());
  deck.metadata.presentationProfile = "general-inform";

  const firstSlide = deck.slides[0];
  const secondSlide = deck.slides[1];
  const sourceText = firstSlide?.elements.find(
    (element) => element.type === "text",
  );
  const sourceRect = firstSlide?.elements.find(
    (element) => element.type === "rect",
  );

  if (
    !firstSlide ||
    !secondSlide ||
    !sourceText ||
    sourceText.type !== "text" ||
    !sourceRect ||
    sourceRect.type !== "rect"
  ) {
    throw new Error("Demo Deck does not contain the quality fixture sources.");
  }

  const overflowPrimary = structuredClone(sourceText);
  Object.assign(overflowPrimary, {
    elementId: opaqueOverflowElementIds[0],
    height: 60,
    role: "body" as const,
    width: 260,
    x: 120,
    y: 120,
  });
  overflowPrimary.props = {
    ...overflowPrimary.props,
    fontSize: 28,
    lineHeight: 1.4,
    text: "안전 수정으로 텍스트 넘침을 해소하는 본문",
  };

  const overlapAlpha = structuredClone(sourceText);
  Object.assign(overlapAlpha, {
    elementId: opaqueOverlapElementIds[0],
    height: 88,
    role: "body" as const,
    width: 402,
    x: 1_114,
    y: 424,
  });
  overlapAlpha.props = {
    ...overlapAlpha.props,
    fontSize: 22,
    lineHeight: 1.2,
    text: "겹침 경고의 첫 번째 본문입니다",
  };

  const overlapBeta = structuredClone(sourceText);
  Object.assign(overlapBeta, {
    elementId: opaqueOverlapElementIds[1],
    height: 88,
    role: "highlight" as const,
    width: 402,
    x: 1_114,
    y: 424,
  });
  overlapBeta.props = {
    ...overlapBeta.props,
    fontSize: 22,
    lineHeight: 1.2,
    text: "겹침 경고의 두 번째 강조문입니다",
  };

  const offGridMedia = structuredClone(sourceRect);
  Object.assign(offGridMedia, {
    elementId: opaqueGridElementId,
    height: 220,
    role: "media" as const,
    width: 686,
    x: 511.8,
    y: 760,
  });

  firstSlide.elements = [
    overflowPrimary,
    overlapAlpha,
    overlapBeta,
    offGridMedia,
  ];

  const overflowSecondary = structuredClone(sourceText);
  Object.assign(overflowSecondary, {
    elementId: opaqueOverflowElementIds[1],
    height: 60,
    role: "body" as const,
    width: 260,
    x: 120,
    y: 180,
  });
  overflowSecondary.props = {
    ...overflowSecondary.props,
    fontSize: 28,
    lineHeight: 1.4,
    text: "두 번째 슬라이드의 안전 수정 대상 본문",
  };
  secondSlide.elements = [overflowSecondary];

  return deck;
}

function projectDeckPath(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/deck`;
}

function isDeckPatchRequest(request: Request, projectId: string) {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === `${projectDeckPath(projectId)}/patches`
  );
}

function isDeckPutRequest(request: Request, projectId: string) {
  return (
    request.method() === "PUT" &&
    new URL(request.url()).pathname === projectDeckPath(projectId)
  );
}

function readDeckPatch(request: Request): DeckPatch | null {
  try {
    const body = request.postDataJSON() as { patch?: DeckPatch } | null;
    return body?.patch ?? null;
  } catch {
    return null;
  }
}

function observeDeckMutations(
  page: Page,
  projectId: string,
): DeckMutationProbe {
  const probe: DeckMutationProbe = {
    deckPuts: [],
    patchRequests: [],
  };

  page.on("request", (request) => {
    if (isDeckPatchRequest(request, projectId)) {
      probe.patchRequests.push(request);
      return;
    }

    if (isDeckPutRequest(request, projectId)) {
      probe.deckPuts.push(request);
    }
  });

  return probe;
}

function waitForDeckPatchResponse(page: Page, projectId: string) {
  return page.waitForResponse((response) =>
    isDeckPatchRequest(response.request(), projectId),
  );
}

function waitForDeckPutResponse(page: Page, projectId: string) {
  return page.waitForResponse((response) =>
    isDeckPutRequest(response.request(), projectId),
  );
}

async function expectSuccessfulResponse(response: Response) {
  expect(response.ok(), await response.text()).toBe(true);
}

async function createIsolatedPage(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    baseURL:
      typeof testInfo.project.use.baseURL === "string"
        ? testInfo.project.use.baseURL
        : "http://127.0.0.1:5173",
  });

  return { context, page: await context.newPage() };
}

async function createQualityActor(
  browser: Browser,
  ownerPage: Page,
  testInfo: TestInfo,
  options: {
    projectId: string;
    role: ProjectMemberRole;
  },
): Promise<QualityActor> {
  if (options.role === "owner") {
    return { context: null, page: ownerPage };
  }

  const isolated = await createIsolatedPage(browser, testInfo);
  await addAuthenticatedProjectMember(ownerPage, isolated.page, {
    label: `quality-recovery-${options.role}`,
    projectId: options.projectId,
    role: options.role,
  });
  return isolated;
}

async function settleEditorLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolveFrame());
      });
    });
  });
}

async function openEditor(
  page: Page,
  projectId: string,
  viewport = { height: 900, width: 1440 },
) {
  await page.setViewportSize(viewport);
  await page.goto(`/project/${projectId}`);
  await expect(page.getByLabel("Presentation editor")).toBeVisible();
  await expect(page.getByTestId("editor-stage-shell")).toBeVisible();
  await settleEditorLayout(page);
}

async function openValidationPanel(page: Page) {
  const expandButton = page.getByRole("button", {
    name: "오른쪽 패널 펼치기",
    exact: true,
  });
  if (await expandButton.isVisible()) {
    await expandButton.click();
  }

  const validationTab = page.getByRole("tab", {
    name: "검사",
    exact: true,
  });
  if (!(await validationTab.isVisible())) {
    await page
      .getByRole("tab", { name: "AI 어시스턴트", exact: true })
      .click();
  }
  await expect(validationTab).toBeVisible();
  await validationTab.click();
  await expect(validationTab).toHaveAttribute("aria-selected", "true");

  const panel = page.getByTestId("editor-validation-panel");
  await expect(panel).toBeVisible();
  return { panel, validationTab };
}

function validationItem(page: Page, issue: string) {
  return page.locator(
    `[data-testid="editor-validation-item"][data-issue="${issue}"]`,
  );
}

async function readQualityDebug(page: Page): Promise<QualityDebugState> {
  const rawText =
    (await page.getByTestId("editor-quality-debug").textContent()) ?? "null";
  const state = JSON.parse(rawText) as QualityDebugState | null;
  if (!state)
    throw new Error(`Invalid editor quality debug payload: ${rawText}`);
  return state;
}

async function expectQualityDebug(
  page: Page,
  expected: Partial<QualityDebugState>,
) {
  await expect.poll(async () => readQualityDebug(page)).toMatchObject(expected);
}

async function focusTargetWithKeyboard(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const isFocused = await target.evaluate(
      (element) => document.activeElement === element,
    );
    if (isFocused) return;
    await page.keyboard.press("Tab");
  }

  await expect(target).toBeFocused();
}

async function expectNoHorizontalDocumentOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const contentWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        );
        return Math.max(0, Math.ceil(contentWidth - viewportWidth));
      }),
    )
    .toBe(0);
}

function findDeckElement(deck: Deck, elementId: string) {
  return deck.slides
    .flatMap((slide) => slide.elements)
    .find((element) => element.elementId === elementId);
}

function repairRelevantElementSnapshot(deck: Deck, elementId: string) {
  const element = findDeckElement(deck, elementId);
  if (!element || element.type !== "text") {
    throw new Error(`Text element ${elementId} is missing from the Deck.`);
  }

  return {
    height: element.height,
    lineHeight: element.props.lineHeight,
    fontSize: element.props.fontSize,
    role: element.role,
    text: element.props.text,
    width: element.width,
    x: element.x,
    y: element.y,
  };
}

async function expectBulkRepairAndSingleUndo(input: {
  actorPage: Page;
  initialDeck: Deck;
  probe: DeckMutationProbe;
  projectId: string;
}) {
  const { actorPage, initialDeck, probe, projectId } = input;
  const { panel } = await openValidationPanel(actorPage);

  const visiblePanelText = await panel.innerText();
  expect(visiblePanelText).not.toContain("el_quality_opaque_");
  await expect(validationItem(actorPage, "textOverflow")).toHaveCount(2);

  const applyAllButton = panel.getByRole("button", {
    name: "텍스트 넘침 2개 안전 수정",
    exact: true,
  });
  const patchResponsePromise = waitForDeckPatchResponse(actorPage, projectId);
  await applyAllButton.click();
  await expectSuccessfulResponse(await patchResponsePromise);

  await expect(
    actorPage.getByRole("status").filter({
      hasText: "텍스트 넘침 2개를 안전 수정",
    }),
  ).toBeVisible();
  await expect(validationItem(actorPage, "textOverflow")).toHaveCount(0);
  await expect(
    validationItem(actorPage, "FONT_SIZE_BELOW_MINIMUM"),
  ).toHaveCount(0);
  expect(probe.patchRequests).toHaveLength(1);

  const patch = readDeckPatch(probe.patchRequests[0]!);
  expect(patch).not.toBeNull();
  const patchedElementIds = patch!.operations.flatMap((operation) =>
    "elementId" in operation ? [operation.elementId] : [],
  );
  expect(patchedElementIds.length).toBeGreaterThanOrEqual(2);
  expect(new Set(patchedElementIds)).toEqual(new Set(opaqueOverflowElementIds));
  expect(
    patchedElementIds.every((elementId) =>
      opaqueOverflowElementIds.includes(
        elementId as (typeof opaqueOverflowElementIds)[number],
      ),
    ),
  ).toBe(true);

  const undoButton = actorPage.getByRole("button", {
    name: "실행 취소",
    exact: true,
  });
  const redoButton = actorPage.getByRole("button", {
    name: "다시 실행",
    exact: true,
  });
  const undoResponsePromise = waitForDeckPutResponse(actorPage, projectId);
  await undoButton.click();
  const undoResponse = await undoResponsePromise;
  await expectSuccessfulResponse(undoResponse);

  expect(probe.deckPuts).toHaveLength(1);
  const undoPayload = probe.deckPuts[0]!.postDataJSON() as { deck?: Deck };
  expect(undoPayload.deck).toBeDefined();
  for (const elementId of opaqueOverflowElementIds) {
    expect(repairRelevantElementSnapshot(undoPayload.deck!, elementId)).toEqual(
      repairRelevantElementSnapshot(initialDeck, elementId),
    );
  }

  await expect(undoButton).toBeDisabled();
  await expect(redoButton).toBeEnabled();
}

test.describe("P1-3 quality recovery", () => {
  for (const role of ["owner", "editor"] as const) {
    test(`${role} repairs two overflows with one patch and restores both with one Undo`, async ({
      browser,
      page: ownerPage,
    }, testInfo) => {
      const initialDeck = createQualityRecoveryDeck();
      const { project } = await createAuthenticatedProject(ownerPage, {
        deck: initialDeck,
        label: `quality-recovery-${role}-repair-owner`,
      });
      const actor = await createQualityActor(browser, ownerPage, testInfo, {
        projectId: project.projectId,
        role,
      });

      try {
        const probe = observeDeckMutations(actor.page, project.projectId);
        await openEditor(actor.page, project.projectId);
        await expectBulkRepairAndSingleUndo({
          actorPage: actor.page,
          initialDeck,
          probe,
          projectId: project.projectId,
        });
      } finally {
        await actor.context?.close();
      }
    });
  }

  test("Viewer inspects validation targets without mutation actions or requests", async ({
    browser,
    page: ownerPage,
  }, testInfo) => {
    const { project } = await createAuthenticatedProject(ownerPage, {
      deck: createQualityRecoveryDeck(),
      label: "quality-recovery-viewer-owner",
    });
    const actor = await createQualityActor(browser, ownerPage, testInfo, {
      projectId: project.projectId,
      role: "viewer",
    });

    try {
      const probe = observeDeckMutations(actor.page, project.projectId);
      await openEditor(actor.page, project.projectId);
      const { panel } = await openValidationPanel(actor.page);
      const overlapItem = validationItem(actor.page, "textOverlap").first();
      const overlapTarget = overlapItem.getByTestId("editor-validation-target");

      await expect(overlapTarget).toBeVisible();
      expect(await panel.innerText()).not.toContain("el_quality_opaque_");
      await expect(
        panel.getByRole("button", { name: /안전 수정/ }),
      ).toHaveCount(0);

      await overlapTarget.hover();
      await expectQualityDebug(actor.page, {
        validationHighlightElementIds: [...opaqueOverlapElementIds],
      });
      await overlapTarget.click();
      await expectQualityDebug(actor.page, {
        currentSlideId: "slide_1",
        selectedElementIds: [...opaqueOverlapElementIds],
      });

      expect(probe.patchRequests).toEqual([]);
      expect(probe.deckPuts).toEqual([]);
    } finally {
      await actor.context?.close();
    }
  });

  test("overlap and grid guidance select their targets but stay outside bulk repair", async ({
    page,
  }) => {
    const { project } = await createAuthenticatedProject(page, {
      deck: createQualityRecoveryDeck(),
      label: "quality-recovery-manual-guidance",
    });
    const probe = observeDeckMutations(page, project.projectId);
    await openEditor(page, project.projectId);
    const { panel } = await openValidationPanel(page);
    const overlapItem = validationItem(page, "textOverlap").first();
    const gridItem = validationItem(
      page,
      "GRID_ALIGNMENT_INCONSISTENT",
    ).first();

    await expect(overlapItem).toContainText(/이동|크기 조정/);
    await expect(gridItem).toContainText(/12열.*8px/);
    await overlapItem.getByTestId("editor-validation-target").click();
    await expectQualityDebug(page, {
      selectedElementIds: [...opaqueOverlapElementIds],
    });
    await gridItem.getByTestId("editor-validation-target").click();
    await expectQualityDebug(page, {
      selectedElementIds: [opaqueGridElementId],
    });

    const applyAllButton = panel.getByRole("button", {
      name: "텍스트 넘침 2개 안전 수정",
      exact: true,
    });
    await expect(applyAllButton).toBeVisible();
    expect(probe.patchRequests).toEqual([]);
    expect(probe.deckPuts).toEqual([]);
  });

  test("validation navigation saves a dirty speaker note draft before focusing the target", async ({
    page,
  }) => {
    const { project } = await createAuthenticatedProject(page, {
      deck: createQualityRecoveryDeck(),
      label: "quality-recovery-dirty-notes",
    });
    const probe = observeDeckMutations(page, project.projectId);
    await openEditor(page, project.projectId);
    await openValidationPanel(page);

    await page
      .getByRole("button", { name: "발표 메모 펼치기", exact: true })
      .click();
    await page
      .getByRole("group", { name: /대본.*더블클릭.*편집/ })
      .dblclick();
    const notesEditor = page.getByLabel("발표 메모 수정", { exact: true });
    const dirtyDraft = "저장하지 않은 quality recovery 발표 메모";
    await notesEditor.fill(dirtyDraft);

    const secondSlideOverflow = validationItem(page, "textOverflow")
      .filter({ hasText: "2번 슬라이드" })
      .getByTestId("editor-validation-target");
    const notesSaveResponsePromise = waitForDeckPatchResponse(
      page,
      project.projectId,
    );
    await secondSlideOverflow.click();
    await expectSuccessfulResponse(await notesSaveResponsePromise);

    await expectQualityDebug(page, { currentSlideId: "slide_2" });
    expect(probe.patchRequests).toHaveLength(1);
    expect(readDeckPatch(probe.patchRequests[0]!)).toEqual(
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            slideId: "slide_1",
            speakerNotes: dirtyDraft,
            type: "update_speaker_notes",
          }),
        ],
      }),
    );
    expect(probe.deckPuts).toEqual([]);
  });

  for (const viewport of qualityViewports) {
    test(`keyboard-only target focus and highlight stay stable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      const { project } = await createAuthenticatedProject(page, {
        deck: createQualityRecoveryDeck(),
        label: `quality-recovery-keyboard-${viewport.width}x${viewport.height}`,
      });
      const probe = observeDeckMutations(page, project.projectId);
      await openEditor(page, project.projectId, viewport);
      const { panel, validationTab } = await openValidationPanel(page);
      const overflowItem = validationItem(page, "textOverflow")
        .filter({ hasText: "1번 슬라이드" })
        .first();
      const target = overflowItem.getByTestId("editor-validation-target");

      expect(await panel.innerText()).not.toContain("el_quality_opaque_");
      if (!validationTab) {
        throw new Error("Owner validation tab was not rendered.");
      }
      await validationTab.focus();
      await focusTargetWithKeyboard(page, target);
      await expect(target).toBeFocused();
      await expectQualityDebug(page, {
        validationHighlightElementIds: [opaqueOverflowElementIds[0]],
      });
      await page.keyboard.press("Enter");
      await expectQualityDebug(page, {
        currentSlideId: "slide_1",
        selectedElementIds: [opaqueOverflowElementIds[0]],
      });
      await expectNoHorizontalDocumentOverflow(page);
      expect(probe.patchRequests).toEqual([]);
      expect(probe.deckPuts).toEqual([]);
    });
  }
});
