import fs from "node:fs";
import path from "node:path";

const importPattern = /^\s*@import\s+["']([^"']+)["'];\s*$/gm;

export function readCssBundle(
  entryPath: string,
  visited = new Set<string>(),
): string {
  const resolvedEntryPath = path.resolve(entryPath);
  if (visited.has(resolvedEntryPath)) {
    throw new Error(`CSS import cycle detected: ${resolvedEntryPath}`);
  }

  visited.add(resolvedEntryPath);
  const source = fs.readFileSync(resolvedEntryPath, "utf8");
  const imports = [...source.matchAll(importPattern)];
  if (imports.length === 0) {
    return source;
  }

  const bundle = imports
    .map((match) => {
      const importPath = match[1];
      if (!importPath) {
        throw new Error(`CSS import path is missing: ${resolvedEntryPath}`);
      }
      return readCssBundle(
        path.resolve(path.dirname(resolvedEntryPath), importPath),
        visited,
      );
    })
    .join("");
  visited.delete(resolvedEntryPath);
  return bundle;
}
