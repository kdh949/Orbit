#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collectChangedPaths } from "./format-check.mjs";
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

export function classifyAffectedPaths(paths) {
  const uniquePaths = [...new Set(paths)].sort();
  const reasons = [];

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
  if (uniquePaths.some(isSharedContract)) {
    reasons.push("shared schema, Job 또는 realtime 계약 변경");
  }
  if (uniquePaths.some((path) => path.startsWith("packages/job-queue/src/"))) {
    reasons.push("queue payload 또는 queue runtime 변경");
  }

  return {
    paths: uniquePaths,
    full: reasons.length > 0,
    python:
      uniquePaths.some(isPythonVerificationPath) ||
      uniquePaths.some(isSharedContract),
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

function gitRefExists(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(explicitBase) {
  const requested = explicitBase ?? process.env.VERIFY_BASE;
  if (requested) {
    if (!gitRefExists(requested)) {
      throw new Error(`검증 기준 ref를 찾을 수 없습니다: ${requested}`);
    }
    return requested;
  }

  for (const candidate of ["origin/develop", "develop", "HEAD^"]) {
    if (gitRefExists(candidate)) {
      return candidate;
    }
  }
  return "HEAD";
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
    const classification = classifyAffectedPaths(collectChangedPaths(baseRef));
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

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
