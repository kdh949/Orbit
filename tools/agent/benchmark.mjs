#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { findSourceCycles } from "./check-source-cycles.mjs";
import { createCssOwnershipReport } from "./css-ownership.mjs";
import {
  SOURCE_EXTENSIONS,
  isProductionSourcePath,
  isTestPath,
  listFiles,
} from "./lib/fs-walk.mjs";
import { collectGitIdentity } from "./lib/git-changes.mjs";
import {
  buildImportGraph,
  collectDependencyClosure,
  reverseImportGraph,
} from "./lib/import-graph.mjs";
import { matchesRepoGlob, toRepoPath } from "./lib/repo-path.mjs";

export const BENCHMARK_TOOL_VERSION = 4;
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

export const BENCHMARK_TASKS = [
  {
    id: "web-speech-retry",
    description: "Web Speech retry 조건 변경",
    path: "apps/web/src/runtime/speech/stt/koreanTextSimilarity.ts",
    taskFile: "docs/agent/benchmark/tasks/web-speech-retry.md",
  },
  {
    id: "rehearsal-response-field",
    description: "RehearsalRun response 필드 추가",
    path: "packages/shared/src/rehearsals/rehearsal.schema.ts",
    taskFile: "docs/agent/benchmark/tasks/rehearsal-response-field.md",
  },
  {
    id: "worker-retry-option",
    description: "Worker retry option 변경",
    path: "apps/worker/src/rehearsal-stt.processor.ts",
    taskFile: "docs/agent/benchmark/tasks/worker-retry-option.md",
  },
  {
    id: "pptx-error-mapping",
    description: "PPTX sync error mapping 변경",
    path: "services/python-worker/app/ai/pptx_ooxml_generation.py",
    taskFile: "docs/agent/benchmark/tasks/pptx-error-mapping.md",
  },
  {
    id: "job-queue-payload",
    description: "Job queue payload 변경",
    path: "packages/job-queue/src/index.ts",
    taskFile: "docs/agent/benchmark/tasks/job-queue-payload.md",
  },
  {
    id: "rehearsal-controller",
    description: "Rehearsal Controller 동작 변경",
    path: "apps/web/src/features/rehearsal/RehearsalWorkspaceController.tsx",
    taskFile: "docs/agent/benchmark/tasks/rehearsal-controller.md",
  },
  {
    id: "app-route",
    description: "Web App route 추가",
    path: "apps/web/src/App.tsx",
    taskFile: "docs/agent/benchmark/tasks/app-route.md",
  },
  {
    id: "cross-boundary-stage-contract",
    description: "Web·API·Worker stage 계약 변경",
    path: "packages/shared/src/jobs/ai-deck-generation-stage.schema.ts",
    taskFile: "docs/agent/benchmark/tasks/cross-boundary-stage-contract.md",
  },
];

const HOTSPOT_PATHS = [
  "apps/web/src/App.tsx",
  "apps/web/src/features/rehearsal/RehearsalWorkspaceController.tsx",
  "apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx",
  "apps/web/src/features/editor/shell/EditorShellController.tsx",
  "apps/web/src/features/editor/shell/EditorShell.test.tsx",
  "apps/web/src/features/presentation/PresentationWorkspaceController.tsx",
  "packages/job-queue/src/index.ts",
  "packages/shared/src/rehearsals/rehearsal.schema.ts",
  "apps/worker/src/pptx-ooxml-sync.processor.ts",
  "apps/worker/src/rehearsal-stt.processor.ts",
  "services/python-worker/app/ai/composition_library.py",
  "services/python-worker/app/ai/deck_generation/content_planning.py",
  "services/python-worker/app/ai/pptx_ooxml_vector_importer.py",
];

const CSS_HOTSPOTS = [
  "apps/web/src/features/editor/editor-shell.css",
  "apps/web/src/styles.css",
];

function lineCount(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) {
    return 0;
  }
  return sortedValues[Math.ceil(sortedValues.length * ratio) - 1];
}

