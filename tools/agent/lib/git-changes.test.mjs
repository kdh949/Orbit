import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { collectChangedPathGroups, parseNameStatus } from "./git-changes.mjs";

function git(root, ...args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

test("name-status에서 삭제와 rename 원본·대상을 복원한다", () => {
  assert.deepEqual(
    parseNameStatus("D\0deleted.ts\0R100\0old.ts\0new.ts\0M\0changed.ts\0"),
    [
      { kind: "D", sourcePath: "deleted.ts", targetPath: null },
      { kind: "R", sourcePath: "old.ts", targetPath: "new.ts" },
      { kind: "M", sourcePath: "changed.ts", targetPath: null },
    ],
  );
});

test("영향 경로에는 삭제·rename 원본을, 포맷 경로에는 현재 파일만 포함한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-git-changes-"));
  git(root, "init");
  git(root, "config", "user.email", "agent@example.com");
  git(root, "config", "user.name", "Agent Test");
  writeFileSync(join(root, "old.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "deleted.ts"), "export const removed = 1;\n");
  git(root, "add", "old.ts", "deleted.ts");
  git(root, "commit", "-m", "fixture");

  renameSync(join(root, "old.ts"), join(root, "new.ts"));
  rmSync(join(root, "deleted.ts"));
  git(root, "add", "-A");

  assert.deepEqual(collectChangedPathGroups("HEAD", { root }), {
    formatPaths: ["new.ts"],
    impactPaths: ["deleted.ts", "new.ts", "old.ts"],
  });
});
