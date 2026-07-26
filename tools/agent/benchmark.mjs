#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { findSourceCycles } from "./check-source-cycles.mjs";

const CODE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  ".venv",
  "dist",
  "node_modules"
]);

export const BENCHMARK_TASKS = [
  {
    id: "rehearsal-copy",
    description: "리허설 UI 문구 변경",
    scope: "web:rehearsal"
  },
  {
    id: "web-speech-retry",
    description: "Web Speech retry 조건 변경",
    scope: "web:rehearsal"
  },
  {
    id: "rehearsal-response-field",
    description: "RehearsalRun response 필드 추가",
    scope: "rehearsal"
  },
  {
    id: "worker-retry-option",
    description: "Worker retry option 변경",
    scope: "worker"
  },
  {
    id: "python-audio-validation",
    description: "Python audio validation 추가",
    scope: "python:audio"
  },
  {
    id: "editor-slide-patch",
    description: "Editor slide patch 변경",
    scope: "editor"
  },
  {
    id: "environment-variable",
    description: "환경변수 추가",
    scope: "config"
  },
  {
    id: "pptx-error-mapping",
    description: "PPTX sync error mapping 변경",
    scope: "pptx"
  }
];

const HOTSPOT_PATHS = [
  "apps/web/src/features/rehearsal/RehearsalWorkspace.tsx",
  "apps/web/src/features/rehearsal/RehearsalWorkspace.test.tsx",
  "apps/web/src/features/editor/shell/EditorShell.tsx",
  "apps/web/src/features/editor/shell/EditorShell.test.tsx",
  "apps/web/src/features/presentation/PresentationWorkspace.tsx",
  "apps/web/src/features/editor/editor-shell.css",
  "apps/web/src/styles.css",
  "apps/worker/src/worker.service.ts",
  "services/python-worker/app/main.py",
  "services/python-worker/app/ai/pptx_ooxml_generation.py"
];

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function listFiles(rootPath) {
  if (!existsSync(rootPath)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function lineCount(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function countMatchingFiles(files, pattern) {
  let count = 0;
  for (const file of files) {
    if (!CODE_EXTENSIONS.has(extname(file))) {
      continue;
    }
    if (pattern.test(readFileSync(file, "utf8"))) {
      count += 1;
    }
  }
  return count;
}

function countFiles(directory, predicate = () => true) {
  return listFiles(directory).filter(predicate).length;
}

export function collectStructuralMetrics(rootDirectory) {
  const root = resolve(rootDirectory);
  const sourceFiles = [
    ...listFiles(resolve(root, "apps")),
    ...listFiles(resolve(root, "packages")),
    ...listFiles(resolve(root, "services"))
  ];

  const hotspotLines = {};
  for (const path of HOTSPOT_PATHS) {
    const filePath = resolve(root, path);
    hotspotLines[path] = existsSync(filePath) ? lineCount(filePath) : null;
  }

  return {
    directPackageSourceImportFiles: countMatchingFiles(
      sourceFiles,
      /(?:\.\.\/)+packages\/[^"'`\n]+\/src(?:\/|["'`])/
    ),
    sharedRootImportFiles: countMatchingFiles(
      sourceFiles,
      /(?:from\s+["']@orbit\/shared["']|require\(["']@orbit\/shared["']\))/
    ),
    editorCoreRootImportFiles: countMatchingFiles(
      sourceFiles,
      /(?:from\s+["']@orbit\/editor-core["']|require\(["']@orbit\/editor-core["']\))/
    ),
    sourceCycles: findSourceCycles(root).length,
    githubWorkflowFiles: countFiles(
      resolve(root, ".github/workflows"),
      (file) => file.endsWith(".yml") || file.endsWith(".yaml")
    ),
    agentDomainManifests: countFiles(
      resolve(root, "docs/agent/domains"),
      (file) => file.endsWith(".json")
    ),
    scopedAgentInstructionFiles: listFiles(root).filter(
      (file) => file.endsWith(`${sep}AGENTS.md`) || toRepoPath(root, file) === "AGENTS.md"
    ).length,
    hotspotLines
  };
}

export function createBenchmarkSnapshot(rootDirectory, options = {}) {
  return {
    schemaVersion: 1,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    sourceCommit: options.sourceCommit ?? null,
    structural: collectStructuralMetrics(rootDirectory),
    manualBenchmark: {
      status: "pending",
      runsPerTask: 3,
      tokenUsage: {
        status: "unavailable",
        note: "실제 Agent 실행 환경이 제공한 값만 기록하고 추정하지 않는다."
      },
      metrics: [
        "filesReadBeforeFirstPatch",
        "topLevelAreasRead",
        "toolCallsBeforeFirstTargetedTest",
        "workspacesVerified",
        "secondsToFirstTargetedTest",
        "totalSeconds",
        "rollbackCount"
      ],
      tasks: BENCHMARK_TASKS.map((task) => ({ ...task, runs: [] }))
    }
  };
}

export function validateBenchmarkSnapshot(snapshot) {
  const issues = [];
  if (snapshot?.schemaVersion !== 1) {
    issues.push("schemaVersion은 1이어야 합니다.");
  }
  if (typeof snapshot?.capturedAt !== "string" || snapshot.capturedAt === "") {
    issues.push("capturedAt이 필요합니다.");
  }
  if (typeof snapshot?.structural !== "object" || snapshot.structural === null) {
    issues.push("structural metric이 필요합니다.");
  } else {
    for (const key of [
      "directPackageSourceImportFiles",
      "sharedRootImportFiles",
      "editorCoreRootImportFiles",
      "sourceCycles",
      "githubWorkflowFiles",
      "agentDomainManifests",
      "scopedAgentInstructionFiles"
    ]) {
      if (!Number.isInteger(snapshot.structural[key]) || snapshot.structural[key] < 0) {
        issues.push(`${key}는 0 이상의 정수여야 합니다.`);
      }
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

function flattenStructuralMetrics(structural) {
  const flattened = {};
  for (const [key, value] of Object.entries(structural)) {
    if (key === "hotspotLines") {
      for (const [path, lines] of Object.entries(value)) {
        flattened[`hotspotLines:${path}`] = lines;
      }
    } else {
      flattened[key] = value;
    }
  }
  return flattened;
}

export function compareSnapshots(baseline, current) {
  const baselineMetrics = flattenStructuralMetrics(baseline.structural);
  const currentMetrics = flattenStructuralMetrics(current.structural);
  return Object.keys(baselineMetrics)
    .sort()
    .map((metric) => {
      const before = baselineMetrics[metric];
      const after = currentMetrics[metric] ?? null;
      return {
        metric,
        baseline: before,
        current: after,
        delta:
          typeof before === "number" && typeof after === "number" ? after - before : null
      };
    });
}

function renderComparison(rows) {
  const lines = ["metric\tbaseline\tcurrent\tdelta"];
  for (const row of rows) {
    lines.push(
      `${row.metric}\t${row.baseline ?? "n/a"}\t${row.current ?? "n/a"}\t${
        row.delta ?? "n/a"
      }`
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    command: "snapshot",
    file: null,
    root: process.cwd(),
    json: false
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) {
    options.command = args.shift();
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
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

function run() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const current = createBenchmarkSnapshot(options.root);

    if (options.command === "snapshot") {
      process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
      return;
    }
    if (options.command === "tasks") {
      process.stdout.write(
        `${BENCHMARK_TASKS.map(
          (task) => `${task.id}\t${task.scope}\t${task.description}`
        ).join("\n")}\n`
      );
      return;
    }
    if (!["validate", "compare"].includes(options.command) || options.file === null) {
      throw new Error(
        "사용법: agent:benchmark [snapshot|tasks|validate <file>|compare <file>]"
      );
    }

    const filePath = resolve(options.root, options.file);
    const baseline = loadSnapshot(filePath);
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

    const comparison = compareSnapshots(baseline, current);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(comparison, null, 2)}\n`
        : renderComparison(comparison)
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

const currentEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (currentEntry === import.meta.url) {
  run();
}
