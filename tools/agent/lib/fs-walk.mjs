import { existsSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export const DEFAULT_SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  ".venv",
  "coverage",
  "dist",
  "node_modules",
]);

export const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".ts",
  ".tsx",
]);

export function listFiles(rootPath, options = {}) {
  const root = resolve(rootPath);
  if (!existsSync(root)) {
    return [];
  }

  const extensions = options.extensions ? new Set(options.extensions) : null;
  const skippedDirectories =
    options.skippedDirectories ?? DEFAULT_SKIPPED_DIRECTORIES;
  const files = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
        continue;
      }
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (
        entry.isFile() &&
        (!extensions || extensions.has(extname(entry.name)))
      ) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function isTestPath(path) {
  const normalized = path.replaceAll("\\", "/");
  return (
    /(?:^|\/)(?:__tests__|tests)(?:\/|$)/.test(normalized) ||
    /\.(?:integration\.)?(?:spec|test)\.[^.]+$/.test(normalized)
  );
}

export function isProductionSourcePath(path) {
  return SOURCE_EXTENSIONS.has(extname(path)) && !isTestPath(path);
}
