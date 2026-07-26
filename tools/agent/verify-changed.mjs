#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createPathContext } from "./context.mjs";
import { collectChangedPaths, resolveBaseRef } from "./lib/git-changes.mjs";
import {
  commandForTestPath,
  contractImpactsForPaths,
  loadContractConsumerMatrix,
} from "./lib/verification-impact.mjs";
import { createVerificationEnvironment } from "./verification-env.mjs";

const TIER_LABELS = {
  0: "구조와 포맷",
  1: "인접 leaf test",
  2: "workspace checkpoint",
  3: "계약 consumer",
  4: "전체 release gate",
};

function addCommand(commands, command, reason) {
  if (!command) {
    return;
  }
  const existing = commands.find((item) => item.command === command);
  if (existing) {
    existing.reasons = [...new Set([...existing.reasons, reason])];
  } else {
    commands.push({ command, reasons: [reason] });
  }
}

export function createChangedVerificationPlan(
  paths,
  contexts,
  matrix,
  options = {},
) {
  const maxTier = options.maxTier ?? 2;
  const uniquePaths = [...new Set(paths)].sort();
  const tiers = [0, 1, 2, 3, 4].map((tier) => ({
    tier,
    label: TIER_LABELS[tier],
    commands: [],
  }));

  for (const command of [
    "pnpm lint:boundaries",
    "pnpm lint:cycles",
    "pnpm format:check",
  ]) {
    addCommand(tiers[0].commands, command, "모든 변경의 repository guard");
  }
  for (const context of contexts) {
    for (const command of context.verification.tier1) {
      addCommand(tiers[1].commands, command, `${context.path} 인접 test`);
    }
    for (const command of context.verification.tier2) {
      addCommand(
        tiers[2].commands,
        command,
        `${context.workspace.area} checkpoint`,
      );
    }
  }
  for (const impact of contractImpactsForPaths(uniquePaths, matrix)) {
    for (const test of impact.tests) {
      const command = commandForTestPath(test);
      const alreadySelected = tiers
        .slice(0, 3)
        .some((tier) => tier.commands.some((item) => item.command === command));
      if (alreadySelected) {
        continue;
      }
      addCommand(tiers[3].commands, command, `${impact.path} consumer test`);
    }
  }

  const releaseTriggers = uniquePaths.filter(
    (path) =>
      [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.base.json",
        "turbo.json",
      ].includes(path) ||
      path.startsWith("apps/api/src/database/migrations/") ||
      path.startsWith("packages/job-queue/src/"),
  );
  if (releaseTriggers.length > 0) {
    addCommand(
      tiers[4].commands,
      "pnpm verify:affected",
      `release trigger: ${releaseTriggers.join(", ")}`,
    );
  }

  return {
    maxTier,
    paths: uniquePaths,
    tiers: tiers.filter(
      (tier) => tier.tier <= maxTier && tier.commands.length > 0,
    ),
  };
}

export function renderChangedVerificationPlan(plan) {
  const lines = [
    `[verify:changed] files=${plan.paths.length} maxTier=${plan.maxTier}`,
  ];
  for (const path of plan.paths) {
    lines.push(`- changed: ${path}`);
  }
  for (const tier of plan.tiers) {
    lines.push(`Tier ${tier.tier} — ${tier.label}`);
    for (const [index, item] of tier.commands.entries()) {
      lines.push(
        `${tier.tier}.${index + 1} ${item.command} # ${item.reasons.join("; ")}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function executeChangedVerificationPlan(plan, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const environment = createVerificationEnvironment(
    root,
    options.environment ?? process.env,
  );
  const runner =
    options.runner ??
    ((item) =>
      spawnSync("/bin/sh", ["-c", item.command], {
        cwd: root,
        env: environment,
        stdio: "inherit",
      }));

  for (const tier of plan.tiers) {
    for (const item of tier.commands) {
      const result = runner(item);
      if (result.status !== 0) {
        return result.status ?? 1;
      }
    }
  }
  return 0;
}

function parseArguments(argv) {
  const options = {
    base: undefined,
    dryRun: false,
    matrixPath: undefined,
    maxTier: 2,
    paths: [],
    root: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base") {
      options.base = argv[index + 1];
      index += 1;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--matrix") {
      options.matrixPath = argv[index + 1];
      index += 1;
    } else if (argument === "--root") {
      options.root = argv[index + 1];
      index += 1;
    } else if (argument === "--tier") {
      options.maxTier = Number(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    } else {
      options.paths.push(argument);
    }
  }
  if (
    !Number.isInteger(options.maxTier) ||
    options.maxTier < 0 ||
    options.maxTier > 4
  ) {
    throw new Error("--tier는 0부터 4 사이의 정수여야 합니다.");
  }
  return options;
}

function run() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const root = resolve(options.root);
    const baseRef = resolveBaseRef(root, options.base, "VERIFY_BASE");
    const paths =
      options.paths.length > 0
        ? options.paths
        : collectChangedPaths(baseRef, { root });
    if (paths.length === 0) {
      process.stdout.write("[verify:changed] 검사할 변경 파일이 없습니다.\n");
      return;
    }
    const contexts = paths.map((path) => createPathContext(root, path));
    const matrix = loadContractConsumerMatrix(root, options.matrixPath);
    const plan = createChangedVerificationPlan(paths, contexts, matrix, {
      maxTier: options.maxTier,
    });
    process.stdout.write(renderChangedVerificationPlan(plan));
    if (!options.dryRun) {
      process.exitCode = executeChangedVerificationPlan(plan, { root });
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
