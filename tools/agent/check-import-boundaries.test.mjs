import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  checkImportBoundaries,
  findForbiddenWebFeatureImports,
  findPackageSourceImports,
  findWebRuntimeFeatureImports,
} from "./check-import-boundaries.mjs";

function writeFixture(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("package source를 가리키는 import와 bundler alias를 찾는다", () => {
  const findings = findPackageSourceImports(`
import { value } from "../../../packages/shared/src/index";
const lazy = import("../../packages/editor-core/src/patches/applyPatch");
const publicValue = require("@orbit/shared");
const alias = new URL("../../packages/shared/src/index.ts", import.meta.url);
`);

  assert.deepEqual(
    findings.map((finding) => finding.line),
    [2, 3, 5],
  );
});

test("public package import와 package 내부 상대 import는 허용한다", () => {
  assert.deepEqual(
    findPackageSourceImports(`
import { Deck } from "@orbit/shared";
import { helper } from "./src/helper";
`),
    [],
  );
});

test("apps와 services의 위반을 파일과 줄 번호로 보고한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-import-boundaries-"));
  writeFixture(
    root,
    "apps/web/src/App.ts",
    'import { value } from "../../../packages/shared/src/index";\n',
  );
  writeFixture(
    root,
    "services/example/index.ts",
    'import { value } from "../../packages/config/src/index";\n',
  );
  writeFixture(
    root,
    "packages/example/src/index.ts",
    'import { internal } from "./internal";\n',
  );

  const findings = checkImportBoundaries(root);

  assert.deepEqual(
    findings.map(({ file, line, code }) => ({ file, line, code })),
    [
      {
        file: "apps/web/src/App.ts",
        line: 1,
        code: "FORBIDDEN_PACKAGE_SOURCE_IMPORT",
      },
      {
        file: "services/example/index.ts",
        line: 1,
        code: "FORBIDDEN_PACKAGE_SOURCE_IMPORT",
      },
    ],
  );
});

test("Web runtime에서 feature 내부로 향하는 import를 거부한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-import-boundaries-"));
  const runtimeFile = join(
    root,
    "apps/web/src/runtime/presentation/displayManager.ts",
  );
  writeFixture(
    root,
    "apps/web/src/runtime/presentation/displayManager.ts",
    'import { helper } from "../../features/rehearsal/helper";\n' +
      'import { shared } from "../shared";\n',
  );

  assert.deepEqual(
    findWebRuntimeFeatureImports(
      readFileSync(runtimeFile, "utf8"),
      runtimeFile,
      root,
    ),
    [
      {
        line: 1,
        specifier: "../../features/rehearsal/helper",
      },
    ],
  );

  assert.deepEqual(
    checkImportBoundaries(root).map(({ file, code }) => ({ file, code })),
    [
      {
        file: "apps/web/src/runtime/presentation/displayManager.ts",
        code: "FORBIDDEN_WEB_RUNTIME_FEATURE_IMPORT",
      },
    ],
  );
});

test("Presentation, Editor, Companion에서 Rehearsal feature import를 거부한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-import-boundaries-"));
  const presentationFile = join(
    root,
    "apps/web/src/features/presentation/PresentationWorkspace.tsx",
  );
  writeFixture(
    root,
    "apps/web/src/features/presentation/PresentationWorkspace.tsx",
    'import { helper } from "../rehearsal/helper";\n' +
      'import { shell } from "../presenter-shell/public";\n' +
      'import type { Run } from "@orbit/shared/rehearsals";\n',
  );

  assert.deepEqual(
    findForbiddenWebFeatureImports(
      readFileSync(presentationFile, "utf8"),
      presentationFile,
      root,
    ),
    [{ line: 1, specifier: "../rehearsal/helper" }],
  );

  assert.deepEqual(
    checkImportBoundaries(root).map(({ file, code }) => ({ file, code })),
    [
      {
        file: "apps/web/src/features/presentation/PresentationWorkspace.tsx",
        code: "FORBIDDEN_WEB_FEATURE_IMPORT",
      },
    ],
  );
});
