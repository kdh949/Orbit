import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

import { createDemoDeck } from "@orbit/editor-core";
import { expect, test, type Download, type Page } from "@playwright/test";

import { createAuthenticatedProject } from "./authenticatedProject";

test.describe("editor export downloads", () => {
  test("downloads materialized PPTX and PNG ZIP artifacts", async ({ page }) => {
    test.setTimeout(180_000);
    const deck = structuredClone(createDemoDeck());
    deck.title = "Export reliability";
    for (const slide of deck.slides) slide.animations = [];
    const { project } = await createAuthenticatedProject(page, {
      deck,
      label: "export-download",
    });

    await page.goto(`/project/${project.projectId}`);
    await expect(page.getByLabel("Presentation editor")).toBeVisible();

    await updateDeckTitle(page, "Export reliability PPTX");
    const pptx = await exportFromDialog(page, "PPTX 내보내기...", "PPTX");
    const pptxBytes = await downloadBytes(pptx);
    expect(pptx.suggestedFilename()).toMatch(/\.pptx$/i);
    expect(pptxBytes.subarray(0, 2).toString()).toBe("PK");
    expect(pptxBytes.includes(Buffer.from("ppt/presentation.xml"))).toBe(true);

    await updateDeckTitle(page, "Export reliability PNG");
    const png = await exportFromDialog(page, "PNG ZIP 내보내기...", "PNG ZIP");
    const pngZipBytes = await downloadBytes(png);
    expect(png.suggestedFilename()).toMatch(/\.zip$/i);
    expect(pngZipBytes.subarray(0, 2).toString()).toBe("PK");
    const pngEntries = readZipEntries(pngZipBytes).filter(({ name }) =>
      name.endsWith(".png"),
    );
    expect(pngEntries).toHaveLength(deck.slides.length);
    for (const { body } of pngEntries) {
      expect(body.subarray(0, 4)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      );
    }
  });
});

async function exportFromDialog(
  page: Page,
  menuItem: string,
  formatName: string,
): Promise<Download> {
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .getByRole("menuitem", { name: new RegExp(`^${escapeRegex(menuItem)}`) })
    .click();
  const dialog = page.getByRole("dialog", { name: "프레젠테이션 내보내기" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: new RegExp(`^${formatName}`) }).check();

  const exportResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/deck/exports"),
    { timeout: 30_000 },
  );
  const downloadPromise = page.waitForEvent("download", { timeout: 150_000 });
  await dialog.getByRole("button", { name: "내보내기", exact: true }).click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  return downloadPromise;
}

async function updateDeckTitle(page: Page, title: string): Promise<void> {
  await page.getByLabel("프레젠테이션 제목 수정").click();
  const input = page.getByRole("textbox", {
    name: "프레젠테이션 제목",
    exact: true,
  });
  await input.fill(title);
  await input.press("Enter");
  await expect(
    page.locator(".editor-document-title").getByText("저장됨", { exact: true }),
  ).toBeVisible();
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("Downloaded artifact path is unavailable.");
  return readFile(path);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readZipEntries(bytes: Buffer): Array<{ name: string; body: Buffer }> {
  const entries: Array<{ name: string; body: Buffer }> = [];
  const centralDirectorySignature = 0x02014b50;
  const localFileSignature = 0x04034b50;

  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== centralDirectorySignature) continue;

    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    expect(bytes.readUInt32LE(localOffset)).toBe(localFileSignature);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressedBody = bytes.subarray(
      dataOffset,
      dataOffset + compressedSize,
    );
    const body =
      compressionMethod === 0
        ? compressedBody
        : compressionMethod === 8
          ? inflateRawSync(compressedBody)
          : (() => {
              throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
            })();
    entries.push({ name, body });
    offset += 45 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}
