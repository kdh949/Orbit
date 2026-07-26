import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildImportGraph,
  collectDependencyClosure,
  reverseImportGraph,
} from "./import-graph.mjs";
import {
  classifyWorkspace,
  findNearestFile,
  matchesRepoGlob,
  normalizeRepoPath,
} from "./repo-path.mjs";

function writeFixture(root, path, content = "") {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

test("repository 경로와 workspace를 일관되게 분류한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-path-"));
  writeFixture(root, "apps/web/AGENTS.md", "# Web\n");
  writeFixture(root, "apps/web/src/App.tsx");

  assert.equal(
    normalizeRepoPath(root, join(root, "apps/web/src/App.tsx")),
    "apps/web/src/App.tsx",
  );
  assert.equal(
    findNearestFile(root, "apps/web/src/App.tsx", "AGENTS.md", (path) =>
      path.endsWith("apps/web/AGENTS.md"),
    ),
    "apps/web/AGENTS.md",
  );
  assert.deepEqual(classifyWorkspace("apps/web/src/App.tsx"), {
    area: "web",
    language: "typescript",
    packageName: "@orbit/web",
    root: "apps/web",
  });
});

test("domain owned path glob의 이중 별표를 지원한다", () => {
  assert.equal(
    matchesRepoGlob(
      "apps/web/src/runtime/speech/stt/liveStt.ts",
      "apps/web/src/runtime/speech/**",
    ),
    true,
  );
  assert.equal(
    matchesRepoGlob("apps/web/src/App.tsx", "apps/web/src/features/*/*.tsx"),
    false,
  );
});

test("상대 import와 @orbit package import graph를 연결한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-import-"));
  writeFixture(
    root,
    "apps/web/src/App.tsx",
    'import { helper } from "./helper";\nimport { schema } from "@orbit/shared/rehearsals";\n',
  );
  writeFixture(root, "apps/web/src/helper.ts", "export const helper = 1;\n");
  writeFixture(
    root,
    "packages/shared/src/rehearsals/index.ts",
    "export const schema = 1;\n",
  );

  const graph = buildImportGraph(root, { includeTests: true });
  assert.deepEqual([...graph.get("apps/web/src/App.tsx")].sort(), [
    "apps/web/src/helper.ts",
    "packages/shared/src/rehearsals/index.ts",
  ]);
  assert.deepEqual(
    [...reverseImportGraph(graph).get("apps/web/src/helper.ts")],
    ["apps/web/src/App.tsx"],
  );
  assert.equal(collectDependencyClosure(graph, "apps/web/src/App.tsx").size, 2);
});
