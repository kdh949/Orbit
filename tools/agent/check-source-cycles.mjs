#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const sourceExtensions = [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"];
const sourceExtensionSet = new Set(sourceExtensions);
const skippedDirectories = new Set([
  ".turbo",
  ".venv",
  "coverage",
  "dist",
  "node_modules",
]);
const importPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']([^"']+)["']/g;

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function isProductionSource(path) {
  const normalized = path.split(sep).join("/");
  return (
    sourceExtensionSet.has(extname(path)) &&
    !/(?:^|\/)__tests__(?:\/|$)/.test(normalized) &&
    !/\.(?:integration\.)?(?:spec|test)\.[^.]+$/.test(normalized)
  );
}

function listSourceFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.isFile() && isProductionSource(entryPath)) {
      files.push(resolve(entryPath));
    }
  }
  return files;
}

export function findRelativeImports(content) {
  return [...content.matchAll(importPattern)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."));
}

function resolveRelativeImport(importer, specifier, sourceFiles) {
  const base = resolve(dirname(importer), specifier);
  const candidates = sourceExtensionSet.has(extname(base))
    ? [base]
    : [
        ...sourceExtensions.map((extension) => `${base}${extension}`),
        ...sourceExtensions.map((extension) => join(base, `index${extension}`)),
      ];
  return candidates.find((candidate) => sourceFiles.has(candidate));
}

function findStronglyConnectedComponents(graph) {
  let currentIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(node) {
    indices.set(node, currentIndex);
    lowLinks.set(node, currentIndex);
    currentIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), lowLinks.get(dependency)),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), indices.get(dependency)),
        );
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) {
      return;
    }
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component);
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      visit(node);
    }
  }
  return components;
}

export function findSourceCycles(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const sourceRoots = options.sourceRoots ?? ["apps", "packages", "services"];
  const files = sourceRoots.flatMap((sourceRoot) =>
    listSourceFiles(resolve(root, sourceRoot)),
  );
  const sourceFiles = new Set(files);
  const graph = new Map(
    files.map((file) => {
      const dependencies = findRelativeImports(readFileSync(file, "utf8"))
        .map((specifier) => resolveRelativeImport(file, specifier, sourceFiles))
        .filter(Boolean);
      return [file, new Set(dependencies)];
    }),
  );

  return findStronglyConnectedComponents(graph)
    .filter(
      (component) =>
        component.length > 1 ||
        (graph.get(component[0]) ?? new Set()).has(component[0]),
    )
    .map((component) =>
      component
        .map((file) => toRepoPath(root, file))
        .sort((left, right) => left.localeCompare(right)),
    )
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function run() {
  const cycles = findSourceCycles(process.cwd());
  if (cycles.length === 0) {
    console.log("source cycle 검사 통과");
    return;
  }

  for (const [index, cycle] of cycles.entries()) {
    console.error(`source cycle ${index + 1}:`);
    for (const file of cycle) {
      console.error(`  - ${file}`);
    }
  }
  console.error(`source cycle ${cycles.length}개`);
  process.exitCode = 1;
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
