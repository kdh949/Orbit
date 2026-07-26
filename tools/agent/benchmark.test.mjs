import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  BENCHMARK_TASKS,
  collectStructuralMetrics,
  compareSnapshots,
  createBenchmarkSnapshot,
  validateBenchmarkSnapshot
} from "./benchmark.mjs";

function writeFixture(root, path, content = "") {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function createRepositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-benchmark-"));
  writeFixture(
    root,
    "apps/web/src/App.tsx",
    'import { deckSchema } from "@orbit/shared";\n' +
      'import { createDemoDeck } from "../../../packages/editor-core/src/index";\n'
  );
  writeFixture(
    root,
    "apps/api/src/main.ts",
    'import { applyDeckPatch } from "@orbit/editor-core";\n'
  );
  writeFixture(root, "docs/agent/domains/example.json", "{}\n");
  writeFixture(root, "AGENTS.md", "# Root\n");
  writeFixture(root, "apps/web/AGENTS.md", "# Web\n");
  writeFixture(root, ".github/workflows/verify.yml", "name: verify\n");
  return root;
}

test("구조 지표를 파일 단위로 계산한다", () => {
  const root = createRepositoryFixture();

  const metrics = collectStructuralMetrics(root);

  assert.equal(metrics.directPackageSourceImportFiles, 1);
  assert.equal(metrics.sharedRootImportFiles, 1);
  assert.equal(metrics.editorCoreRootImportFiles, 1);
  assert.equal(metrics.githubWorkflowFiles, 1);
  assert.equal(metrics.agentDomainManifests, 1);
  assert.equal(metrics.scopedAgentInstructionFiles, 2);
});

test("고정 benchmark 작업 8개를 빈 run으로 생성한다", () => {
  const root = createRepositoryFixture();

  const snapshot = createBenchmarkSnapshot(root, {
    capturedAt: "2026-07-26T00:00:00.000Z",
    sourceCommit: "test"
  });

  assert.equal(BENCHMARK_TASKS.length, 8);
  assert.equal(snapshot.manualBenchmark.tasks.length, 8);
  assert.ok(snapshot.manualBenchmark.tasks.every((task) => task.runs.length === 0));
  assert.deepEqual(validateBenchmarkSnapshot(snapshot), []);
});

test("현재 구조 지표와 baseline delta를 계산한다", () => {
  const root = createRepositoryFixture();
  const baseline = createBenchmarkSnapshot(root, {
    capturedAt: "2026-07-26T00:00:00.000Z"
  });
  const current = structuredClone(baseline);
  current.structural.directPackageSourceImportFiles = 0;

  const comparison = compareSnapshots(baseline, current);
  const directImport = comparison.find(
    (row) => row.metric === "directPackageSourceImportFiles"
  );

  assert.equal(directImport.delta, -1);
});

test("잘못된 snapshot schema를 거부한다", () => {
  const issues = validateBenchmarkSnapshot({
    schemaVersion: 2,
    capturedAt: "",
    structural: {},
    manualBenchmark: { tasks: [] }
  });

  assert.ok(issues.some((issue) => issue.includes("schemaVersion")));
  assert.ok(issues.some((issue) => issue.includes("capturedAt")));
  assert.ok(issues.some((issue) => issue.includes("sharedRootImportFiles")));
});