function collectLineStatistics(files) {
  const values = files.map(lineCount).sort((left, right) => left - right);
  return {
    files: values.length,
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: values.at(-1) ?? 0,
    over1000: values.filter((value) => value >= 1_000).length,
    over2000: values.filter((value) => value >= 2_000).length,
  };
}

function countMatchingFiles(files, pattern) {
  return files.filter(
    (file) =>
      CODE_EXTENSIONS.has(extname(file)) &&
      pattern.test(readFileSync(file, "utf8")),
  ).length;
}

function loadOwnedPathPatterns(root) {
  return listFiles(resolve(root, "docs/agent/domains"), {
    extensions: new Set([".json"]),
  }).flatMap((file) => {
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(manifest.ownedPaths) ? manifest.ownedPaths : [];
    } catch {
      return [];
    }
  });
}

function collectManifestCoverage(root, productionFiles, reverseGraph) {
  const patterns = loadOwnedPathPatterns(root);
  const ownedFiles = productionFiles.filter((file) => {
    const path = toRepoPath(root, file);
    return patterns.some((pattern) => matchesRepoGlob(path, pattern));
  });
  const ownedSet = new Set(ownedFiles.map((file) => toRepoPath(root, file)));
  const productionLines = productionFiles.reduce(
    (total, file) => total + lineCount(file),
    0,
  );
  const ownedProductionSourceLines = ownedFiles.reduce(
    (total, file) => total + lineCount(file),
    0,
  );
  const highFanoutFallbackFiles = productionFiles.filter((file) => {
    const path = toRepoPath(root, file);
    return !ownedSet.has(path) && (reverseGraph.get(path)?.size ?? 0) >= 20;
  }).length;
  return {
    highFanoutFallbackFiles,
    ownedProductionSourceFiles: ownedFiles.length,
    ownedProductionSourceLines,
    percent:
      productionFiles.length === 0
        ? 0
        : Number(
            ((ownedFiles.length / productionFiles.length) * 100).toFixed(1),
          ),
    productionSourceFiles: productionFiles.length,
    productionSourceLines: productionLines,
    linePercent:
      productionLines === 0
        ? 0
        : Number(
            ((ownedProductionSourceLines / productionLines) * 100).toFixed(1),
          ),
  };
}

function collectHotspotContext(root, graph, reverseGraph) {
  const result = {};
  for (const path of HOTSPOT_PATHS.filter((candidate) =>
    graph.has(candidate),
  )) {
    const closure = collectDependencyClosure(graph, path);
    result[path] = {
      directDependencies: graph.get(path).size,
      reverseImporters: reverseGraph.get(path)?.size ?? 0,
      reachableFiles: closure.size,
      reachableLines: [...closure].reduce((total, dependency) => {
        const file = resolve(root, dependency);
        return total + (existsSync(file) ? lineCount(file) : 0);
      }, 0),
    };
  }
  return result;
}

