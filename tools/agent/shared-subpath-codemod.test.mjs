import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildCanonicalSymbolMap,
  containsSharedRootImport,
  transformSharedRootImports,
} from "./shared-subpath-codemod.mjs";

function writeFixture(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function createSharedFixture() {
  const root = mkdtempSync(join(tmpdir(), "orbit-shared-subpath-"));
  writeFixture(
    root,
    "packages/shared/package.json",
    JSON.stringify({
      exports: {
        ".": { import: "./src/index.ts" },
        "./deck": { import: "./src/deck/index.ts" },
        "./jobs": { import: "./src/jobs/index.ts" },
      },
    }),
  );
  writeFixture(
    root,
    "packages/shared/src/deck/index.ts",
    'export * from "./deck.schema";\nexport { sharedName } from "../shared";\n',
  );
  writeFixture(
    root,
    "packages/shared/src/deck/deck.schema.ts",
    "export interface Deck {}\nexport const deckSchema = {};\n",
  );
  writeFixture(
    root,
    "packages/shared/src/jobs/index.ts",
    'export type { Job } from "./job.schema";\nexport { sharedName } from "../shared";\n',
  );
  writeFixture(
    root,
    "packages/shared/src/jobs/job.schema.ts",
    "export type Job = { id: string };\n",
  );
  writeFixture(
    root,
    "packages/shared/src/shared.ts",
    "export const sharedName = true;\n",
  );
  return root;
}

test("barrel AST에서 canonical subpath와 충돌 후보를 계산한다", () => {
  const root = createSharedFixture();
  const symbolMap = buildCanonicalSymbolMap(root);

  assert.deepEqual(symbolMap.get("Deck"), ["@orbit/shared/deck"]);
  assert.deepEqual(symbolMap.get("Job"), ["@orbit/shared/jobs"]);
  assert.deepEqual(symbolMap.get("sharedName"), [
    "@orbit/shared/deck",
    "@orbit/shared/jobs",
  ]);
});

test("named import를 canonical subpath별로 나누고 type modifier를 보존한다", () => {
  const symbolMap = new Map([
    ["Deck", ["@orbit/shared/deck"]],
    ["deckSchema", ["@orbit/shared/deck"]],
    ["Job", ["@orbit/shared/jobs"]],
  ]);
  const result = transformSharedRootImports({
    content:
      'import { type Deck, deckSchema, type Job } from "@orbit/shared";\n',
    file: "apps/api/src/example.ts",
    symbolMap,
  });

  assert.equal(
    result.output,
    'import { type Deck, deckSchema } from "@orbit/shared/deck";\n' +
      'import { type Job } from "@orbit/shared/jobs";\n',
  );
  assert.equal(result.migratedSymbols, 3);
  assert.deepEqual(result.conflicts, []);
  assert.equal(containsSharedRootImport(result.output), false);
});

test("모호하거나 매핑되지 않은 symbol은 root import와 conflict에 남긴다", () => {
  const symbolMap = new Map([
    ["Deck", ["@orbit/shared/deck"]],
    ["sharedName", ["@orbit/shared/deck", "@orbit/shared/jobs"]],
  ]);
  const result = transformSharedRootImports({
    content: 'import { Deck, sharedName, unknownName } from "@orbit/shared";\n',
    file: "apps/api/src/example.ts",
    symbolMap,
  });

  assert.equal(
    result.output,
    'import { sharedName, unknownName } from "@orbit/shared";\n' +
      'import { Deck } from "@orbit/shared/deck";\n',
  );
  assert.deepEqual(
    result.conflicts.map(({ reason, symbol }) => ({ reason, symbol })),
    [
      { reason: "AMBIGUOUS_SYMBOL", symbol: "sharedName" },
      { reason: "UNMAPPED_SYMBOL", symbol: "unknownName" },
    ],
  );
});

test("named re-export와 import type도 canonical subpath로 이동한다", () => {
  const symbolMap = new Map([
    ["Deck", ["@orbit/shared/deck"]],
    ["Job", ["@orbit/shared/jobs"]],
  ]);
  const result = transformSharedRootImports({
    content:
      'export { type Deck } from "@orbit/shared";\n' +
      'type StoredJob = import("@orbit/shared").Job;\n',
    file: "packages/example/src/index.ts",
    symbolMap,
  });

  assert.equal(
    result.output,
    'export { type Deck } from "@orbit/shared/deck";\n' +
      'type StoredJob = import("@orbit/shared/jobs").Job;\n',
  );
  assert.equal(result.migratedSymbols, 2);
  assert.equal(containsSharedRootImport(result.output), false);
});
