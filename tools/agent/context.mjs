#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DOMAIN_DIRECTORY = "docs/agent/domains";
const REQUIRED_STRING_ARRAYS = [
  "ownedPaths",
  "contracts",
  "tests",
  "fastChecks",
  "fullCheckTriggers",
  "boundaries"
];

export class DomainManifestError extends Error {
  constructor(issues) {
    super(issues.join("\n"));
    this.name = "DomainManifestError";
    this.issues = issues;
  }
}

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
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

  if (values.some((value) => typeof value !== "string" || value.trim() === "")) {
    issues.push(`${file}: ${key}의 모든 값은 비어 있지 않은 문자열이어야 합니다.`);
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

  if (!Array.isArray(manifest.entrypoints) || manifest.entrypoints.length === 0) {
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
    options.domainDirectory ?? DEFAULT_DOMAIN_DIRECTORY
  );
  const issues = [];

  if (!existsSync(domainDirectory) || !statSync(domainDirectory).isDirectory()) {
    throw new DomainManifestError([
      `${toRepoPath(root, domainDirectory)}: domain manifest 디렉터리가 없습니다.`
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
      issues.push(`${toRepoPath(root, filePath)}: JSON을 읽을 수 없습니다: ${error.message}`);
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
    issues.push(`${toRepoPath(root, domainDirectory)}: domain manifest가 없습니다.`);
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
    (entrypoint) => `${entrypoint.area}: ${entrypoint.path}`
  );
  appendList(lines, "Owned paths", manifest.ownedPaths);
  appendList(lines, "Contracts", manifest.contracts);
  appendList(lines, "Tests", manifest.tests);
  appendList(lines, "Fast checks", manifest.fastChecks, (command) => `\`${command}\``);
  appendList(lines, "Full-check triggers", manifest.fullCheckTriggers);
  appendList(lines, "Boundaries", manifest.boundaries);

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseArguments(argv) {
  const options = {
    domain: null,
    root: process.cwd(),
    domainDirectory: DEFAULT_DOMAIN_DIRECTORY,
    json: false,
    list: false
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
      domainDirectory: options.domainDirectory
    });

    if (options.list) {
      const list = catalog.map((manifest) => ({
        id: manifest.id,
        summary: manifest.summary
      }));
      process.stdout.write(
        options.json
          ? `${JSON.stringify(list, null, 2)}\n`
          : `${list.map((item) => `${item.id}\t${item.summary}`).join("\n")}\n`
      );
      return;
    }

    if (options.domain === null) {
      throw new Error("domain을 지정하거나 --list를 사용해야 합니다.");
    }

    const manifest = catalog.find((item) => item.id === options.domain);
    if (!manifest) {
      throw new Error(
        `알 수 없는 domain입니다: ${options.domain}. 사용 가능: ${catalog
          .map((item) => item.id)
          .join(", ")}`
      );
    }

    process.stdout.write(
      options.json
        ? `${JSON.stringify(manifest, null, 2)}\n`
        : renderDomainContext(manifest)
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof DomainManifestError ? 1 : 2;
  }
}

const currentEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (currentEntry === import.meta.url) {
  run();
}
