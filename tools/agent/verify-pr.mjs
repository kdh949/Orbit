#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveBaseRef } from "./lib/git-changes.mjs";
import { createVerificationEnvironment } from "./verification-env.mjs";

export function createPullRequestVerificationPlan(baseRef) {
  return [
    { argv: ["pnpm", "verify:guard"] },
    {
      argv: ["pnpm", "format:check", "--base", baseRef, "--tracked-only"],
    },
    {
      argv: ["pnpm", "verify:affected", "--base", baseRef, "--tracked-only"],
    },
  ];
}

export function executePullRequestVerificationPlan(plan, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const environment = createVerificationEnvironment(
    root,
    options.environment ?? process.env,
  );
  const runner =
    options.runner ??
    ((item) =>
      spawnSync(item.argv[0], item.argv.slice(1), {
        cwd: root,
        env: environment,
        stdio: "inherit",
      }));

  for (const item of plan) {
    const result = runner(item);
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

function parseArguments(argv) {
  const options = { base: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base" && argv[index + 1]) {
      options.base = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${argv[index]}`);
    }
  }
  return options;
}

function run() {
  try {
    const root = process.cwd();
    const options = parseArguments(process.argv.slice(2));
    const baseRef = resolveBaseRef(root, options.base, "VERIFY_BASE");
    const plan = createPullRequestVerificationPlan(baseRef);
    process.exitCode = executePullRequestVerificationPlan(plan, { root });
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
