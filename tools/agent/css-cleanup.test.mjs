import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { cleanupCssBundles } from "./css-cleanup.mjs";

function writeFixture(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("bundle 내부의 완전 동일 rule과 빈 rule만 제거한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-css-cleanup-"));
  writeFixture(
    root,
    "styles.css",
    '@import "./styles/base.css";\n@import "./styles/override.css";\n',
  );
  writeFixture(
    root,
    "styles/base.css",
    [
      ".card { color: red; }",
      ".empty {}",
      "@media (max-width: 800px) {",
      "  .card { display: grid; }",
      "}",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    "styles/override.css",
    [
      ".card { color: red; }",
      "@media (max-width: 800px) {",
      "  .card { display: grid; }",
      "}",
      "@media (min-width: 801px) {",
      "  .card { display: grid; }",
      "}",
      "",
    ].join("\n"),
  );

  const [report] = await cleanupCssBundles(root, ["styles.css"], {
    write: true,
  });

  assert.equal(report.duplicateRuleCount, 2);
  assert.equal(report.emptyRuleCount, 1);
  assert.equal(report.removalCount, 3);
  const cleanedBase = readFileSync(join(root, "styles/base.css"), "utf8");
  assert.doesNotMatch(cleanedBase, /card|empty/);
  assert.doesNotMatch(cleanedBase, /^[ \t]+$/m);
  assert.match(
    readFileSync(join(root, "styles/override.css"), "utf8"),
    /@media \(min-width: 801px\)/,
  );

  const [idempotent] = await cleanupCssBundles(root, ["styles.css"], {
    write: true,
  });
  assert.equal(idempotent.removalCount, 0);
  assert.equal(idempotent.fingerprint, report.fingerprint);
});

test("서로 독립적인 entry bundle 사이의 동일 rule은 제거하지 않는다", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-css-entry-boundary-"));
  writeFixture(root, "first.css", ".shared { color: red; }\n");
  writeFixture(root, "second.css", ".shared { color: red; }\n");

  const reports = await cleanupCssBundles(root, ["first.css", "second.css"], {
    write: true,
  });

  assert.deepEqual(
    reports.map(({ removalCount }) => removalCount),
    [0, 0],
  );
  assert.match(readFileSync(join(root, "first.css"), "utf8"), /\.shared/);
  assert.match(readFileSync(join(root, "second.css"), "utf8"), /\.shared/);
});

test("production CSS bundle의 no-op cleanup과 cascade fingerprint를 고정한다", async () => {
  const repositoryRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const reports = await cleanupCssBundles(repositoryRoot);

  assert.deepEqual(
    reports.map(({ entryPath, fingerprint, removalCount }) => ({
      entryPath,
      fingerprint,
      removalCount,
    })),
    [
      {
        entryPath: "apps/web/src/features/editor/editor-shell.css",
        fingerprint:
          "ec6417cdbf6185184ece4c84dfba7dba3f235b9f558ea55bc336f6ef38242694",
        removalCount: 0,
      },
      {
        entryPath: "apps/web/src/styles.css",
        fingerprint:
          "0c8730ae45b1dd2eaa1011b144389ca8afb7c5a6532c40823c146464c07e1f11",
        removalCount: 0,
      },
    ],
  );
});
