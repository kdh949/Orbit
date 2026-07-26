import assert from "node:assert/strict";
import test from "node:test";

import {
  executeVerificationCommands,
  parseVerificationScope,
  renderVerificationPlan,
  resolveVerificationScope,
} from "./verify-scope.mjs";

const catalog = [
  {
    id: "editor",
    aliases: ["decks"],
    fastChecks: [
      "pnpm turbo run typecheck --filter=@orbit/web",
      "pnpm turbo run test --filter=@orbit/web -- editor.test.ts",
      "pnpm turbo run typecheck --filter=@orbit/api",
      "pnpm turbo run test --filter=@orbit/api -- decks.test.ts",
    ],
  },
  {
    id: "pptx",
    fastChecks: [
      "pnpm turbo run typecheck --filter=@orbit/worker",
      "pnpm turbo run test --filter=@orbit/worker -- pptx.test.ts",
      "cd services/python-worker && uv run pytest tests/test_pptx.py",
    ],
  },
];

test("area와 domain으로 fast check만 선택한다", () => {
  const plan = resolveVerificationScope(catalog, "worker:pptx");

  assert.equal(plan.resolvedScope, "worker:pptx");
  assert.deepEqual(plan.commands, [
    "pnpm turbo run typecheck --filter=@orbit/worker",
    "pnpm turbo run test --filter=@orbit/worker -- pptx.test.ts",
  ]);
});

test("domain alias를 canonical domain으로 해석한다", () => {
  const plan = resolveVerificationScope(catalog, "api:decks");

  assert.equal(plan.resolvedScope, "api:editor");
  assert.match(
    renderVerificationPlan(plan),
    /requested=api:decks resolved=api:editor/,
  );
});

test("scope 형식과 지원 area를 검증한다", () => {
  assert.throws(() => parseVerificationScope("pptx"), /<area>:<domain> 형식/);
  assert.throws(
    () => resolveVerificationScope(catalog, "mobile:pptx"),
    /지원하지 않는 area/,
  );
});

test("첫 실패에서 실행을 멈추고 exit code를 보존한다", () => {
  const invoked = [];
  const status = executeVerificationCommands(
    {
      commands: ["first", "second", "third"],
    },
    {
      runner(command) {
        invoked.push(command);
        return { status: command === "second" ? 7 : 0 };
      },
    },
  );

  assert.equal(status, 7);
  assert.deepEqual(invoked, ["first", "second"]);
});
