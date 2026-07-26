import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  createCssOwnershipReport,
  extractCssSelectors,
} from "./css-ownership.mjs";

function writeFixture(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("selector list와 nested at-rule 내부 selector를 추출한다", () => {
  assert.deepEqual(
    extractCssSelectors(`
/* ignored { } */
.editor-shell,
.editor-shell[data-mode="focus,wide"] { display: grid; }
@media (max-width: 800px) {
  .editor-shell .toolbar { display: none; }
}
@keyframes pulse {
  from { opacity: 0; }
  to { opacity: 1; }
}
`).map(({ owner, selector }) => ({ owner, selector })),
    [
      { owner: ".editor-shell", selector: ".editor-shell" },
      {
        owner: ".editor-shell",
        selector: '.editor-shell[data-mode="focus,wide"]',
      },
      {
        owner: ".editor-shell",
        selector: ".editor-shell .toolbar",
      },
      { owner: "from", selector: "from" },
      { owner: "to", selector: "to" },
    ],
  );
});

test("파일별 selector와 중복 위치를 ownership report로 집계한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-css-ownership-"));
  writeFixture(
    root,
    "styles/a.css",
    ".button { color: red; }\n.panel .button { color: blue; }\n",
  );
  writeFixture(
    root,
    "styles/b.css",
    ".button { color: green; }\n#app { display: grid; }\n",
  );

  const report = createCssOwnershipReport(root, [
    "styles/a.css",
    "styles/b.css",
  ]);

  assert.equal(report.files.length, 2);
  assert.equal(report.duplicateSelectorCount, 1);
  assert.deepEqual(report.duplicates[0], {
    occurrences: [
      { line: 1, path: "styles/a.css" },
      { line: 1, path: "styles/b.css" },
    ],
    selector: ".button",
  });
  assert.equal(
    report.owners.find(({ owner }) => owner === ".button")?.occurrenceCount,
    2,
  );
});
