#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const codeExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const skippedDirectories = new Set([
  ".turbo",
  ".venv",
  "coverage",
  "dist",
  "node_modules",
]);
const stringLiteralPattern = /["']([^"'\r\n]+)["']/g;
const packageSourcePattern = /(?:^|\/)packages\/[^/]+\/src(?:\/|$)/;

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function listCodeFiles(directory) {
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
      files.push(...listCodeFiles(entryPath));
    } else if (entry.isFile() && codeExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

export function findPackageSourceImports(content) {
  const findings = [];
  for (const match of content.matchAll(stringLiteralPattern)) {
    const specifier = match[1];
    if (!packageSourcePattern.test(specifier)) {
      continue;
    }
    const offset = match.index ?? 0;
    const line = content.slice(0, offset).split("\n").length;
    findings.push({ line, specifier });
  }
  return findings;
}

export function checkImportBoundaries(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const sourceRoots = options.sourceRoots ?? ["apps", "services"];
  const findings = [];

  for (const sourceRoot of sourceRoots) {
    for (const file of listCodeFiles(resolve(root, sourceRoot))) {
      for (const finding of findPackageSourceImports(
        readFileSync(file, "utf8"),
      )) {
        findings.push({
          ...finding,
          file: toRepoPath(root, file),
          code: "FORBIDDEN_PACKAGE_SOURCE_IMPORT",
        });
      }
    }
  }

  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line,
  );
}

function run() {
  const findings = checkImportBoundaries(process.cwd());
  if (findings.length === 0) {
    console.log("import boundary 검사 통과");
    return;
  }

  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line} ${finding.code} ${finding.specifier}`,
    );
  }
  console.error(`import boundary 위반 ${findings.length}개`);
  process.exitCode = 1;
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
