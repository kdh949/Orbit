import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isTestPath } from "./fs-walk.mjs";
import { reverseImportGraph } from "./import-graph.mjs";
import { classifyWorkspace } from "./repo-path.mjs";

export const DEFAULT_CONTRACT_CONSUMER_MATRIX =
  "docs/agent/contract-consumers.json";

export function loadContractConsumerMatrix(rootDirectory, path) {
  const filePath = resolve(
    rootDirectory,
    path ?? DEFAULT_CONTRACT_CONSUMER_MATRIX,
  );
  if (!existsSync(filePath)) {
    throw new Error(`contract consumer matrix가 없습니다: ${filePath}`);
  }
  const matrix = JSON.parse(readFileSync(filePath, "utf8"));
  const issues = [];
  if (matrix.schemaVersion !== 2) {
    issues.push("schemaVersion은 2여야 합니다.");
  }
  if (
    typeof matrix.crossLanguageOverrides !== "object" ||
    matrix.crossLanguageOverrides === null
  ) {
    issues.push("crossLanguageOverrides object가 필요합니다.");
  } else {
    for (const [contract, impact] of Object.entries(
      matrix.crossLanguageOverrides,
    )) {
      if (!Array.isArray(impact.consumers) || impact.consumers.length === 0) {
        issues.push(`${contract}: consumers가 필요합니다.`);
      }
      if (!Array.isArray(impact.tests) || impact.tests.length === 0) {
        issues.push(`${contract}: tests가 필요합니다.`);
      }
      for (const test of impact.tests ?? []) {
        if (!existsSync(resolve(rootDirectory, test))) {
          issues.push(`${contract}: test가 없습니다: ${test}`);
        }
      }
    }
  }
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
  return matrix;
}

function collectReverseClosure(reverseGraph, path) {
  const visited = new Set();
  const pending = [...(reverseGraph.get(path) ?? [])];
  while (pending.length > 0) {
    const importer = pending.pop();
    if (visited.has(importer)) {
      continue;
    }
    visited.add(importer);
    pending.push(...(reverseGraph.get(importer) ?? []));
  }
  return visited;
}

export function commandForTestPath(path) {
  const descriptor = commandDescriptorForTestPath(path);
  if (!descriptor) {
    return null;
  }
  if (descriptor.cwd === ".") {
    return descriptor.argv.join(" ");
  }
  return `cd ${descriptor.cwd} && ${descriptor.argv.join(" ")}`;
}

export function commandDescriptorForTestPath(path) {
  const workspace = classifyWorkspace(path);
  if (path.startsWith("tools/agent/") && path.endsWith(".test.mjs")) {
    return { argv: ["node", "--test", path], cwd: "." };
  }
  if (workspace.language === "python") {
    return {
      argv: [
        "uv",
        "run",
        "pytest",
        path.replace("services/python-worker/", ""),
      ],
      cwd: "services/python-worker",
    };
  }
  if (workspace.packageName) {
    return {
      argv: [
        "pnpm",
        "turbo",
        "run",
        "test",
        `--filter=${workspace.packageName}`,
        "--env-mode=loose",
        "--",
        path.replace(`${workspace.root}/`, ""),
      ],
      cwd: ".",
    };
  }
  return null;
}

export function contractImpactsForPaths(paths, matrix, options = {}) {
  const overrides = matrix.crossLanguageOverrides ?? {};
  const reverseGraph = options.graph
    ? (options.reverseGraph ?? reverseImportGraph(options.graph))
    : new Map();
  const impacts = [];

  for (const path of [...new Set(paths)].sort()) {
    const override = overrides[path];
    if (!override && !path.startsWith("packages/shared/src/")) {
      continue;
    }
    const importers = collectReverseClosure(reverseGraph, path);
    const tests = new Set(override?.tests ?? []);
    const consumers = new Set(override?.consumers ?? []);

    for (const importer of importers) {
      if (isTestPath(importer)) {
        tests.add(importer);
        continue;
      }
      const workspace = classifyWorkspace(importer);
      if (workspace.area) {
        consumers.add(workspace.area);
      }
    }
    if (override || tests.size > 0 || consumers.size > 0) {
      impacts.push({
        path,
        consumers: [...consumers].sort(),
        tests: [...tests].sort(),
      });
    }
  }
  return impacts;
}
