import { dirname, extname, relative, resolve, sep } from "node:path";

export function toRepoPath(rootDirectory, absolutePath) {
  return relative(resolve(rootDirectory), resolve(absolutePath))
    .split(sep)
    .join("/");
}

export function normalizeRepoPath(rootDirectory, path) {
  const root = resolve(rootDirectory);
  const absolutePath = resolve(root, path);
  const repoPath = toRepoPath(root, absolutePath);
  if (
    repoPath === ".." ||
    repoPath.startsWith("../") ||
    repoPath.startsWith(`..${sep}`)
  ) {
    throw new Error(`repository 밖의 경로는 사용할 수 없습니다: ${path}`);
  }
  return repoPath === "" ? "." : repoPath;
}

export function isPathInside(parentPath, candidatePath) {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.startsWith(sep))
  );
}

export function findNearestFile(
  rootDirectory,
  targetPath,
  fileName,
  fileExists,
) {
  const root = resolve(rootDirectory);
  const absoluteTarget = resolve(root, targetPath);
  let current = extname(absoluteTarget)
    ? dirname(absoluteTarget)
    : absoluteTarget;

  while (isPathInside(root, current)) {
    const candidate = resolve(current, fileName);
    if (fileExists(candidate)) {
      return toRepoPath(root, candidate);
    }
    if (current === root) {
      break;
    }
    current = dirname(current);
  }
  return null;
}

export function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];

    if (character === "*" && next === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

export function matchesRepoGlob(path, pattern) {
  return globToRegExp(pattern).test(path);
}

const WORKSPACES = [
  ["apps/web", "web", "@orbit/web", "typescript"],
  ["apps/api", "api", "@orbit/api", "typescript"],
  ["apps/worker", "worker", "@orbit/worker", "typescript"],
  ["services/python-worker", "python", null, "python"],
  ["packages", "package", null, "typescript"],
  ["tools/agent", "agent-tool", null, "node"],
  ["infra", "infra", null, "mixed"],
  ["docs", "docs", null, "docs"],
];

export function classifyWorkspace(path) {
  for (const [root, area, packageName, language] of WORKSPACES) {
    if (path === root || path.startsWith(`${root}/`)) {
      if (root !== "packages") {
        return { area, language, packageName, root };
      }
      const [, packageDirectory] = path.split("/");
      const packageRoot = packageDirectory
        ? `packages/${packageDirectory}`
        : "packages";
      return {
        area: packageDirectory ?? area,
        language,
        packageName: packageDirectory ? `@orbit/${packageDirectory}` : null,
        root: packageRoot,
      };
    }
  }
  return {
    area: "repository",
    language: "mixed",
    packageName: null,
    root: ".",
  };
}
