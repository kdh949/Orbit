import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createPullRequestVerificationPlan,
  executePullRequestVerificationPlan,
} from "./verify-pr.mjs";

test("PR gate는 guard, 변경 포맷, affected 검증 순서로 실행한다", () => {
  assert.deepEqual(createPullRequestVerificationPlan("origin/develop"), [
    { argv: ["pnpm", "verify:guard"] },
    {
      argv: [
        "pnpm",
        "format:check",
        "--base",
        "origin/develop",
        "--tracked-only",
      ],
    },
    {
      argv: [
        "pnpm",
        "verify:affected",
        "--base",
        "origin/develop",
        "--tracked-only",
      ],
    },
  ]);
});

test("PR gate는 첫 실패에서 중단한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-verify-pr-"));
  writeFileSync(join(root, ".env.example"), "APP_ENV=local\n");
  const invoked = [];
  const status = executePullRequestVerificationPlan(
    createPullRequestVerificationPlan("develop"),
    {
      root,
      environment: {},
      runner(item) {
        invoked.push(item.argv[1]);
        return { status: item.argv[1] === "format:check" ? 5 : 0 };
      },
    },
  );

  assert.equal(status, 5);
  assert.deepEqual(invoked, ["verify:guard", "format:check"]);
});
