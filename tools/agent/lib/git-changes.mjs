import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function splitNullSeparated(output) {
  return output.split("\0").filter(Boolean);
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

export function collectChangedPaths(baseRef, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const mergeBase = resolveMergeBase(root, baseRef);
  const pathGroups = [
    runGit(root, [
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      "-z",
      mergeBase,
      "HEAD",
    ]),
    runGit(root, ["diff", "--name-only", "--diff-filter=ACMR", "-z"]),
    runGit(root, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMR",
      "-z",
    ]),
    runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ];

  return [...new Set(pathGroups.flatMap(splitNullSeparated))].sort(
    (left, right) => left.localeCompare(right),
  );
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
