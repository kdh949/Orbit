import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("font manifest contains fifteen licensed families with valid checksums", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "assets/manifest.json"), "utf8"));
  assert.equal(manifest.fonts.length, 15);
  assert.equal(new Set(manifest.fonts.map((font) => font.id)).size, 15);
  assert.equal(new Set(manifest.fonts.map((font) => font.family)).size, 15);

  for (const font of manifest.fonts) {
    assert.ok(font.faces.some((face) => face.kind === "web"));
    assert.ok(font.faces.some((face) => face.kind === "desktop"));
    const desktopFaces = font.faces.filter((face) => face.kind === "desktop");
    assert.ok(desktopFaces.length <= 2, `${font.family} desktop faces must be full fonts, not unicode chunks`);
    assert.ok(desktopFaces.every((face) => !face.unicodeRange));
    for (const face of font.faces) {
      const root = face.kind === "web" ? "web" : "desktop";
      const bytes = await readFile(join(packageRoot, "assets", root, face.filename));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), face.sha256);
    }
    const license = await readFile(join(packageRoot, "assets/licenses", font.license.filename));
    assert.equal(createHash("sha256").update(license).digest("hex"), font.license.sha256);
  }
});
