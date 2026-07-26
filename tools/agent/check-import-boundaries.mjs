#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
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
const rehearsalConsumerRoots = new Set([
  "editor",
  "presentation",
  "presenter-companion",
]);

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

export function findWebRuntimeFeatureImports(content, filePath, rootDirectory) {
  const root = resolve(rootDirectory);
  const runtimeRoot = resolve(root, "apps/web/src/runtime");
  const featureRoot = resolve(root, "apps/web/src/features");
  const absoluteFile = resolve(filePath);
  const relativeRuntimePath = relative(runtimeRoot, absoluteFile);

  if (
    relativeRuntimePath.startsWith("..") ||
    relativeRuntimePath === "" ||
    !codeExtensions.has(extname(absoluteFile))
  ) {
    return [];
  }

  const findings = [];
  for (const match of content.matchAll(stringLiteralPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) {
      continue;
    }
    const target = resolve(dirname(absoluteFile), specifier);
    const relativeFeaturePath = relative(featureRoot, target);
    if (relativeFeaturePath.startsWith("..") || relativeFeaturePath === "") {
      continue;
    }
    const offset = match.index ?? 0;
    findings.push({
      line: content.slice(0, offset).split("\n").length,
      specifier,
    });
  }
  return findings;
}

export function findForbiddenWebFeatureImports(
  content,
  filePath,
  rootDirectory,
) {
  const root = resolve(rootDirectory);
  const featureRoot = resolve(root, "apps/web/src/features");
  const rehearsalRoot = resolve(featureRoot, "rehearsal");
  const absoluteFile = resolve(filePath);
  const relativeFeaturePath = relative(featureRoot, absoluteFile);
  const [consumerRoot] = relativeFeaturePath.split(sep);

  if (
    relativeFeaturePath.startsWith("..") ||
    !rehearsalConsumerRoots.has(consumerRoot) ||
    !codeExtensions.has(extname(absoluteFile))
  ) {
    return [];
  }

  const findings = [];
  for (const match of content.matchAll(stringLiteralPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) {
      continue;
    }
    const target = resolve(dirname(absoluteFile), specifier);
    const relativeRehearsalPath = relative(rehearsalRoot, target);
    if (
      relativeRehearsalPath.startsWith("..") ||
      relativeRehearsalPath === ""
    ) {
      continue;
    }
    const offset = match.index ?? 0;
    findings.push({
      line: content.slice(0, offset).split("\n").length,
      specifier,
    });
  }
  return findings;
}

export function checkImportBoundaries(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const sourceRoots = options.sourceRoots ?? ["apps", "services"];
  const findings = [];

  for (const sourceRoot of sourceRoots) {
    for (const file of listCodeFiles(resolve(root, sourceRoot))) {
      const content = readFileSync(file, "utf8");
      for (const finding of findPackageSourceImports(content)) {
        findings.push({
          ...finding,
          file: toRepoPath(root, file),
          code: "FORBIDDEN_PACKAGE_SOURCE_IMPORT",
        });
      }
      for (const finding of findWebRuntimeFeatureImports(content, file, root)) {
        findings.push({
          ...finding,
          file: toRepoPath(root, file),
          code: "FORBIDDEN_WEB_RUNTIME_FEATURE_IMPORT",
        });
      }
      for (const finding of findForbiddenWebFeatureImports(
        content,
        file,
        root,
      )) {
        findings.push({
          ...finding,
          file: toRepoPath(root, file),
          code: "FORBIDDEN_WEB_FEATURE_IMPORT",
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