export function collectStructuralMetrics(rootDirectory) {
  const root = resolve(rootDirectory);
  const sourceFiles = ["apps", "packages", "services"].flatMap((sourceRoot) =>
    listFiles(resolve(root, sourceRoot)),
  );
  const codeFiles = sourceFiles.filter((file) =>
    SOURCE_EXTENSIONS.has(extname(file)),
  );
  const productionFiles = codeFiles.filter(isProductionSourcePath);
  const testFiles = codeFiles.filter(isTestPath);
  const productionJavascriptFiles = productionFiles.filter((file) =>
    CODE_EXTENSIONS.has(extname(file)),
  );
  const testJavascriptFiles = testFiles.filter((file) =>
    CODE_EXTENSIONS.has(extname(file)),
  );

  const hotspotLines = {};
  for (const path of HOTSPOT_PATHS) {
    const filePath = resolve(root, path);
    hotspotLines[path] = existsSync(filePath) ? lineCount(filePath) : null;
  }

  const cssPaths = CSS_HOTSPOTS.filter((path) =>
    existsSync(resolve(root, path)),
  );
  const cssReport =
    cssPaths.length > 0
      ? createCssOwnershipReport(root, cssPaths)
      : { duplicateOccurrenceCount: 0, duplicateSelectorCount: 0 };
  const importGraph = buildImportGraph(root, { includeTests: false });
  const reverseGraph = reverseImportGraph(importGraph);

  return {
    rootAgentInstructionsBytes: existsSync(resolve(root, "AGENTS.md"))
      ? readFileSync(resolve(root, "AGENTS.md")).byteLength
      : 0,
    agentDomainManifests: listFiles(resolve(root, "docs/agent/domains"), {
      extensions: new Set([".json"]),
    }).length,
    cssDuplicateOccurrences: cssReport.duplicateOccurrenceCount,
    cssDuplicateSelectors: cssReport.duplicateSelectorCount,
    directPackageSourceImportFiles: countMatchingFiles(
      codeFiles,
      /(?:\.\.\/)+packages\/[^"'`\n]+\/src(?:\/|["'`])/,
    ),
    editorCoreRootImportFiles: countMatchingFiles(
      codeFiles,
      /(?:from\s+["']@orbit\/editor-core["']|require\(["']@orbit\/editor-core["']\))/,
    ),
    editorCoreSubpathImportFiles: countMatchingFiles(
      codeFiles,
      /(?:from\s+["']@orbit\/editor-core\/[^"']+["']|require\(["']@orbit\/editor-core\/[^"']+["']\))/,
    ),
    githubWorkflowFiles: listFiles(resolve(root, ".github/workflows"), {
      extensions: new Set([".yaml", ".yml"]),
    }).length,
    hotspotContext: collectHotspotContext(root, importGraph, reverseGraph),
    hotspotLines,
    manifestCoverage: collectManifestCoverage(
      root,
      productionFiles,
      reverseGraph,
    ),
    productionLineStatistics: collectLineStatistics(productionFiles),
    productionSharedRootImportFiles: countMatchingFiles(
      productionJavascriptFiles,
      /(?:from\s+["']@orbit\/shared["']|require\(["']@orbit\/shared["']\))/,
    ),
    scopedAgentInstructionFiles: listFiles(root).filter(
      (file) =>
        file.endsWith("/AGENTS.md") || toRepoPath(root, file) === "AGENTS.md",
    ).length,
    sharedRootImportFiles: countMatchingFiles(
      codeFiles,
      /(?:from\s+["']@orbit\/shared["']|require\(["']@orbit\/shared["']\))/,
    ),
    sharedSubpathImportFiles: countMatchingFiles(
      codeFiles,
      /(?:from\s+["']@orbit\/shared\/[^"']+["']|require\(["']@orbit\/shared\/[^"']+["']\))/,
    ),
    sourceCycles: findSourceCycles(root).length,
    sourceInspectionTestFiles: testJavascriptFiles.filter((file) =>
      /(?:\breadFileSync\s*\(|\bfs\.readFileSync\s*\()/.test(
        readFileSync(file, "utf8"),
      ),
    ).length,
    testLineStatistics: collectLineStatistics(testFiles),
    testSharedRootImportFiles: countMatchingFiles(
      testJavascriptFiles,
      /(?:from\s+["']@orbit\/shared["']|require\(["']@orbit\/shared["']\))/,
    ),
  };
}

function defaultGitIdentity(rootDirectory, options) {
  if (options.gitIdentity) {
    return options.gitIdentity;
  }
  return collectGitIdentity(rootDirectory, options.ref ?? "HEAD");
}

export function createBenchmarkSnapshot(rootDirectory, options = {}) {
  const gitIdentity = defaultGitIdentity(rootDirectory, options);
  if (gitIdentity.workingTreeDirty && !options.allowDirty) {
    throw new Error(
      "dirty working tree에서는 benchmark snapshot을 생성할 수 없습니다. " +
        "임시 측정은 --allow-dirty를 명시하세요.",
    );
  }

  return {
    schemaVersion: 4,
    toolVersion: BENCHMARK_TOOL_VERSION,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    headCommit: gitIdentity.headCommit,
    treeHash: gitIdentity.treeHash,
    workingTreeDirty: gitIdentity.workingTreeDirty,
    structural: collectStructuralMetrics(rootDirectory),
    manualBenchmark: {
      status: "pending",
      initialRunsPerTask: 1,
      tokenUsage: {
        status: "unavailable",
        note: "실제 Agent 실행 환경이 제공한 값만 기록하고 추정하지 않는다.",
      },
      metrics: [
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "reasoningTokens",
        "filesReadBeforeFirstPatch",
        "searchCallsBeforeFirstPatch",
        "topLevelAreasRead",
        "toolCallsBeforeFirstTargetedTest",
        "workspacesVerified",
        "secondsToFirstTargetedTest",
        "totalSeconds",
        "rollbackCount",
      ],
      tasks: BENCHMARK_TASKS.map((task) => ({ ...task, runs: [] })),
    },
  };
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function validateBenchmarkSnapshot(snapshot) {
  const issues = [];
  if (snapshot?.schemaVersion !== 4) {
    issues.push("schemaVersion은 4여야 합니다.");
  }
  if (snapshot?.toolVersion !== BENCHMARK_TOOL_VERSION) {
    issues.push(`toolVersion은 ${BENCHMARK_TOOL_VERSION}여야 합니다.`);
  }
  if (typeof snapshot?.capturedAt !== "string" || snapshot.capturedAt === "") {
    issues.push("capturedAt이 필요합니다.");
  }
  const gitHashPattern = /^[a-f0-9]{40,64}$/i;
  if (
    !gitHashPattern.test(snapshot?.headCommit ?? "") ||
    !gitHashPattern.test(snapshot?.treeHash ?? "")
  ) {
    issues.push("유효한 Git commit과 tree identity가 필요합니다.");
  }
  if (typeof snapshot?.workingTreeDirty !== "boolean") {
    issues.push("workingTreeDirty는 boolean이어야 합니다.");
  }
  if (
    typeof snapshot?.structural !== "object" ||
    snapshot.structural === null
  ) {
    issues.push("structural metric이 필요합니다.");
  } else {
    for (const key of [
      "agentDomainManifests",
      "cssDuplicateOccurrences",
      "cssDuplicateSelectors",
      "directPackageSourceImportFiles",
      "editorCoreRootImportFiles",
      "editorCoreSubpathImportFiles",
      "githubWorkflowFiles",
      "productionSharedRootImportFiles",
      "rootAgentInstructionsBytes",
      "scopedAgentInstructionFiles",
      "sharedRootImportFiles",
      "sharedSubpathImportFiles",
      "sourceCycles",
      "sourceInspectionTestFiles",
      "testSharedRootImportFiles",
    ]) {
      if (!isNonNegativeInteger(snapshot.structural[key])) {
        issues.push(`${key}는 0 이상의 정수여야 합니다.`);
      }
    }
    const coverage = snapshot.structural.manifestCoverage;
    if (
      !isNonNegativeInteger(coverage?.highFanoutFallbackFiles) ||
      !isNonNegativeInteger(coverage?.productionSourceFiles) ||
      !isNonNegativeInteger(coverage?.ownedProductionSourceFiles) ||
      !isNonNegativeInteger(coverage?.productionSourceLines) ||
      !isNonNegativeInteger(coverage?.ownedProductionSourceLines) ||
      typeof coverage?.percent !== "number" ||
      coverage.percent < 0 ||
      coverage.percent > 100 ||
      typeof coverage?.linePercent !== "number" ||
      coverage.linePercent < 0 ||
      coverage.linePercent > 100
    ) {
      issues.push("manifestCoverage가 유효하지 않습니다.");
    }
  }
  if (!Array.isArray(snapshot?.manualBenchmark?.tasks)) {
    issues.push("manualBenchmark.tasks가 필요합니다.");
  } else {
    const taskIds = snapshot.manualBenchmark.tasks.map((task) => task.id);
    if (new Set(taskIds).size !== taskIds.length) {
      issues.push("manualBenchmark task id가 중복됩니다.");
    }
  }
  return issues;
}

function flattenStructuralMetrics(structural, prefix = "") {
  const flattened = {};
  for (const [key, value] of Object.entries(structural)) {
    const metric = prefix ? `${prefix}:${key}` : key;
    if (typeof value === "number" || value === null) {
      flattened[metric] = value;
    } else if (typeof value === "object" && value !== null) {
      Object.assign(flattened, flattenStructuralMetrics(value, metric));
    }
  }
  return flattened;
}

export function compareSnapshots(baseline, current) {
  const baselineMetrics = flattenStructuralMetrics(baseline.structural);
  const currentMetrics = flattenStructuralMetrics(current.structural);
  return [
    ...new Set([
      ...Object.keys(baselineMetrics),
      ...Object.keys(currentMetrics),
    ]),
  ]
    .sort()
    .map((metric) => {
      const before = baselineMetrics[metric] ?? null;
      const after = currentMetrics[metric] ?? null;
      return {
        metric,
        baseline: before,
        current: after,
        delta:
          typeof before === "number" && typeof after === "number"
            ? after - before
            : null,
      };
    });
}

function renderComparison(rows) {
  const lines = ["metric\tbaseline\tcurrent\tdelta"];
  for (const row of rows) {
    lines.push(
      `${row.metric}\t${row.baseline ?? "n/a"}\t${row.current ?? "n/a"}\t${
        row.delta ?? "n/a"
      }`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    allowDirty: false,
    command: "snapshot",
    file: null,
    json: false,
    ref: null,
    root: process.cwd(),
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) {
    options.command = args.shift();
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-dirty") {
      options.allowDirty = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--ref") {
      options.ref = args[index + 1];
      index += 1;
    } else if (argument === "--root") {
      options.root = args[index + 1];
      index += 1;
    } else if (options.file === null) {
      options.file = argument;
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    }
  }
  return options;
}

function loadSnapshot(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function withArchivedRef(rootDirectory, ref, callback) {
  const root = resolve(rootDirectory);
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "orbit-agent-benchmark-ref-"),
  );
  const archivePath = join(temporaryRoot, "tree.tar");
  const extractedRoot = join(temporaryRoot, "tree");
  try {
    execFileSync("mkdir", ["-p", extractedRoot]);
    execFileSync("git", ["archive", "--format=tar", "-o", archivePath, ref], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("tar", ["-xf", archivePath, "-C", extractedRoot]);
    return callback(extractedRoot, collectGitIdentity(root, ref));
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function createCurrentSnapshot(options, allowDirty) {
  const create = (measurementRoot, gitIdentity) =>
    createBenchmarkSnapshot(measurementRoot, {
      allowDirty,
      gitIdentity,
    });
  return options.ref
    ? withArchivedRef(options.root, options.ref, create)
    : createBenchmarkSnapshot(options.root, { allowDirty });
}

function run() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.command === "tasks") {
      process.stdout.write(
        `${BENCHMARK_TASKS.map(
          (task) => `${task.id}\t${task.path}\t${task.description}`,
        ).join("\n")}\n`,
      );
      return;
    }
    if (options.command === "snapshot") {
      const snapshot = createCurrentSnapshot(options, options.allowDirty);
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }
    if (
      !["validate", "compare"].includes(options.command) ||
      options.file === null
    ) {
      throw new Error(
        "사용법: agent:benchmark [snapshot [--ref <commit>] [--allow-dirty]|" +
          "tasks|validate <file>|compare <file>]",
      );
    }

    const baseline = loadSnapshot(resolve(options.root, options.file));
    const issues = validateBenchmarkSnapshot(baseline);
    if (issues.length > 0) {
      process.stderr.write(`${issues.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    if (options.command === "validate") {
      process.stdout.write(`benchmark snapshot 유효: ${options.file}\n`);
      return;
    }

    const current = createCurrentSnapshot(options, true);
    const comparison = compareSnapshots(baseline, current);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(comparison, null, 2)}\n`
        : renderComparison(comparison),
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
