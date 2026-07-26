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
  validateBenchmarkSnapshot,
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
      'import { createDemoDeck } from "../../../packages/editor-core/src/index";\n',
  );
  writeFixture(
    root,
    "apps/web/src/App.test.tsx",
    'import { deckSchema } from "@orbit/shared";\nreadFileSync("App.tsx");\n',
  );
  writeFixture(
    root,
    "apps/api/src/main.ts",
    'import { applyDeckPatch } from "@orbit/editor-core";\n' +
      'import { Deck } from "@orbit/shared/deck";\n',
  );
  writeFixture(root, "docs/agent/domains/example.json", "{}\n");
  writeFixture(root, "AGENTS.md", "# Root\n");
  writeFixture(root, "apps/web/AGENTS.md", "# Web\n");
  writeFixture(root, ".github/workflows/verify.yml", "name: verify\n");
  return root;
}

const gitIdentity = {
  headCommit: "a".repeat(40),
  treeHash: "b".repeat(40),
  workingTreeDirty: false,
};

test("구조 지표를 production과 test 파일로 분리해 계산한다", () => {
  const metrics = collectStructuralMetrics(createRepositoryFixture());

  assert.equal(metrics.directPackageSourceImportFiles, 1);
  assert.equal(metrics.sharedRootImportFiles, 2);
  assert.equal(metrics.productionSharedRootImportFiles, 1);
  assert.equal(metrics.testSharedRootImportFiles, 1);
  assert.equal(metrics.sharedSubpathImportFiles, 1);
  assert.equal(metrics.editorCoreRootImportFiles, 1);
  assert.equal(metrics.sourceInspectionTestFiles, 1);
  assert.equal(metrics.githubWorkflowFiles, 1);
  assert.equal(metrics.agentDomainManifests, 1);
  assert.equal(metrics.scopedAgentInstructionFiles, 2);
});

test("schema v4 snapshot에 Git tree identity와 대표 task 8개를 기록한다", () => {
  const snapshot = createBenchmarkSnapshot(createRepositoryFixture(), {
    capturedAt: "2026-07-26T00:00:00.000Z",
    gitIdentity,
  });

  assert.equal(BENCHMARK_TASKS.length, 8);
  assert.equal(snapshot.schemaVersion, 4);
  assert.equal(snapshot.toolVersion, 4);
  assert.equal(snapshot.headCommit, gitIdentity.headCommit);
  assert.equal(snapshot.treeHash, gitIdentity.treeHash);
  assert.equal(snapshot.manualBenchmark.initialRunsPerTask, 1);
  assert.ok(snapshot.structural.rootAgentInstructionsBytes > 0);
  assert.equal(snapshot.structural.productionLineStatistics.files, 2);
  assert.equal(snapshot.structural.testLineStatistics.files, 1);
  assert.deepEqual(validateBenchmarkSnapshot(snapshot), []);
});

test("dirty working tree snapshot을 기본 거부하고 명시한 경우 기록한다", () => {
  const root = createRepositoryFixture();
  const dirtyIdentity = { ...gitIdentity, workingTreeDirty: true };

  assert.throws(
    () => createBenchmarkSnapshot(root, { gitIdentity: dirtyIdentity }),
    /dirty working tree/,
  );
  assert.equal(
    createBenchmarkSnapshot(root, {
      allowDirty: true,
      gitIdentity: dirtyIdentity,
    }).workingTreeDirty,
    true,
  );
});

test("현재 구조 지표와 baseline의 nested delta를 계산한다", () => {
  const baseline = createBenchmarkSnapshot(createRepositoryFixture(), {
    gitIdentity,
  });
  const current = structuredClone(baseline);
  current.structural.manifestCoverage.ownedProductionSourceFiles = 2;

  const comparison = compareSnapshots(baseline, current);
  assert.equal(
    comparison.find(
      (row) => row.metric === "manifestCoverage:ownedProductionSourceFiles",
    ).delta,
    2,
  );
});

test("legacy schema와 Git identity 누락을 거부한다", () => {
  const issues = validateBenchmarkSnapshot({
    schemaVersion: 3,
    toolVersion: 3,
    capturedAt: "",
    headCommit: "",
    treeHash: "",
    workingTreeDirty: "no",
    structural: {},
    manualBenchmark: { tasks: [] },
  });

  assert.ok(issues.some((issue) => issue.includes("schemaVersion")));
  assert.ok(issues.some((issue) => issue.includes("toolVersion")));
  assert.ok(issues.some((issue) => issue.includes("Git commit")));
  assert.ok(issues.some((issue) => issue.includes("manifestCoverage")));
});

test("유효하지 않은 Git identity를 거부한다", () => {
  const snapshot = createBenchmarkSnapshot(createRepositoryFixture(), {
    gitIdentity: {
      headCommit: "invalid",
      treeHash: "invalid",
      workingTreeDirty: false,
    },
  });

  assert.ok(
    validateBenchmarkSnapshot(snapshot).some((issue) =>
      issue.includes("Git commit"),
    ),
  );
});
