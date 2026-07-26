import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAgentSearchArguments,
  selectAgentSearchPaths,
} from "./agent-search.mjs";

const config = {
  activeDocs: ["README.md", "docs/current.md"],
  canonicalSources: ["docs/contracts", "packages/shared/src"],
  historicalRoots: ["docs/plans", "docs/qa", "tasks"],
};

test("기본 검색은 운영 코드와 active 문서만 선택한다", () => {
  const selected = selectAgentSearchPaths(
    [
      "README.md",
      "apps/web/src/App.tsx",
      "docs/current.md",
      "docs/contracts/rehearsal.md",
      "docs/plans/old.md",
      "docs/qa/old.md",
      "docs/unlisted.md",
      "package.json",
      "tasks/archive.md",
    ],
    config,
  );

  assert.deepEqual(selected, [
    "README.md",
    "apps/web/src/App.tsx",
    "docs/contracts/rehearsal.md",
    "docs/current.md",
    "package.json",
  ]);
});

test("historical 옵션은 과거 계획과 QA를 추가한다", () => {
  const selected = selectAgentSearchPaths(
    ["docs/plans/old.md", "docs/qa/old.md", "tasks/archive.md"],
    config,
    { historical: true },
  );

  assert.deepEqual(selected, [
    "docs/plans/old.md",
    "docs/qa/old.md",
    "tasks/archive.md",
  ]);
});

test("검색어와 옵션을 안전하게 분리한다", () => {
  assert.deepEqual(
    parseAgentSearchArguments([
      "--historical",
      "--regex",
      "Template(Blueprint)?",
    ]),
    {
      historical: true,
      regex: true,
      root: process.cwd(),
      queryParts: ["Template(Blueprint)?"],
    },
  );
});
