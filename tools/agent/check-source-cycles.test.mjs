import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  findRelativeImports,
  findSourceCycles,
} from "./check-source-cycles.mjs";

function writeFixture(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("type import와 re-export를 포함한 상대 참조를 찾는다", () => {
  assert.deepEqual(
    findRelativeImports(`
import type { A } from "./a";
export { value } from "../value";
const lazy = import("./lazy");
import { publicValue } from "@orbit/shared";
`),
    ["./a", "../value", "./lazy"],
  );
});

test("production source의 strongly connected component를 보고한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-source-cycles-"));
  writeFixture(
    root,
    "apps/example/src/a.ts",
    'import type { B } from "./b";\n',
  );
  writeFixture(root, "apps/example/src/b.ts", 'export { value } from "./c";\n');
  writeFixture(root, "apps/example/src/c.ts", 'import { value } from "./a";\n');
  writeFixture(root, "apps/example/src/leaf.ts", "export const leaf = true;\n");

  assert.deepEqual(findSourceCycles(root), [
    ["apps/example/src/a.ts", "apps/example/src/b.ts", "apps/example/src/c.ts"],
  ]);
});

test("test 파일의 cycle은 production graph에서 제외한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-source-cycles-"));
  writeFixture(
    root,
    "packages/example/src/a.test.ts",
    'import { value } from "./b.test";\n',
  );
  writeFixture(
    root,
    "packages/example/src/b.test.ts",
    'import { value } from "./a.test";\n',
  );

  assert.deepEqual(findSourceCycles(root), []);
});
