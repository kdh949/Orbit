#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const supportedExtensions = new Set([
  ".cjs",
  ".css",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".json5",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".scss",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const excludedSegments = new Set([
  ".turbo",
  ".venv",
  "coverage",
  "dist",
  "node_modules",
]);

function splitNullSeparated(output) {
  return output.split("\0").filter(Boolean);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "inherit"],
  });
}

export function isSupportedFormatPath(path) {
  const segments = path.split("/");
  return (
    !segments.some((segment) => excludedSegments.has(segment)) &&
    supportedExtensions.has(extname(path).toLowerCase())
  );
}

export function selectFormatFiles(paths, fileExists = () => true) {
  return [...new Set(paths)]
    .filter(isSupportedFormatPath)
    .filter(fileExists)
    .sort((left, right) => left.localeCompare(right));
}

function parseBaseArgument(args) {
  const baseIndex = args.indexOf("--base");
  if (baseIndex === -1) {
    return undefined;
  }
  if (!args[baseIndex + 1]) {
    throw new Error("--base 다음에 Git ref가 필요합니다.");
  }
  return args[baseIndex + 1];
}

function refExists(ref) {
  try {
    git(["rev-parse", "--verify", `${ref}^{commit}`], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(explicitBase) {
  if (explicitBase) {
    if (!refExists(explicitBase)) {
      throw new Error(
        `format check 기준 ref를 찾을 수 없습니다: ${explicitBase}`,
      );
    }
    return explicitBase;
  }

  const configuredBase = process.env.FORMAT_CHECK_BASE;
  if (configuredBase) {
    if (!refExists(configuredBase)) {
      throw new Error(
        `FORMAT_CHECK_BASE ref를 찾을 수 없습니다: ${configuredBase}`,
      );
    }
    return configuredBase;
  }

  for (const candidate of ["origin/develop", "develop", "HEAD^"]) {
    if (refExists(candidate)) {
      return candidate;
    }
  }

  return "HEAD";
}

export function collectChangedPaths(baseRef) {
  const mergeBase = resolveMergeBase(baseRef);
  const pathGroups = [
    git(["diff", "--name-only", "--diff-filter=ACMR", "-z", mergeBase, "HEAD"]),
    git(["diff", "--name-only", "--diff-filter=ACMR", "-z"]),
    git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]),
    git(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];

  return pathGroups.flatMap(splitNullSeparated);
}

export function resolveMergeBase(baseRef) {
  return git(["merge-base", baseRef, "HEAD"]).trim();
}

export function classifyFormatStatus({
  currentFormatted,
  baseExists,
  baseFormatted,
}) {
  if (currentFormatted) {
    return "formatted";
  }
  if (!baseExists || baseFormatted) {
    return "regression";
  }
  return "legacy";
}

async function isFormatted(path, content) {
  const absolutePath = join(repositoryRoot, path);
  const config = (await resolveConfig(absolutePath)) ?? {};
  const formatted = await format(content, {
    ...config,
    filepath: absolutePath,
  });
  return formatted === content;
}

function readBaseContent(mergeBase, path) {
  try {
    return git(["show", `${mergeBase}:${path}`], { quiet: true });
  } catch {
    return undefined;
  }
}

async function checkFormatting(files, mergeBase) {
  const regressions = [];
  const legacy = [];

  for (const path of files) {
    const currentContent = readFileSync(join(repositoryRoot, path), "utf8");
    const currentFormatted = await isFormatted(path, currentContent);
    const baseContent = currentFormatted
      ? undefined
      : readBaseContent(mergeBase, path);
    const baseFormatted =
      baseContent === undefined ? false : await isFormatted(path, baseContent);
    const status = classifyFormatStatus({
      currentFormatted,
      baseExists: baseContent !== undefined,
      baseFormatted,
    });

    if (status === "regression") {
      regressions.push(path);
    } else if (status === "legacy") {
      legacy.push(path);
    }
  }

  if (legacy.length > 0) {
    console.warn(
      `[format-check] 기존 포맷 부채 ${legacy.length}개 파일은 경고만 남깁니다.`,
    );
    for (const path of legacy) {
      console.warn(`  - ${path}`);
    }
  }

  if (regressions.length > 0) {
    console.error(
      `[format-check] 새 포맷 회귀 ${regressions.length}개 파일을 발견했습니다.`,
    );
    for (const path of regressions) {
      console.error(`  - ${path}`);
    }
    return 1;
  }

  console.log("[format-check] 변경 파일 포맷 검사 통과");
  return 0;
}

async function main() {
  const baseRef = resolveBaseRef(parseBaseArgument(process.argv.slice(2)));
  const mergeBase = resolveMergeBase(baseRef);
  const files = selectFormatFiles(collectChangedPaths(baseRef), (path) =>
    existsSync(join(repositoryRoot, path)),
  );

  if (files.length === 0) {
    console.log(`[format-check] 검사할 변경 파일이 없습니다. base=${baseRef}`);
    return 0;
  }

  console.log(
    `[format-check] ${files.length}개 변경 파일 검사. base=${baseRef}`,
  );
  return checkFormatting(files, mergeBase);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(
      `[format-check] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
