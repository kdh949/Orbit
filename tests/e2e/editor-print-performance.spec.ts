import { createDemoDeck } from "@orbit/editor-core";
import { expect, test, type Page } from "@playwright/test";

import { createAuthenticatedProject } from "./authenticatedProject";

const slideCount = 9;
const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";

type PrintSnapshot = {
  canvasCount: number;
  dimensions: Array<{ height: number; width: number }>;
  totalPixels: number;
};

type PrintProbe = {
  callCount: number;
  snapshots: PrintSnapshot[];
};

function createPrintDeck() {
  const deck = createDemoDeck();
  const sourceSlide = deck.slides[0];
  if (!sourceSlide) throw new Error("Print fixture requires one slide.");
  deck.slides = Array.from({ length: slideCount }, (_, index) => ({
    ...structuredClone(sourceSlide),
    order: index + 1,
    slideId: `slide_print_${index + 1}`,
    title: `인쇄 장표 ${index + 1}`,
  }));
  return deck;
}

async function installPrintProbe(page: Page) {
  await page.addInitScript(() => {
    const probeWindow = window as typeof window & {
      __ORBIT_PRINT_PROBE__?: PrintProbe;
    };
    probeWindow.__ORBIT_PRINT_PROBE__ = { callCount: 0, snapshots: [] };
    Object.defineProperty(window, "print", {
      configurable: true,
      value: () => {
        const canvases = Array.from(
          document.querySelectorAll<HTMLCanvasElement>(
            ".editor-print-deck canvas",
          ),
        );
        const dimensions = canvases.map((canvas) => ({
          height: canvas.height,
          width: canvas.width,
        }));
        const probe = probeWindow.__ORBIT_PRINT_PROBE__!;
        probe.callCount += 1;
        probe.snapshots.push({
          canvasCount: canvases.length,
          dimensions,
          totalPixels: dimensions.reduce(
            (sum, dimension) => sum + dimension.width * dimension.height,
            0,
          ),
        });
        window.dispatchEvent(new Event("afterprint"));
      },
    });
  });
}

async function getPrintProbe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __ORBIT_PRINT_PROBE__?: PrintProbe;
        }
      ).__ORBIT_PRINT_PROBE__,
  );
}

test("mounts DPR 1 print canvases only for active print requests", async ({
  page,
}) => {
  const deck = createPrintDeck();
  const { project } = await createAuthenticatedProject(page, {
    deck,
    label: "editor-print-performance",
  });
  await installPrintProbe(page);
  await page.goto(`/project/${project.projectId}`);
  await expect(page.getByLabel("Presentation editor")).toBeVisible();
  await expect(page.locator(".editor-print-deck canvas")).toHaveCount(0);

  await page.getByRole("button", { name: "인쇄", exact: true }).click();
  await expect.poll(async () => (await getPrintProbe(page))?.callCount).toBe(1);
  const toolbarSnapshot = (await getPrintProbe(page))?.snapshots[0];
  expect(toolbarSnapshot?.canvasCount).toBe(slideCount);
  expect(toolbarSnapshot?.dimensions).toEqual(
    Array.from({ length: slideCount }, () => ({ height: 1080, width: 1920 })),
  );
  expect(toolbarSnapshot?.totalPixels).toBeLessThanOrEqual(
    slideCount * 1920 * 1080,
  );
  await expect(page.locator(".editor-print-deck canvas")).toHaveCount(0);

  await page.keyboard.press(`${primaryModifier}+P`);
  await expect.poll(async () => (await getPrintProbe(page))?.callCount).toBe(2);
  await expect(page.locator(".editor-print-deck canvas")).toHaveCount(0);

  await page.getByRole("button", { name: "명령 검색", exact: true }).click();
  await page.getByRole("textbox", { name: "명령 검색어" }).fill("인쇄");
  await page.getByRole("option", { name: "인쇄", exact: true }).click();
  await expect.poll(async () => (await getPrintProbe(page))?.callCount).toBe(3);
  await expect(page.locator(".editor-print-deck canvas")).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.locator(".editor-print-deck canvas")).toHaveCount(slideCount);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".editor-print-deck canvas")).toHaveCount(0);
});
