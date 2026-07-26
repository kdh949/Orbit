import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  if (matrix.schemaVersion !== 1) {
    issues.push("schemaVersion은 1이어야 합니다.");
  }
  if (typeof matrix.contracts !== "object" || matrix.contracts === null) {
    issues.push("contracts object가 필요합니다.");
  } else {
    for (const [contract, impact] of Object.entries(matrix.contracts)) {
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

export function contractImpactsForPaths(paths, matrix) {
  return paths
    .filter((path) => matrix.contracts[path])
    .map((path) => ({ path, ...matrix.contracts[path] }));
}
