import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFormatStatus,
  isSupportedFormatPath,
  parseFormatCheckArguments,
  parseRenameSources,
  selectFormatFiles,
} from "./format-check.mjs";

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

test("Git name-status 출력에서 rename 원본을 복원한다", () => {
  assert.deepEqual(
    parseRenameSources(
      "R097\0apps/web/src/old.ts\0apps/web/src/runtime/new.ts\0" +
        "M\0apps/web/src/App.tsx\0" +
        "R100\0old.md\0docs/new.md\0",
    ),
    new Map([
      ["apps/web/src/runtime/new.ts", "apps/web/src/old.ts"],
      ["docs/new.md", "old.md"],
    ]),
  );
});

test("현재 파일이 포맷되었으면 base 상태와 무관하게 통과한다", () => {
  assert.equal(
    classifyFormatStatus({
      currentFormatted: true,
      baseExists: false,
      baseFormatted: false,
    }),
    "formatted",
  );
});

test("새 파일과 기존 정상 파일의 포맷 회귀는 실패한다", () => {
  assert.equal(
    classifyFormatStatus({
      currentFormatted: false,
      baseExists: false,
      baseFormatted: false,
    }),
    "regression",
  );
  assert.equal(
    classifyFormatStatus({
      currentFormatted: false,
      baseExists: true,
      baseFormatted: true,
    }),
    "regression",
  );
});

test("base부터 포맷되지 않은 파일은 기존 부채로 분류한다", () => {
  assert.equal(
    classifyFormatStatus({
      currentFormatted: false,
      baseExists: true,
      baseFormatted: false,
    }),
    "legacy",
  );
});

test("명시한 경로만 format check 대상으로 파싱한다", () => {
  assert.deepEqual(
    parseFormatCheckArguments([
      "--base",
      "develop",
      "--path",
      "apps/web/src/App.tsx",
      "--path",
      "docs/current.md",
    ]),
    {
      base: "develop",
      paths: ["apps/web/src/App.tsx", "docs/current.md"],
      trackedOnly: false,
    },
  );
});
