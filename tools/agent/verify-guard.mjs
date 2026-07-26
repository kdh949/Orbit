#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadContractConsumerMatrix } from "./lib/verification-impact.mjs";

export function createGuardPlan() {
  return [
    ["node", "tools/agent/repo-doctor.mjs"],
    ["node", "tools/agent/context.mjs", "--list"],
    ["node", "tools/agent/check-import-boundaries.mjs"],
    ["node", "tools/agent/check-source-cycles.mjs"],
    [
      "node",
      "tools/agent/benchmark.mjs",
      "validate",
      "docs/agent/benchmarks/baseline.json",
    ],
    ["node", "--test", "tools/agent/package-task-graph.test.mjs"],
  ];
}

export function executeGuardPlan(plan, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  loadContractConsumerMatrix(root);
  const runner =
    options.runner ??
    ((argv) =>
      spawnSync(argv[0], argv.slice(1), {
        cwd: root,
        env: options.environment ?? process.env,
        stdio: "inherit",
      }));

  for (const argv of plan) {
    const result = runner(argv);
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

function run() {
  try {
    const plan = createGuardPlan();
    process.stdout.write(
      `[verify:guard] built-in-only checks=${plan.length + 1}\n`,
    );
    process.exitCode = executeGuardPlan(plan);
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
