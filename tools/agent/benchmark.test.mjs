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

test("schema v2 snapshot에 Git tree identity와 대표 task 4개를 기록한다", () => {
  const snapshot = createBenchmarkSnapshot(createRepositoryFixture(), {
    capturedAt: "2026-07-26T00:00:00.000Z",
    gitIdentity,
    sourceArchiveSha256: "c".repeat(64),
  });

  assert.equal(BENCHMARK_TASKS.length, 4);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.toolVersion, 2);
  assert.equal(snapshot.headCommit, gitIdentity.headCommit);
  assert.equal(snapshot.treeHash, gitIdentity.treeHash);
  assert.equal(snapshot.manualBenchmark.initialRunsPerTask, 1);
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

test("legacy schema와 잘못된 archive hash를 거부한다", () => {
  const issues = validateBenchmarkSnapshot({
    schemaVersion: 1,
    toolVersion: 1,
    capturedAt: "",
    headCommit: "",
    treeHash: "",
    workingTreeDirty: "no",
    sourceArchiveSha256: "invalid",
    structural: {},
    macroRuns: [],
    manualBenchmark: { tasks: [] },
  });

  assert.ok(issues.some((issue) => issue.includes("schemaVersion")));
  assert.ok(issues.some((issue) => issue.includes("toolVersion")));
  assert.ok(issues.some((issue) => issue.includes("sourceArchiveSha256")));
  assert.ok(issues.some((issue) => issue.includes("manifestCoverage")));
});

test("Git metadata가 없는 source archive snapshot identity를 허용한다", () => {
  const snapshot = createBenchmarkSnapshot(createRepositoryFixture(), {
    gitIdentity: {
      headCommit: null,
      treeHash: null,
      workingTreeDirty: false,
    },
    sourceArchiveSha256: "d".repeat(64),
  });

  assert.equal(snapshot.headCommit, null);
  assert.equal(snapshot.treeHash, null);
  assert.deepEqual(validateBenchmarkSnapshot(snapshot), []);
});

test("archive snapshot에 검증되지 않은 commit label을 함께 기록하지 않는다", () => {
  const snapshot = createBenchmarkSnapshot(createRepositoryFixture(), {
    gitIdentity: {
      headCommit: null,
      treeHash: null,
      workingTreeDirty: false,
    },
    sourceArchiveSha256: "d".repeat(64),
  });
  snapshot.headCommit = "unverified";

  assert.ok(
    validateBenchmarkSnapshot(snapshot).some((issue) =>
      issue.includes("archive-only"),
    ),
  );
});
