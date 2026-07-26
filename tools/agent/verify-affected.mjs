#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  collectChangedPaths,
  gitRefExists,
  resolveBaseRef as resolveGitBaseRef,
} from "./lib/git-changes.mjs";
import {
  commandDescriptorForTestPath,
  contractImpactsForPaths,
  loadContractConsumerMatrix,
} from "./lib/verification-impact.mjs";
import { createVerificationEnvironment } from "./verification-env.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const fullRootFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "turbo.json",
]);

function isSharedContract(path) {
  return (
    path.startsWith("packages/shared/src/") &&
    (path.endsWith(".schema.ts") ||
      path.includes("/jobs/") ||
      path.includes("/realtime/"))
  );
}

function isPythonVerificationPath(path) {
  if (!path.startsWith("services/python-worker/")) {
    return false;
  }
  return (
    path.endsWith(".py") ||
    path === "services/python-worker/pyproject.toml" ||
    path === "services/python-worker/uv.lock"
  );
}

export function classifyAffectedPaths(paths, options = {}) {
  const uniquePaths = [...new Set(paths)].sort();
  const reasons = [];
  const matrix = options.contractMatrix ?? { contracts: {} };
  const contractImpacts = contractImpactsForPaths(uniquePaths, matrix);
  const knownContracts = new Set(contractImpacts.map((impact) => impact.path));
  const unknownSharedContracts = uniquePaths.filter(
    (path) => isSharedContract(path) && !knownContracts.has(path),
  );

  if (uniquePaths.some((path) => fullRootFiles.has(path))) {
    reasons.push("root lockfile 또는 compiler/build config 변경");
  }
  if (
    uniquePaths.some((path) =>
      path.startsWith("apps/api/src/database/migrations/"),
    )
  ) {
    reasons.push("DB migration 변경");
  }
  if (unknownSharedContracts.length > 0) {
    reasons.push(
      "consumer matrix에 없는 shared schema, Job 또는 realtime 계약 변경",
    );
  }
  if (uniquePaths.some((path) => path.startsWith("packages/job-queue/src/"))) {
    reasons.push("queue payload 또는 queue runtime 변경");
  }

  return {
    paths: uniquePaths,
    contractImpacts,
    full: reasons.length > 0,
    python:
      uniquePaths.some(isPythonVerificationPath) ||
      unknownSharedContracts.length > 0,
    reasons,
  };
}

function command(argv, options = {}) {
  return {
    argv,
    cwd: options.cwd ?? ".",
    env: options.env ?? {},
  };
}

export function createAffectedVerificationPlan(classification, baseRef) {
  const commands = classification.full
    ? [
        command(["pnpm", "turbo", "run", "build", "--env-mode=loose"]),
        command(["pnpm", "turbo", "run", "typecheck", "--env-mode=loose"]),
        command(["pnpm", "turbo", "run", "test", "--env-mode=loose"]),
      ]
    : [
        command(
          [
            "pnpm",
            "turbo",
            "run",
            "build",
            "typecheck",
            "test",
            "--affected",
            "--env-mode=loose",
          ],
          {
            env: {
              TURBO_SCM_BASE: baseRef,
              TURBO_SCM_HEAD: "HEAD",
            },
          },
        ),
      ];

  const selectedCommands = new Set(
    commands.map((item) => item.argv.join("\0")),
  );
  for (const impact of classification.contractImpacts ?? []) {
    for (const test of impact.tests) {
      const descriptor = commandDescriptorForTestPath(test);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.cwd}\0${descriptor.argv.join("\0")}`;
      if (selectedCommands.has(key)) {
        continue;
      }
      selectedCommands.add(key);
      commands.push(command(descriptor.argv, { cwd: descriptor.cwd }));
    }
  }

  if (classification.python) {
    commands.push(
      command(["uv", "run", "ruff", "check", "."], {
        cwd: "services/python-worker",
      }),
      command(["uv", "run", "mypy", "app"], {
        cwd: "services/python-worker",
      }),
      command(["uv", "run", "pytest"], {
        cwd: "services/python-worker",
      }),
    );
  }

  return {
    baseRef,
    classification,
    commands,
  };
}

export function renderAffectedVerificationPlan(plan) {
  const mode = plan.classification.full ? "full" : "affected";
  const lines = [
    `[verify:affected] base=${plan.baseRef} mode=${mode} changed=${plan.classification.paths.length}`,
  ];
  for (const reason of plan.classification.reasons) {
    lines.push(`- escalation: ${reason}`);
  }
  for (const [index, item] of plan.commands.entries()) {
    const prefix = item.cwd === "." ? "" : `(cd ${item.cwd} && `;
    const suffix = item.cwd === "." ? "" : ")";
    lines.push(`${index + 1}. ${prefix}${item.argv.join(" ")}${suffix}`);
  }
  return `${lines.join("\n")}\n`;
}

export function executeAffectedVerificationPlan(plan, options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const environment = createVerificationEnvironment(
    root,
    options.environment ?? process.env,
  );
  const runner =
    options.runner ??
    ((item) =>
      spawnSync(item.argv[0], item.argv.slice(1), {
        cwd: resolve(root, item.cwd),
        env: { ...environment, ...item.env },
        stdio: "inherit",
      }));

  for (const item of plan.commands) {
    const result = runner(item);
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

function resolveBaseRef(explicitBase) {
  return resolveGitBaseRef(repositoryRoot, explicitBase, "VERIFY_BASE");
}

function parseArguments(argv) {
  const options = {
    base: undefined,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--base") {
      if (!argv[index + 1]) {
        throw new Error("--base 다음에 Git ref가 필요합니다.");
      }
      options.base = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    }
  }
  return options;
}

function run() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const baseRef = resolveBaseRef(options.base);
    const contractMatrix = loadContractConsumerMatrix(repositoryRoot);
    const classification = classifyAffectedPaths(
      collectChangedPaths(baseRef, { root: repositoryRoot }),
      { contractMatrix },
    );
    const plan = createAffectedVerificationPlan(classification, baseRef);
    process.stdout.write(renderAffectedVerificationPlan(plan));
    if (!options.dryRun) {
      process.exitCode = executeAffectedVerificationPlan(plan);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

export { gitRefExists };

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
