#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "docs/agent/repository-truth.json";
const ACTIVE_SOURCE_ROOTS = [
  ".github",
  "apps",
  "infra",
  "packages",
  "services",
  "tools",
];
const ACTIVE_ROOT_FILES = new Set([
  "docker-compose.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "turbo.json",
]);

function isWithin(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

export function selectAgentSearchPaths(paths, config, options = {}) {
  const activeDocs = new Set(config.activeDocs ?? []);
  const canonicalSources = config.canonicalSources ?? [];
  const historicalRoots = config.historicalRoots ?? [];
  const includeHistorical = options.historical ?? false;

  return [...new Set(paths)]
    .filter((path) => {
      const historicalRoot = historicalRoots.find((root) =>
        isWithin(path, root),
      );
      if (historicalRoot) {
        return includeHistorical;
      }
      return (
        ACTIVE_ROOT_FILES.has(path) ||
        ACTIVE_SOURCE_ROOTS.some((root) => isWithin(path, root)) ||
        activeDocs.has(path) ||
        canonicalSources.some((root) => isWithin(path, root))
      );
    })
    .sort();
}

export function parseAgentSearchArguments(argv) {
  const options = {
    historical: false,
    regex: false,
    root: process.cwd(),
    queryParts: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--historical") {
      options.historical = true;
    } else if (argument === "--regex") {
      options.regex = true;
    } else if (argument === "--root") {
      options.root = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    } else {
      options.queryParts.push(argument);
    }
  }
  if (options.queryParts.length === 0) {
    throw new Error("검색어를 입력해야 합니다.");
  }
  return options;
}

function listRepositoryFiles(root) {
  const result = spawnSync(
    "rg",
    [
      "--files",
      "--hidden",
      "-g",
      "!.git",
      "-g",
      "!node_modules",
      "-g",
      "!.venv",
      "-g",
      "!dist",
      "-g",
      "!.turbo",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || "검색 대상 파일을 찾지 못했습니다.",
    );
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

export function runAgentSearch(options) {
  const root = resolve(options.root);
  const config = JSON.parse(
    readFileSync(resolve(root, DEFAULT_CONFIG_PATH), "utf8"),
  );
  const paths = selectAgentSearchPaths(listRepositoryFiles(root), config, {
    historical: options.historical,
  });
  const query = options.queryParts.join(" ");
  const result = spawnSync(
    "rg",
    [
      "--line-number",
      "--color=never",
      "--smart-case",
      ...(options.regex ? [] : ["--fixed-strings"]),
      "--",
      query,
      ...paths,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.status === 1 ? 1 : (result.status ?? 2);
}

function main() {
  try {
    const options = parseAgentSearchArguments(process.argv.slice(2));
    process.exitCode = runAgentSearch(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  main();
}
