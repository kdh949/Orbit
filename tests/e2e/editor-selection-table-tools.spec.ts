import { createDemoDeck } from "@orbit/editor-core";
import type { Deck, TableElement } from "@orbit/shared";
import { expect, test, type Page, type Response } from "@playwright/test";

import { createAuthenticatedProject } from "./authenticatedProject";

const canvasWidth = 1920;

type ElementFrameSnapshot = {
  elementId: string;
  height: number;
  width: number;
  x: number;
  y: number;
};

function projectDeckPath(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/deck`;
}

function isDeckMutationResponse(response: Response, projectId: string) {
  const request = response.request();
  const path = new URL(response.url()).pathname;
  return (
    (request.method() === "POST" &&
      path === `${projectDeckPath(projectId)}/patches`) ||
    (request.method() === "PUT" && path === projectDeckPath(projectId))
  );
}

async function waitForDeckMutation(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.ok() && isDeckMutationResponse(response, projectId),
  );
}

async function fetchPersistedDeck(page: Page, projectId: string) {
  const response = await page.request.get(projectDeckPath(projectId));
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { deck: Deck }).deck;
}

async function openEditor(page: Page, projectId: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/project/${projectId}`);
  await expect(page.getByLabel("Presentation editor")).toBeVisible();
  await expect(page.getByTestId("editor-stage-shell")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function getElementFrames(page: Page) {
  const raw =
    (await page.getByTestId("editor-elements-debug").textContent()) ?? "[]";
  return JSON.parse(raw) as ElementFrameSnapshot[];
}

async function expectSuccessfulMutation(response: Response) {
  expect(response.ok(), await response.text()).toBe(true);
}

async function dragCanvasRange(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const stageBox = await page.getByTestId("editor-stage-shell").boundingBox();
  if (!stageBox) throw new Error("Editor stage shell was not rendered.");
  const scale = stageBox.width / canvasWidth;
  await page.mouse.move(
    stageBox.x + start.x * scale,
    stageBox.y + start.y * scale,
  );
  await page.mouse.down();
  await page.mouse.move(
    stageBox.x + end.x * scale,
    stageBox.y + end.y * scale,
    { steps: 8 },
  );
  await page.mouse.up();
}

async function clickCanvasPoint(page: Page, x: number, y: number) {
  const stageBox = await page.getByTestId("editor-stage-shell").boundingBox();
  if (!stageBox) throw new Error("Editor stage shell was not rendered.");
  const scale = stageBox.width / canvasWidth;
  await page.mouse.click(stageBox.x + x * scale, stageBox.y + y * scale);
}

async function doubleClickCanvasPoint(page: Page, x: number, y: number) {
  const stageBox = await page.getByTestId("editor-stage-shell").boundingBox();
  if (!stageBox) throw new Error("Editor stage shell was not rendered.");
  const scale = stageBox.width / canvasWidth;
  await page.mouse.dblclick(stageBox.x + x * scale, stageBox.y + y * scale);
}

function selectionDeck() {
  const deck = structuredClone(createDemoDeck());
  const slide = deck.slides[0]!;
  const first = slide.elements.find((element) => element.elementId === "el_1")!;
  const second = slide.elements.find(
    (element) => element.elementId === "el_2",
  )!;
  Object.assign(first, { x: 200, y: 120, width: 220, height: 100 });
  Object.assign(second, { x: 540, y: 280, width: 280, height: 120 });
  slide.elements = [first, second];
  return deck;
}

function tableDeck() {
  const deck = structuredClone(createDemoDeck());
  const cell = (text: string) => ({
    align: "left" as const,
    borderColor: "#CBD5E1",
    borderWidth: 1,
    colSpan: 1,
    fill: "#FFFFFF",
    fontSize: 18,
    fontWeight: "normal" as const,
    rowSpan: 1,
    text,
    textColor: "#111827",
    verticalAlign: "middle" as const,
  });
  const table: TableElement = {
    elementId: "el_table",
    height: 320,
    locked: false,
    opacity: 1,
    props: {
      borderColor: "#94A3B8",
      borderWidth: 1,
      columnWidths: [320, 320],
      rowHeights: [160, 160],
      rows: [
        [cell("A1"), cell("B1")],
        [cell("A2"), cell("B2")],
      ],
    },
    rotation: 0,
    type: "table",
    visible: true,
    width: 640,
    x: 300,
    y: 180,
    zIndex: 1,
  };
  deck.slides[0]!.elements = [table];
  return deck;
}

function persistedTable(deck: Deck) {
  const table = deck.slides[0]?.elements.find(
    (element): element is TableElement => element.elementId === "el_table",
  );
  if (!table) throw new Error("Persisted table was not found.");
  return table;
}

test.describe("editor selection and table tools", () => {
  test("marquee selection avoids render-phase errors and all alignment commands persist", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    const { project } = await createAuthenticatedProject(page, {
      deck: selectionDeck(),
      label: "selection-alignment",
    });
    await openEditor(page, project.projectId);
    const initialFrames = await getElementFrames(page);

    await dragCanvasRange(page, { x: 80, y: 60 }, { x: 900, y: 460 });
    const quickbar = page.getByTestId("editor-multi-selection-quickbar");
    await expect(quickbar).toContainText("2개 선택됨");

    const alignmentNames = [
      "왼쪽 정렬",
      "가로 가운데 정렬",
      "오른쪽 정렬",
      "위쪽 정렬",
      "세로 가운데 정렬",
      "아래쪽 정렬",
    ] as const;
    const undo = page.getByRole("button", { name: "실행 취소", exact: true });

    for (const name of alignmentNames.slice(0, -1)) {
      const mutation = waitForDeckMutation(page, project.projectId);
      await quickbar.getByRole("button", { name, exact: true }).click();
      await expectSuccessfulMutation(await mutation);
      const undoMutation = waitForDeckMutation(page, project.projectId);
      await undo.click();
      await expectSuccessfulMutation(await undoMutation);
      await expect.poll(() => getElementFrames(page)).toEqual(initialFrames);
      await dragCanvasRange(page, { x: 80, y: 60 }, { x: 900, y: 460 });
      await expect(quickbar).toContainText("2개 선택됨");
    }

    const finalMutation = waitForDeckMutation(page, project.projectId);
    await quickbar
      .getByRole("button", { name: "아래쪽 정렬", exact: true })
      .click();
    await expectSuccessfulMutation(await finalMutation);
    const alignedFrames = await getElementFrames(page);
    expect(alignedFrames.map((frame) => frame.y + frame.height)).toEqual([
      400, 400,
    ]);
    await expect(
      page
        .locator(".editor-document-title")
        .getByText("저장됨", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("editor-stage-shell")).toBeVisible();
    await expect.poll(() => getElementFrames(page)).toEqual(alignedFrames);
    expect(
      consoleErrors.filter((message) =>
        /Cannot update a component while rendering|render phase update/i.test(
          message,
        ),
      ),
    ).toEqual([]);
  });

  test("rectangular table selection merges, undoes, redoes, reloads, and unmerges", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const { project } = await createAuthenticatedProject(page, {
      deck: tableDeck(),
      label: "table-cell-merge",
    });
    await openEditor(page, project.projectId);

    await clickCanvasPoint(page, 460, 260);
    await expect(page.getByTestId("editor-element-quickbar")).toBeVisible();
    await doubleClickCanvasPoint(page, 460, 260);
    const cellEditor = page.getByRole("textbox", {
      name: "표 1행 1열 셀 편집",
      exact: true,
    });
    await expect(cellEditor).toBeVisible();
    await cellEditor.press("Escape");
    await page.keyboard.down("Shift");
    await clickCanvasPoint(page, 780, 420);
    await page.keyboard.up("Shift");

    await expect(
      page.getByText("4개 셀 선택됨", { exact: true }),
    ).toBeVisible();
    const merge = page.getByRole("button", { name: "셀 병합", exact: true });
    await expect(merge).toBeEnabled();
    const mergeMutation = waitForDeckMutation(page, project.projectId);
    await merge.click();
    await expectSuccessfulMutation(await mergeMutation);
    await expect
      .poll(async () => {
        const table = persistedTable(
          await fetchPersistedDeck(page, project.projectId),
        );
        return {
          colSpan: table.props.rows[0]![0]!.colSpan,
          rowSpan: table.props.rows[0]![0]!.rowSpan,
        };
      })
      .toEqual({ colSpan: 2, rowSpan: 2 });

    const undo = page.getByRole("button", { name: "실행 취소", exact: true });
    const redo = page.getByRole("button", { name: "다시 실행", exact: true });
    const undoMutation = waitForDeckMutation(page, project.projectId);
    await undo.click();
    await expectSuccessfulMutation(await undoMutation);
    await expect
      .poll(
        async () =>
          persistedTable(await fetchPersistedDeck(page, project.projectId))
            .props.rows[0]![0]!.colSpan,
      )
      .toBe(1);

    const redoMutation = waitForDeckMutation(page, project.projectId);
    await redo.click();
    await expectSuccessfulMutation(await redoMutation);
    await expect
      .poll(
        async () =>
          persistedTable(await fetchPersistedDeck(page, project.projectId))
            .props.rows[0]![0]!.colSpan,
      )
      .toBe(2);

    await page.reload();
    await expect(page.getByTestId("editor-stage-shell")).toBeVisible();
    await clickCanvasPoint(page, 460, 260);
    const unmerge = page.getByRole("button", {
      name: "병합 해제",
      exact: true,
    });
    await expect(unmerge).toBeEnabled();
    const unmergeMutation = waitForDeckMutation(page, project.projectId);
    await unmerge.click();
    await expectSuccessfulMutation(await unmergeMutation);
    await expect
      .poll(async () => {
        const rows = persistedTable(
          await fetchPersistedDeck(page, project.projectId),
        ).props.rows;
        return rows.flat().map((cell) => ({
          colSpan: cell.colSpan,
          rowSpan: cell.rowSpan,
          text: cell.text,
        }));
      })
      .toEqual([
        { colSpan: 1, rowSpan: 1, text: "A1" },
        { colSpan: 1, rowSpan: 1, text: "B1" },
        { colSpan: 1, rowSpan: 1, text: "A2" },
        { colSpan: 1, rowSpan: 1, text: "B2" },
      ]);
  });
});
