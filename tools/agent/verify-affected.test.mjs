import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAffectedPaths,
  createAffectedVerificationPlan,
  executeAffectedVerificationPlan,
  renderAffectedVerificationPlan,
} from "./verify-affected.mjs";

test("일반 app 변경은 Turbo affected 검증을 선택한다", () => {
  const classification = classifyAffectedPaths([
    "apps/web/src/features/rehearsal/RehearsalRunNav.tsx",
  ]);
  const plan = createAffectedVerificationPlan(classification, "origin/develop");

  assert.equal(classification.full, false);
  assert.deepEqual(plan.commands[0].argv, [
    "pnpm",
    "turbo",
    "run",
    "build",
    "typecheck",
    "test",
    "--affected",
    "--env-mode=loose",
  ]);
  assert.equal(plan.commands[0].env.TURBO_SCM_BASE, "origin/develop");
});

test("공통 계약 변경은 전체 TypeScript와 Python 검증으로 승격한다", () => {
  const classification = classifyAffectedPaths([
    "packages/shared/src/rehearsals/rehearsal.schema.ts",
  ]);
  const plan = createAffectedVerificationPlan(classification, "develop");

  assert.equal(classification.full, true);
  assert.equal(classification.python, true);
  assert.deepEqual(
    plan.commands.map((item) => item.argv.join(" ")),
    [
      "pnpm turbo run build --env-mode=loose",
      "pnpm turbo run typecheck --env-mode=loose",
      "pnpm turbo run test --env-mode=loose",
      "uv run ruff check .",
      "uv run mypy app",
      "uv run pytest",
    ],
  );
  assert.match(renderAffectedVerificationPlan(plan), /shared schema/);
});

test("root config와 migration 변경의 승격 사유를 중복 없이 보고한다", () => {
  const classification = classifyAffectedPaths([
    "turbo.json",
    "turbo.json",
    "apps/api/src/database/migrations/Example.ts",
  ]);

  assert.equal(classification.full, true);
  assert.deepEqual(classification.reasons, [
    "root lockfile 또는 compiler/build config 변경",
    "DB migration 변경",
  ]);
});

test("Python 문서만 바뀐 경우 Python 전체 검증을 추가하지 않는다", () => {
  const classification = classifyAffectedPaths([
    "services/python-worker/AGENTS.md",
  ]);

  assert.equal(classification.python, false);
  assert.equal(classification.full, false);
});

test("첫 실패에서 실행을 멈추고 exit code를 보존한다", () => {
  const plan = {
    commands: [
      { argv: ["first"], cwd: ".", env: {} },
      { argv: ["second"], cwd: ".", env: {} },
      { argv: ["third"], cwd: ".", env: {} },
    ],
  };
  const invoked = [];
  const status = executeAffectedVerificationPlan(plan, {
    runner(item) {
      invoked.push(item.argv[0]);
      return { status: item.argv[0] === "second" ? 9 : 0 };
    },
  });

  assert.equal(status, 9);
  assert.deepEqual(invoked, ["first", "second"]);
});
