import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { inspectRepository } from "./repo-doctor.mjs";

function writeFixture(root, path, content) {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function createRepositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "orbit-repo-doctor-"));

  writeFixture(
    root,
    "docs/agent/repository-truth.json",
    JSON.stringify({
      schemaVersion: 1,
      activeDocs: ["README.md", "docs/current.md"],
      workflowClaimDocs: ["README.md"],
      canonicalSources: ["src/canonical"],
      forbiddenReferences: [
        {
          value: "src/legacy",
          replacement: "src/canonical"
        }
      ],
      historicalRoots: ["docs/archive"]
    })
  );
  writeFixture(root, "README.md", "[현재 문서](docs/current.md)\n");
  writeFixture(root, "docs/current.md", "# Current\n");
  writeFixture(root, "src/canonical/.gitkeep", "");

  return root;
}

test("유효한 active 문서와 canonical source를 허용한다", () => {
  const root = createRepositoryFixture();

  const result = inspectRepository(root);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, []);
});

test("깨진 Markdown 링크를 오류로 보고한다", () => {
  const root = createRepositoryFixture();
  writeFixture(root, "docs/current.md", "[누락 문서](missing.md)\n");

  const result = inspectRepository(root);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "BROKEN_MARKDOWN_LINK");
  assert.equal(result.issues[0].file, "docs/current.md");
});

test("존재하지 않는 workflow 참조를 오류로 보고한다", () => {
  const root = createRepositoryFixture();
  writeFixture(
    root,
    "README.md",
    "[CI](https://github.com/example/repo/actions/workflows/verify.yml)\n"
  );

  const result = inspectRepository(root);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "WORKFLOW_REFERENCE_MISSING");
});

test("active 문서의 금지된 canonical 경로를 오류로 보고한다", () => {
  const root = createRepositoryFixture();
  writeFixture(root, "docs/current.md", "`src/legacy`가 source of truth다.\n");

  const result = inspectRepository(root);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "FORBIDDEN_REFERENCE");
});

test("역사 자료의 이전 경로는 경고로 분리한다", () => {
  const root = createRepositoryFixture();
  writeFixture(root, "docs/archive/old-plan.md", "`src/legacy`를 사용한다.\n");

  const result = inspectRepository(root);

  assert.deepEqual(result.issues, []);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "HISTORICAL_FORBIDDEN_REFERENCE");
});
