import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFormatStatus,
  isLegacyFormatFragment,
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

test("Git name-status 출력에서 rename과 copy 원본을 복원한다", () => {
  assert.deepEqual(
    parseRenameSources(
      "R097\0apps/web/src/old.ts\0apps/web/src/runtime/new.ts\0" +
        "M\0apps/web/src/App.tsx\0" +
        "R100\0old.md\0docs/new.md\0" +
        "C099\0apps/web/src/Legacy.tsx\0apps/web/src/Controller.tsx\0",
    ),
    new Map([
      ["apps/web/src/runtime/new.ts", "apps/web/src/old.ts"],
      ["docs/new.md", "old.md"],
      ["apps/web/src/Controller.tsx", "apps/web/src/Legacy.tsx"],
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

test("기존 포맷 부채에서 그대로 추출한 새 fragment는 부채를 승계한다", () => {
  const legacySource = ".legacy { color: red; }\n\n.next { color: blue; }\n";
  const extracted = ".next { color: blue; }\n";

  assert.equal(isLegacyFormatFragment(extracted, [legacySource]), true);
  assert.equal(
    classifyFormatStatus({
      currentFormatted: false,
      baseExists: false,
      baseFormatted: false,
      extractedFromLegacy: true,
    }),
    "legacy",
  );
  assert.equal(
    isLegacyFormatFragment(".next { color: green; }\n", [legacySource]),
    false,
  );
});

test("기존 문서의 section을 재배치한 domain 문서는 부채를 승계한다", () => {
  const legacySource = [
    "# Legacy",
    "",
    "## Deck",
    "",
    "deck contract",
    "",
    "## Job",
    "",
    "job contract",
    "",
  ].join("\n");
  const extracted = [
    "# Domain",
    "",
    "> canonical index",
    "",
    "## Job",
    "",
    "job contract",
    "",
    "## Deck",
    "",
    "deck contract",
    "",
  ].join("\n");

  assert.equal(isLegacyFormatFragment(extracted, [legacySource]), true);
  assert.equal(
    isLegacyFormatFragment(extracted.replace("deck contract", "changed"), [
      legacySource,
    ]),
    false,
  );
});

test("문서 이동에 필요한 상대 link prefix만 legacy section에서 허용한다", () => {
  const legacySource = [
    "## Persistence",
    "",
    "[API](api/deck-persistence.md)를 따른다.",
    "",
  ].join("\n");
  const moved = [
    "# Deck",
    "",
    "## Persistence",
    "",
    "[API](../api/deck-persistence.md)를 따른다.",
    "",
  ].join("\n");

  assert.equal(isLegacyFormatFragment(moved, [legacySource]), true);
  assert.equal(
    isLegacyFormatFragment(moved.replace("를 따른다.", "를 바꾼다."), [
      legacySource,
    ]),
    false,
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
