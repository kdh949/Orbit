#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectChangedPaths,
  gitRefExists,
  resolveBaseRef as resolveGitBaseRef,
  resolveMergeBase as resolveGitMergeBase,
  runGit,
  splitNullSeparated,
} from "./lib/git-changes.mjs";

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

function git(args, options = {}) {
  return runGit(repositoryRoot, args, options);
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

function resolveBaseRef(explicitBase) {
  try {
    return resolveGitBaseRef(repositoryRoot, explicitBase, "FORMAT_CHECK_BASE");
  } catch (error) {
    const requested = explicitBase ?? process.env.FORMAT_CHECK_BASE;
    throw new Error(
      requested
        ? `format check 기준 ref를 찾을 수 없습니다: ${requested}`
        : error.message,
    );
  }
}

export function parseRenameSources(output) {
  const fields = splitNullSeparated(output);
  const renameSources = new Map();

  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    if (!status?.startsWith("R")) {
      index += 1;
      continue;
    }

    const sourcePath = fields[index + 1];
    const targetPath = fields[index + 2];
    if (sourcePath && targetPath) {
      renameSources.set(targetPath, sourcePath);
    }
    index += 2;
  }

  return renameSources;
}

function collectRenameSources(baseRef) {
  const mergeBase = resolveMergeBase(baseRef);
  const renameSources = new Map();
  const outputs = [
    git(["diff", "--name-status", "--find-renames", "-z", mergeBase, "HEAD"]),
    git(["diff", "--cached", "--name-status", "--find-renames", "-z"]),
  ];

  for (const output of outputs) {
    for (const [targetPath, sourcePath] of parseRenameSources(output)) {
      renameSources.set(targetPath, sourcePath);
    }
  }

  return renameSources;
}

export function resolveMergeBase(baseRef) {
  return resolveGitMergeBase(repositoryRoot, baseRef);
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
  const { format, resolveConfig } = await import("prettier");
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

async function checkFormatting(files, mergeBase, renameSources) {
  const regressions = [];
  const legacy = [];

  for (const path of files) {
    const currentContent = readFileSync(join(repositoryRoot, path), "utf8");
    const currentFormatted = await isFormatted(path, currentContent);
    const basePath = renameSources.get(path) ?? path;
    const baseContent = currentFormatted
      ? undefined
      : readBaseContent(mergeBase, basePath);
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
  const renameSources = collectRenameSources(baseRef);
  const files = selectFormatFiles(
    collectChangedPaths(baseRef, { root: repositoryRoot }),
    (path) => existsSync(join(repositoryRoot, path)),
  );

  if (files.length === 0) {
    console.log(`[format-check] 검사할 변경 파일이 없습니다. base=${baseRef}`);
    return 0;
  }

  console.log(
    `[format-check] ${files.length}개 변경 파일 검사. base=${baseRef}`,
  );
  return checkFormatting(files, mergeBase, renameSources);
}

export { collectChangedPaths, gitRefExists };

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
