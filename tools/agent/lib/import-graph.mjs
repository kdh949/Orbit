import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import {
  SOURCE_EXTENSIONS,
  isProductionSourcePath,
  listFiles,
} from "./fs-walk.mjs";
import { toRepoPath } from "./repo-path.mjs";

const JAVASCRIPT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']([^"']+)["']/g;
const PYTHON_IMPORT_PATTERN =
  /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;
const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export function findImportSpecifiers(content, extension) {
  if (extension === ".py") {
    return [...content.matchAll(PYTHON_IMPORT_PATTERN)]
      .map((match) => match[1] ?? match[2])
      .filter(Boolean);
  }
  return [...content.matchAll(JAVASCRIPT_IMPORT_PATTERN)].map(
    (match) => match[1],
  );
}

function resolveCandidates(basePath, sourceFiles) {
  const candidates = SOURCE_EXTENSIONS.has(extname(basePath))
    ? [basePath]
    : [
        ...RESOLUTION_EXTENSIONS.map((extension) => `${basePath}${extension}`),
        ...RESOLUTION_EXTENSIONS.map((extension) =>
          join(basePath, `index${extension}`),
        ),
      ];
  return (
    candidates.find((candidate) => sourceFiles.has(resolve(candidate))) ?? null
  );
}

function resolveJavascriptImport(root, importer, specifier, sourceFiles) {
  if (specifier.startsWith(".")) {
    return resolveCandidates(
      resolve(dirname(importer), specifier),
      sourceFiles,
    );
  }
  const orbitMatch = specifier.match(/^@orbit\/([^/]+)(?:\/(.+))?$/);
  if (!orbitMatch) {
    return null;
  }
  const packageRoot = resolve(root, "packages", orbitMatch[1], "src");
  return resolveCandidates(
    orbitMatch[2]
      ? resolve(packageRoot, orbitMatch[2])
      : resolve(packageRoot, "index"),
    sourceFiles,
  );
}

function resolvePythonImport(root, importer, specifier, sourceFiles) {
  const pythonRoot = resolve(root, "services/python-worker");
  let basePath;
  if (specifier.startsWith(".")) {
    const leadingDots = specifier.match(/^\.+/)?.[0].length ?? 0;
    let directory = dirname(importer);
    for (let index = 1; index < leadingDots; index += 1) {
      directory = dirname(directory);
    }
    basePath = resolve(
      directory,
      specifier.slice(leadingDots).replaceAll(".", "/"),
    );
  } else if (specifier === "app" || specifier.startsWith("app.")) {
    basePath = resolve(pythonRoot, specifier.replaceAll(".", "/"));
  } else {
    return null;
  }
  const candidates = [`${basePath}.py`, join(basePath, "__init__.py")];
  return (
    candidates.find((candidate) => sourceFiles.has(resolve(candidate))) ?? null
  );
}

export function buildImportGraph(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const sourceRoots = options.sourceRoots ?? ["apps", "packages", "services"];
  const files = sourceRoots.flatMap((sourceRoot) =>
    listFiles(resolve(root, sourceRoot), { extensions: SOURCE_EXTENSIONS }),
  );
  const includedFiles = options.includeTests
    ? files
    : files.filter(isProductionSourcePath);
  const sourceFiles = new Set(includedFiles.map((file) => resolve(file)));
  const graph = new Map();

  for (const file of sourceFiles) {
    const extension = extname(file);
    const dependencies = findImportSpecifiers(
      readFileSync(file, "utf8"),
      extension,
    )
      .map((specifier) =>
        extension === ".py"
          ? resolvePythonImport(root, file, specifier, sourceFiles)
          : resolveJavascriptImport(root, file, specifier, sourceFiles),
      )
      .filter(Boolean)
      .map((dependency) => toRepoPath(root, dependency));
    graph.set(toRepoPath(root, file), new Set(dependencies));
  }
  return graph;
}

export function reverseImportGraph(graph) {
  const reverse = new Map([...graph.keys()].map((path) => [path, new Set()]));
  for (const [importer, dependencies] of graph) {
    for (const dependency of dependencies) {
      if (!reverse.has(dependency)) {
        reverse.set(dependency, new Set());
      }
      reverse.get(dependency).add(importer);
    }
  }
  return reverse;
}

export function collectDependencyClosure(graph, entrypoint) {
  const visited = new Set();
  const pending = [...(graph.get(entrypoint) ?? [])];
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) {
      continue;
    }
    visited.add(path);
    pending.push(...(graph.get(path) ?? []));
  }
  return visited;
}

export function existingSourcePath(rootDirectory, path) {
  return existsSync(resolve(rootDirectory, path));
}
