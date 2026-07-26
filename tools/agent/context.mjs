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
const V1_REQUIRED_STRING_ARRAYS = [
  "ownedPaths",
  "contracts",
  "tests",
  "fastChecks",
  "fullCheckTriggers",
  "boundaries",
];
const V2_REQUIRED_STRING_ARRAYS = [
  "owns",
  "primaryContracts",
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

function validateOptionalStringArray(manifest, key, file, issues) {
  if (manifest[key] === undefined) {
    return;
  }
  if (!Array.isArray(manifest[key])) {
    issues.push(`${file}: ${key}는 배열이어야 합니다.`);
    return;
  }
  if (
    manifest[key].some(
      (value) => typeof value !== "string" || value.trim() === "",
    )
  ) {
    issues.push(
      `${file}: ${key}의 모든 값은 비어 있지 않은 문자열이어야 합니다.`,
    );
  }
  if (new Set(manifest[key]).size !== manifest[key].length) {
    issues.push(`${file}: ${key}에 중복 값이 있습니다.`);
  }
}

function normalizeManifest(manifest) {
  if (manifest.schemaVersion === 1) {
    return {
      ...manifest,
      excludedPaths: [],
      primaryContracts: [],
      secondaryContracts: manifest.contracts,
      testOwners: [],
      verificationProfiles: {
        leaf: manifest.fastChecks,
        crossBoundary: ["pnpm verify:affected"],
      },
      allowedDependencies: [],
      forbiddenDependencies: [],
    };
  }
  const tests = [
    ...new Set(
      (manifest.testOwners ?? []).flatMap((owner) => owner.tests ?? []),
    ),
  ];
  const fastChecks = [
    ...new Set(Object.values(manifest.verificationProfiles ?? {}).flat()),
  ];
  return {
    ...manifest,
    ownedPaths: manifest.owns,
    excludedPaths: manifest.excludes ?? [],
    contracts: [
      ...new Set([
        ...(manifest.primaryContracts ?? []),
        ...(manifest.secondaryContracts ?? []),
      ]),
    ],
    tests,
    fastChecks,
    testOwners: manifest.testOwners ?? [],
    secondaryContracts: manifest.secondaryContracts ?? [],
    allowedDependencies: manifest.allowedDependencies ?? [],
    forbiddenDependencies: manifest.forbiddenDependencies ?? [],
  };
}

function validateManifest(root, filePath, manifest) {
  const file = toRepoPath(root, filePath);
  const issues = [];

  if (![1, 2].includes(manifest.schemaVersion)) {
    issues.push(`${file}: schemaVersion은 1 또는 2여야 합니다.`);
  }
  if (typeof manifest.id !== "string" || !/^[a-z0-9-]+$/.test(manifest.id)) {
    issues.push(`${file}: id는 소문자, 숫자, 하이픈만 사용해야 합니다.`);
  } else if (basename(filePath, ".json") !== manifest.id) {
    issues.push(`${file}: 파일 이름과 domain id가 일치해야 합니다.`);
  }
  if (typeof manifest.summary !== "string" || manifest.summary.trim() === "") {
    issues.push(`${file}: summary가 필요합니다.`);
  }

  const requiredArrays =
    manifest.schemaVersion === 2
      ? V2_REQUIRED_STRING_ARRAYS
      : V1_REQUIRED_STRING_ARRAYS;
  for (const key of requiredArrays) {
    validateStringArray(manifest, key, file, issues);
  }
  if (manifest.schemaVersion === 2) {
    for (const key of [
      "excludes",
      "secondaryContracts",
      "allowedDependencies",
      "forbiddenDependencies",
    ]) {
      validateOptionalStringArray(manifest, key, file, issues);
    }
    if (
      typeof manifest.verificationProfiles !== "object" ||
      manifest.verificationProfiles === null ||
      !Array.isArray(manifest.verificationProfiles.leaf) ||
      manifest.verificationProfiles.leaf.length === 0
    ) {
      issues.push(
        `${file}: verificationProfiles.leaf는 비어 있지 않은 배열이어야 합니다.`,
      );
    } else {
      for (const [profile, commands] of Object.entries(
        manifest.verificationProfiles,
      )) {
        if (
          !Array.isArray(commands) ||
          commands.some(
            (command) => typeof command !== "string" || command.trim() === "",
          )
        ) {
          issues.push(
            `${file}: verificationProfiles.${profile}가 유효하지 않습니다.`,
          );
        }
      }
    }
    if (!Array.isArray(manifest.testOwners)) {
      issues.push(`${file}: testOwners는 배열이어야 합니다.`);
    } else {
      for (const owner of manifest.testOwners) {
        if (
          typeof owner?.source !== "string" ||
          owner.source.trim() === "" ||
          !Array.isArray(owner.tests) ||
          owner.tests.length === 0
        ) {
          issues.push(
            `${file}: testOwners 항목에는 source와 비어 있지 않은 tests가 필요합니다.`,
          );
          continue;
        }
        if (!existsSync(resolve(root, ownedPathAnchor(owner.source)))) {
          issues.push(
            `${file}: test owner 기준 경로가 없습니다: ${owner.source}`,
          );
        }
        for (const test of owner.tests) {
          if (!existsSync(resolve(root, test))) {
            issues.push(`${file}: testOwners 경로가 없습니다: ${test}`);
          }
        }
      }
    }
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

  const ownedPaths =
    manifest.schemaVersion === 2 ? manifest.owns : manifest.ownedPaths;
  if (Array.isArray(ownedPaths)) {
    for (const ownedPath of ownedPaths) {
      if (
        typeof ownedPath === "string" &&
        !existsSync(resolve(root, ownedPathAnchor(ownedPath)))
      ) {
        issues.push(`${file}: owned path 기준 경로가 없습니다: ${ownedPath}`);
      }
    }
  }

  const pathGroups =
    manifest.schemaVersion === 2
      ? ["primaryContracts", "secondaryContracts"]
      : ["contracts", "tests"];
  for (const key of pathGroups) {
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
    manifests.push(normalizeManifest(manifest));
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
  if (manifest.excludedPaths.length > 0) {
    appendList(lines, "Excluded paths", manifest.excludedPaths);
  }
  appendList(lines, "Primary contracts", manifest.primaryContracts);
  appendList(lines, "Secondary contracts", manifest.secondaryContracts);
  appendList(
    lines,
    "Test owners",
    manifest.testOwners,
    (owner) => `${owner.source} → ${owner.tests.join(", ")}`,
  );
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

function addTestSelection(selections, path, reason, confidence) {
  if (!selections.has(path)) {
    selections.set(path, { path, reason, confidence });
  }
}

function adjacentTests(path, graph, reverseGraph, manifests) {
  const extension = extname(path);
  const pathWithoutExtension = path.slice(0, -extension.length);
  const directory = dirname(path);
  const basenameWithoutExtension = basename(pathWithoutExtension);
  const selections = new Map();

  for (const manifest of manifests) {
    for (const owner of manifest.testOwners) {
      if (matchesRepoGlob(path, owner.source)) {
        for (const test of owner.tests) {
          if (graph.has(test)) {
            addTestSelection(
              selections,
              test,
              `explicit owner: ${owner.source}`,
              "high",
            );
          }
        }
      }
    }
  }

  if (selections.size === 0) {
    for (const candidate of graph.keys()) {
      if (!isTestPath(candidate)) {
        continue;
      }
      if (
        dirname(candidate) === directory &&
        (basename(candidate).startsWith(`${basenameWithoutExtension}.test.`) ||
          basename(candidate).startsWith(`${basenameWithoutExtension}.spec.`))
      ) {
        addTestSelection(selections, candidate, "same basename", "high");
      }
    }
  }

  if (selections.size === 0) {
    let frontier = new Set([path]);
    const visited = new Set([path]);
    for (let depth = 1; depth <= 2; depth += 1) {
      const next = new Set();
      for (const dependency of frontier) {
        for (const importer of reverseGraph.get(dependency) ?? []) {
          if (isTestPath(importer)) {
            addTestSelection(
              selections,
              importer,
              `reverse importer depth=${depth}`,
              depth === 1 ? "high" : "medium",
            );
          } else if (!visited.has(importer)) {
            visited.add(importer);
            next.add(importer);
          }
        }
      }
      if (selections.size > 0) {
        break;
      }
      frontier = next;
    }
  }

  if (selections.size === 0) {
    const featureMatch = path.match(
      /^(apps\/web\/src\/features\/[^/]+|apps\/(?:api|worker)\/src\/[^/]+)\//,
    );
    if (featureMatch) {
      for (const candidate of [...graph.keys()].sort()) {
        if (
          isTestPath(candidate) &&
          candidate.startsWith(`${featureMatch[1]}/`)
        ) {
          addTestSelection(
            selections,
            candidate,
            `same feature: ${featureMatch[1]}`,
            "low",
          );
          if (selections.size >= 3) {
            break;
          }
        }
      }
    }
  }
  return [...selections.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
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

function workspaceTestCommand(workspace) {
  if (workspace.language === "python") {
    return "cd services/python-worker && uv run pytest";
  }
  if (workspace.packageName) {
    return `pnpm turbo run test --filter=${workspace.packageName} --env-mode=loose`;
  }
  if (workspace.area === "agent-tool") {
    return "pnpm test:agent";
  }
  return null;
}

function appliedAgentInstructions(root, path) {
  const directories = dirname(path).split("/").filter(Boolean);
  const candidates = ["AGENTS.md"];
  let current = "";
  for (const directory of directories) {
    current = current ? `${current}/${directory}` : directory;
    candidates.push(`${current}/AGENTS.md`);
  }
  return candidates.filter((candidate) => existsSync(resolve(root, candidate)));
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
  const matchingDomains = catalog.filter(
    (manifest) =>
      manifest.ownedPaths.some((pattern) => matchesRepoGlob(path, pattern)) &&
      !manifest.excludedPaths.some((pattern) => matchesRepoGlob(path, pattern)),
  );
  const graph =
    options.graph ??
    buildImportGraph(root, {
      includeTests: true,
      sourceRoots: ["apps", "packages", "services", "src", "tests", "tools"],
    });
  const reverseGraph = options.reverseGraph ?? reverseImportGraph(graph);
  const workspace = classifyWorkspace(path);
  const testSelections = adjacentTests(
    path,
    graph,
    reverseGraph,
    matchingDomains,
  );
  const tests = testSelections.map((selection) => selection.path);
  const directDependencies = [...(graph.get(path) ?? [])].sort();
  const reverseDependencies = [...(reverseGraph.get(path) ?? [])].sort();
  const dependencyClosure = collectDependencyClosure(graph, path);
  const primaryContracts = [
    ...new Set(
      matchingDomains.flatMap((manifest) => manifest.primaryContracts),
    ),
  ].slice(0, 5);
  const secondaryContracts = [
    ...new Set(
      matchingDomains.flatMap((manifest) => manifest.secondaryContracts),
    ),
  ]
    .filter(
      (contract) =>
        contract === path ||
        directDependencies.includes(contract) ||
        (options.explainAll && dependencyClosure.has(contract)),
    )
    .slice(0, 5);
  const legacyTransitiveContracts = [
    ...new Set(
      matchingDomains
        .filter((manifest) => manifest.schemaVersion === 1)
        .flatMap((manifest) => manifest.contracts),
    ),
  ].filter((contract) => contract === path || dependencyClosure.has(contract));
  const contracts = [
    ...new Set([
      ...primaryContracts,
      ...secondaryContracts,
      ...legacyTransitiveContracts,
    ]),
  ];
  const contractSelections = contracts.map((contract) => ({
    path: contract,
    tier: primaryContracts.includes(contract)
      ? "primary"
      : secondaryContracts.includes(contract)
        ? "secondary"
        : "transitive",
    reason: primaryContracts.includes(contract)
      ? "domain primary contract"
      : contract === path
        ? "target contract"
        : directDependencies.includes(contract)
          ? "direct dependency"
          : "transitive dependency",
  }));
  const agentInstructions = appliedAgentInstructions(root, path);
  const nearestAgentInstructions =
    agentInstructions.at(-1) ??
    findNearestFile(root, path, "AGENTS.md", existsSync);
  const selectedTestCommands = tests
    .map((test) => testCommand(test, classifyWorkspace(test)))
    .filter(Boolean);
  const fallbackTestCommand =
    selectedTestCommands.length === 0 ? workspaceTestCommand(workspace) : null;

  return {
    path,
    workspace,
    capability: inferCapability(path, matchingDomains, workspace),
    nearestAgentInstructions,
    appliedAgentInstructions: agentInstructions,
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
    testSelections: testSelections.slice(0, 20),
    contracts: [...new Set(contracts)].sort(),
    contractSelections,
    verification: {
      tier0: ["pnpm lint:boundaries", "pnpm lint:cycles", "pnpm format:check"],
      tier1:
        selectedTestCommands.length > 0
          ? selectedTestCommands
          : [fallbackTestCommand].filter(Boolean),
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
    `- applied instructions: ${
      context.appliedAgentInstructions.join(", ") || "없음"
    }`,
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
  appendCountedList(
    lines,
    "Adjacent tests",
    context.testSelections.map(
      (selection) =>
        `${selection.path} [${selection.confidence}] — ${selection.reason}`,
    ),
  );
  appendCountedList(
    lines,
    "Contracts",
    context.contractSelections.map(
      (selection) =>
        `${selection.path} [${selection.tier}] — ${selection.reason}`,
    ),
  );
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
    explainAll: false,
    list: false,
    path: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--explain-all") {
      options.explainAll = true;
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
        explainAll: options.explainAll,
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
