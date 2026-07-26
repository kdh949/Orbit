import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function splitNullSeparated(output) {
  return output.split("\0").filter(Boolean);
}

export function parseNameStatus(output) {
  const fields = splitNullSeparated(output);
  const changes = [];

  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    const kind = status[0];
    const sourcePath = fields[index + 1];
    if (!sourcePath) {
      continue;
    }
    if (kind === "R" || kind === "C") {
      const targetPath = fields[index + 2];
      if (targetPath) {
        changes.push({ kind, sourcePath, targetPath });
      }
      index += 2;
      continue;
    }
    changes.push({ kind, sourcePath, targetPath: null });
    index += 1;
  }

  return changes;
}

export function runGit(rootDirectory, args, options = {}) {
  return execFileSync("git", args, {
    cwd: resolve(rootDirectory),
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "inherit"],
  });
}

export function gitRefExists(rootDirectory, ref) {
  try {
    runGit(rootDirectory, ["rev-parse", "--verify", `${ref}^{commit}`], {
      quiet: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveBaseRef(rootDirectory, explicitBase, environmentName) {
  const requested =
    explicitBase ??
    (environmentName ? process.env[environmentName] : undefined);
  if (requested) {
    if (!gitRefExists(rootDirectory, requested)) {
      throw new Error(`검증 기준 ref를 찾을 수 없습니다: ${requested}`);
    }
    return requested;
  }

  for (const candidate of ["origin/develop", "develop", "HEAD^"]) {
    if (gitRefExists(rootDirectory, candidate)) {
      return candidate;
    }
  }
  return "HEAD";
}

export function resolveMergeBase(rootDirectory, baseRef) {
  return runGit(rootDirectory, ["merge-base", baseRef, "HEAD"]).trim();
}

export function collectChangedPathGroups(baseRef, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const mergeBase = resolveMergeBase(root, baseRef);
  const trackedChanges = [
    runGit(root, [
      "diff",
      "--name-status",
      "--find-renames",
      "-z",
      mergeBase,
      "HEAD",
    ]),
    runGit(root, ["diff", "--name-status", "--find-renames", "-z"]),
    runGit(root, ["diff", "--cached", "--name-status", "--find-renames", "-z"]),
  ].flatMap(parseNameStatus);
  const untrackedPaths =
    options.includeUntracked === false
      ? []
      : splitNullSeparated(
          runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
        );
  const impactPaths = new Set(untrackedPaths);
  const formatPaths = new Set(untrackedPaths);

  for (const change of trackedChanges) {
    impactPaths.add(change.sourcePath);
    if (change.targetPath) {
      impactPaths.add(change.targetPath);
      formatPaths.add(change.targetPath);
    } else if (change.kind !== "D") {
      formatPaths.add(change.sourcePath);
    }
  }

  const sortPaths = (paths) =>
    [...paths].sort((left, right) => left.localeCompare(right));
  return {
    formatPaths: sortPaths(formatPaths),
    impactPaths: sortPaths(impactPaths),
  };
}

export function collectChangedPaths(baseRef, options = {}) {
  return collectChangedPathGroups(baseRef, options).impactPaths;
}

export function collectGitIdentity(rootDirectory, ref = "HEAD") {
  const root = resolve(rootDirectory);
  const headCommit = runGit(root, ["rev-parse", `${ref}^{commit}`], {
    quiet: true,
  }).trim();
  const treeHash = runGit(root, ["rev-parse", `${ref}^{tree}`], {
    quiet: true,
  }).trim();
  const workingTreeDirty =
    ref === "HEAD" &&
    runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], {
      quiet: true,
    }).trim() !== "";

  return { headCommit, treeHash, workingTreeDirty };
}
