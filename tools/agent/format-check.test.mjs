import assert from "node:assert/strict";
import test from "node:test";

import { isSupportedFormatPath, selectFormatFiles } from "./format-check.mjs";

test("Prettier가 지원하는 변경 소스와 문서를 선택한다", () => {
  assert.equal(isSupportedFormatPath("apps/web/src/App.tsx"), true);
  assert.equal(isSupportedFormatPath("docs/architecture/overview.md"), true);
  assert.equal(isSupportedFormatPath("package.json"), true);
  assert.equal(
    isSupportedFormatPath("services/python-worker/app/main.py"),
    false,
  );
});

test("생성물과 dependency 디렉터리는 제외한다", () => {
  assert.equal(isSupportedFormatPath("apps/web/dist/index.js"), false);
  assert.equal(isSupportedFormatPath("node_modules/example/index.js"), false);
  assert.equal(isSupportedFormatPath("coverage/report.json"), false);
});

test("변경 경로를 중복 제거하고 존재하는 파일만 정렬한다", () => {
  const existing = new Set(["README.md", "apps/web/src/App.tsx"]);
  const selected = selectFormatFiles(
    [
      "apps/web/src/App.tsx",
      "README.md",
      "README.md",
      "deleted-file.ts",
      "services/python-worker/app/main.py",
    ],
    (path) => existing.has(path),
  );

  assert.deepEqual(selected, ["apps/web/src/App.tsx", "README.md"]);
});
