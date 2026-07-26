#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isTestPath } from "./lib/fs-walk.mjs";
import {
  buildImportGraph,
  collectDependencyClosure,
  reverseImportGraph,
} from "./lib/import-graph.mjs";
import {
  classifyWorkspace,
  findNearestFile,
  matchesRepoGlob,
  normalizeRepoPath,
  toRepoPath,
} from "./lib/repo-path.mjs";

const DEFAULT_DOMAIN_DIRECTORY = "docs/agent/domains";
const REQUIRED_STRING_ARRAYS = [
  "ownedPaths",
  "contracts",
  "tests",
  "fastChecks",
  "fullCheckTriggers",
  "boundaries",
];

export class DomainManifestError extends Error {
  constructor(issues) {
    super(issues.join("\n"));
    this.name = "DomainManifestError";
    this.issues = issues;
  }
}

function readManifest(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function firstGlobIndex(path) {
  const indexes = ["*", "?", "["]
    .map((marker) => path.indexOf(marker))
    .filter((index) => index !== -1);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function ownedPathAnchor(path) {
  const globIndex = firstGlobIndex(path);
  if (globIndex === -1) {
    return path;
  }

  const prefix = path.slice(0, globIndex);
  const slashIndex = prefix.lastIndexOf("/");
  return slashIndex === -1 ? "." : prefix.slice(0, slashIndex);
}

function validateStringArray(manifest, key, file, issues) {
  const values = manifest[key];
  if (!Array.isArray(values) || values.length === 0) {
    issues.push(`${file}: ${key}는 비어 있지 않은 배열이어야 합니다.`);
    return;
  }

  if (
    values.some((value) => typeof value !== "string" || value.trim() === "")
  ) {
    issues.push(
      `${file}: ${key}의 모든 값은 비어 있지 않은 문자열이어야 합니다.`,
    );
  }

  if (new Set(values).size !== values.length) {
    issues.push(`${file}: ${key}에 중복 값이 있습니다.`);
  }
}

function validateManifest(root, filePath, manifest) {
  const file = toRepoPath(root, filePath);
  const issues = [];

  if (manifest.schemaVersion !== 1) {
    issues.push(`${file}: schemaVersion은 1이어야 합니다.`);
  }
  if (typeof manifest.id !== "string" || !/^[a-z0-9-]+$/.test(manifest.id)) {
    issues.push(`${file}: id는 소문자, 숫자, 하이픈만 사용해야 합니다.`);
  } else if (basename(filePath, ".json") !== manifest.id) {
    issues.push(`${file}: 파일 이름과 domain id가 일치해야 합니다.`);
  }
  if (typeof manifest.summary !== "string" || manifest.summary.trim() === "") {
    issues.push(`${file}: summary가 필요합니다.`);
  }

  for (const key of REQUIRED_STRING_ARRAYS) {
    validateStringArray(manifest, key, file, issues);
  }

  if (
    !Array.isArray(manifest.entrypoints) ||
    manifest.entrypoints.length === 0
  ) {
    issues.push(`${file}: entrypoints는 비어 있지 않은 배열이어야 합니다.`);
  } else {
    const entrypointKeys = [];
    for (const entrypoint of manifest.entrypoints) {
      if (
        typeof entrypoint?.area !== "string" ||
        entrypoint.area.trim() === "" ||
        typeof entrypoint?.path !== "string" ||
        entrypoint.path.trim() === ""
      ) {
        issues.push(`${file}: entrypoint에는 area와 path가 필요합니다.`);
        continue;
      }
      entrypointKeys.push(`${entrypoint.area}:${entrypoint.path}`);
      if (!existsSync(resolve(root, entrypoint.path))) {
        issues.push(`${file}: entrypoint가 없습니다: ${entrypoint.path}`);
      }
    }
    if (new Set(entrypointKeys).size !== entrypointKeys.length) {
      issues.push(`${file}: entrypoints에 중복 값이 있습니다.`);
    }
  }

  if (Array.isArray(manifest.ownedPaths)) {
    for (const ownedPath of manifest.ownedPaths) {
      if (
        typeof ownedPath === "string" &&
        !existsSync(resolve(root, ownedPathAnchor(ownedPath)))
      ) {
        issues.push(`${file}: owned path 기준 경로가 없습니다: ${ownedPath}`);
      }
    }
  }

  for (const key of ["contracts", "tests"]) {
    if (!Array.isArray(manifest[key])) {
      continue;
    }
    for (const path of manifest[key]) {
      if (typeof path === "string" && !existsSync(resolve(root, path))) {
        issues.push(`${file}: ${key} 경로가 없습니다: ${path}`);
      }
    }
  }

  return issues;
}

export function loadDomainCatalog(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const domainDirectory = resolve(
    root,
    options.domainDirectory ?? DEFAULT_DOMAIN_DIRECTORY,
  );
  const issues = [];

  if (
    !existsSync(domainDirectory) ||
    !statSync(domainDirectory).isDirectory()
  ) {
    throw new DomainManifestError([
      `${toRepoPath(root, domainDirectory)}: domain manifest 디렉터리가 없습니다.`,
    ]);
  }

  const manifests = [];
  const files = readdirSync(domainDirectory)
    .filter((file) => file.endsWith(".json"))
    .sort();

  for (const file of files) {
    const filePath = join(domainDirectory, file);
    let manifest;
    try {
      manifest = readManifest(filePath);
    } catch (error) {
      issues.push(
        `${toRepoPath(root, filePath)}: JSON을 읽을 수 없습니다: ${error.message}`,
      );
      continue;
    }
    issues.push(...validateManifest(root, filePath, manifest));
    manifests.push(manifest);
  }

  const seenIds = new Set();
  for (const manifest of manifests) {
    if (seenIds.has(manifest.id)) {
      issues.push(`domain id가 중복됩니다: ${manifest.id}`);
    }
    seenIds.add(manifest.id);
  }

  if (files.length === 0) {
    issues.push(
      `${toRepoPath(root, domainDirectory)}: domain manifest가 없습니다.`,
    );
  }

  if (issues.length > 0) {
    throw new DomainManifestError(issues.sort());
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}

function appendList(lines, heading, values, format = (value) => value) {
  lines.push(`## ${heading}`, "");
  for (const value of values) {
    lines.push(`- ${format(value)}`);
  }
  lines.push("");
}

export function renderDomainContext(manifest) {
  const lines = [`# ${manifest.id}`, "", manifest.summary, ""];

  appendList(
    lines,
    "Entrypoints",
    manifest.entrypoints,
    (entrypoint) => `${entrypoint.area}: ${entrypoint.path}`,
  );
  appendList(lines, "Owned paths", manifest.ownedPaths);
  appendList(lines, "Contracts", manifest.contracts);
  appendList(lines, "Tests", manifest.tests);
  appendList(
    lines,
    "Fast checks",
    manifest.fastChecks,
    (command) => `\`${command}\``,
  );
  appendList(lines, "Full-check triggers", manifest.fullCheckTriggers);
  appendList(lines, "Boundaries", manifest.boundaries);

  return `${lines.join("\n").trimEnd()}\n`;
}

function inferCapability(path, manifests, workspace) {
  const segments = path.split("/");
  const srcIndex = segments.indexOf("src");
  if (srcIndex !== -1) {
    const layer = segments[srcIndex + 1];
    const capability = ["features", "runtime", "ai", "routers"].includes(layer)
      ? segments[srcIndex + 2]
      : layer;
    if (capability) {
      return capability.replace(/\.[^.]+$/, "");
    }
  }
  if (manifests.length > 0) {
    return manifests.map((manifest) => manifest.id).join("+");
  }
  return workspace.area;
}

function adjacentTests(path, graph, reverseGraph, manifests) {
  const extension = extname(path);
  const pathWithoutExtension = path.slice(0, -extension.length);
  const directory = dirname(path);
  const basenameWithoutExtension = basename(pathWithoutExtension);
  const candidates = new Set();

  for (const candidate of graph.keys()) {
    if (!isTestPath(candidate)) {
      continue;
    }
    if (
      dirname(candidate) === directory &&
      (basename(candidate).startsWith(`${basenameWithoutExtension}.test.`) ||
        basename(candidate).startsWith(`${basenameWithoutExtension}.spec.`))
    ) {
      candidates.add(candidate);
    }
  }
  for (const importer of reverseGraph.get(path) ?? []) {
    if (isTestPath(importer)) {
      candidates.add(importer);
    }
  }
  if (candidates.size === 0) {
    for (const manifest of manifests) {
      for (const test of manifest.tests ?? []) {
        if (graph.has(test)) {
          candidates.add(test);
        }
      }
    }
  }
  return [...candidates].sort();
}

function testCommand(path, workspace) {
  if (path.startsWith("tools/agent/") && path.endsWith(".test.mjs")) {
    return `node --test ${path}`;
  }
  if (workspace.language === "python") {
    return `cd services/python-worker && uv run pytest ${path.replace(
      "services/python-worker/",
      "",
    )}`;
  }
  if (workspace.packageName) {
    return `pnpm turbo run test --filter=${workspace.packageName} --env-mode=loose -- ${path.replace(
      `${workspace.root}/`,
      "",
    )}`;
  }
  return null;
}

function tierTwoCommands(workspace) {
  if (workspace.language === "python") {
    return [
      "cd services/python-worker && uv run ruff check .",
      "cd services/python-worker && uv run mypy app",
    ];
  }
  if (workspace.packageName) {
    return [
      `pnpm turbo run typecheck --filter=${workspace.packageName} --env-mode=loose`,
    ];
  }
  if (workspace.area === "agent-tool") {
    return ["pnpm test:agent"];
  }
  return [];
}

export function createPathContext(rootDirectory, inputPath, options = {}) {
  const root = resolve(rootDirectory);
  const path = normalizeRepoPath(root, inputPath);
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory()) {
    throw new Error(`분석할 파일이 없습니다: ${path}`);
  }

  const catalog =
    options.catalog ??
    loadDomainCatalog(root, {
      domainDirectory: options.domainDirectory ?? DEFAULT_DOMAIN_DIRECTORY,
    });
  const matchingDomains = catalog.filter((manifest) =>
    manifest.ownedPaths.some((pattern) => matchesRepoGlob(path, pattern)),
  );
  const graph =
    options.graph ??
    buildImportGraph(root, {
      includeTests: true,
      sourceRoots: ["apps", "packages", "services", "src", "tests", "tools"],
    });
  const reverseGraph = options.reverseGraph ?? reverseImportGraph(graph);
  const workspace = classifyWorkspace(path);
  const tests = adjacentTests(path, graph, reverseGraph, matchingDomains);
  const directDependencies = [...(graph.get(path) ?? [])].sort();
  const reverseDependencies = [...(reverseGraph.get(path) ?? [])].sort();
  const dependencyClosure = collectDependencyClosure(graph, path);
  const knownContracts = new Set(
    catalog.flatMap((manifest) => manifest.contracts),
  );
  const contracts = [...knownContracts].filter(
    (contract) => contract === path || dependencyClosure.has(contract),
  );
  const nearestAgentInstructions = findNearestFile(
    root,
    path,
    "AGENTS.md",
    existsSync,
  );

  return {
    path,
    workspace,
    capability: inferCapability(path, matchingDomains, workspace),
    nearestAgentInstructions,
    ownership: {
      status:
        matchingDomains.length === 0
          ? "fallback"
          : matchingDomains.length === 1
            ? "owned"
            : "overlap",
      domains: matchingDomains.map((manifest) => manifest.id),
    },
    dependencies: {
      direct: directDependencies.slice(0, 20),
      directCount: directDependencies.length,
      reverse: reverseDependencies.slice(0, 20),
      reverseCount: reverseDependencies.length,
    },
    tests: tests.slice(0, 20),
    contracts: [...new Set(contracts)].sort(),
    verification: {
      tier0: ["pnpm lint:boundaries", "pnpm lint:cycles", "pnpm format:check"],
      tier1: tests
        .map((test) => testCommand(test, classifyWorkspace(test)))
        .filter(Boolean),
      tier2: tierTwoCommands(workspace),
      escalationReasons: matchingDomains.flatMap(
        (manifest) => manifest.fullCheckTriggers,
      ),
    },
  };
}

function appendCountedList(lines, heading, values, total = values.length) {
  lines.push(`## ${heading} (${total})`, "");
  if (values.length === 0) {
    lines.push("- 없음", "");
    return;
  }
  for (const value of values) {
    lines.push(`- ${value}`);
  }
  lines.push("");
}

export function renderPathContext(context) {
  const lines = [
    `# ${context.path}`,
    "",
    `- workspace: ${context.workspace.area} (${context.workspace.root})`,
    `- capability: ${context.capability}`,
    `- AGENTS.md: ${context.nearestAgentInstructions ?? "없음"}`,
    `- ownership: ${context.ownership.status} [${
      context.ownership.domains.join(", ") || "manifest 없음"
    }]`,
    "",
  ];
  appendCountedList(
    lines,
    "Direct dependencies",
    context.dependencies.direct,
    context.dependencies.directCount,
  );
  appendCountedList(
    lines,
    "Reverse dependencies",
    context.dependencies.reverse,
    context.dependencies.reverseCount,
  );
  appendCountedList(lines, "Adjacent tests", context.tests);
  appendCountedList(lines, "Contracts", context.contracts);
  appendCountedList(lines, "Tier 0", context.verification.tier0);
  appendCountedList(lines, "Tier 1", context.verification.tier1);
  appendCountedList(lines, "Tier 2", context.verification.tier2);
  appendCountedList(
    lines,
    "Full-check escalation",
    context.verification.escalationReasons,
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function parseArguments(argv) {
  const options = {
    domain: null,
    root: process.cwd(),
    domainDirectory: DEFAULT_DOMAIN_DIRECTORY,
    json: false,
    list: false,
    path: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--list") {
      options.list = true;
    } else if (argument === "--root") {
      options.root = argv[index + 1];
      index += 1;
    } else if (argument === "--domain-dir") {
      options.domainDirectory = argv[index + 1];
      index += 1;
    } else if (argument === "--path") {
      options.path = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    } else if (options.domain === null) {
      options.domain = argument;
    } else {
      throw new Error(`domain은 하나만 지정할 수 있습니다: ${argument}`);
    }
  }

  return options;
}

function run() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const catalog = loadDomainCatalog(options.root, {
      domainDirectory: options.domainDirectory,
    });

    if (options.list) {
      const list = catalog.map((manifest) => ({
        id: manifest.id,
        summary: manifest.summary,
      }));
      process.stdout.write(
        options.json
          ? `${JSON.stringify(list, null, 2)}\n`
          : `${list.map((item) => `${item.id}\t${item.summary}`).join("\n")}\n`,
      );
      return;
    }

    if (options.path !== null) {
      const context = createPathContext(options.root, options.path, {
        catalog,
        domainDirectory: options.domainDirectory,
      });
      process.stdout.write(
        options.json
          ? `${JSON.stringify(context, null, 2)}\n`
          : renderPathContext(context),
      );
      return;
    }

    if (options.domain === null) {
      throw new Error("domain을 지정하거나 --list/--path를 사용해야 합니다.");
    }

    const manifest = catalog.find((item) => item.id === options.domain);
    if (!manifest) {
      throw new Error(
        `알 수 없는 domain입니다: ${options.domain}. 사용 가능: ${catalog
          .map((item) => item.id)
          .join(", ")}`,
      );
    }

    process.stdout.write(
      options.json
        ? `${JSON.stringify(manifest, null, 2)}\n`
        : renderDomainContext(manifest),
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof DomainManifestError ? 1 : 2;
  }
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
