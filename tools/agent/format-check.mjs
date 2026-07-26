#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  const pathGroups = [
    git(["diff", "--name-only", "--diff-filter=ACMR", "-z", mergeBase, "HEAD"]),
    git(["diff", "--name-only", "--diff-filter=ACMR", "-z"]),
    git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]),
    git(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];

  return pathGroups.flatMap(splitNullSeparated);
}

function runPrettier(files) {
  for (let index = 0; index < files.length; index += 100) {
    const batch = files.slice(index, index + 100);
    const result = spawnSync(
      "pnpm",
      ["exec", "prettier", "--check", ...batch],
      {
        cwd: repositoryRoot,
        stdio: "inherit",
      },
    );
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

function main() {
  const baseRef = resolveBaseRef(parseBaseArgument(process.argv.slice(2)));
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
  return runPrettier(files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
