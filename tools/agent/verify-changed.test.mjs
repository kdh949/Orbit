import assert from "node:assert/strict";
import test from "node:test";

import {
  createChangedVerificationPlan,
  executeChangedVerificationPlan,
  renderChangedVerificationPlan,
} from "./verify-changed.mjs";

function context(path, overrides = {}) {
  return {
    path,
    workspace: { area: "web" },
    verification: {
      tier1: ["pnpm turbo run test --filter=@orbit/web -- leaf.test.ts"],
      tier2: ["pnpm turbo run typecheck --filter=@orbit/web"],
    },
    ...overrides,
  };
}

test("Web leaf 변경은 인접 test와 Web typecheck만 선택한다", () => {
  const path = "apps/web/src/runtime/speech/stt/koreanTextSimilarity.ts";
  const plan = createChangedVerificationPlan(
    [path],
    [context(path)],
    { contracts: {} },
    { maxTier: 2 },
  );
  const rendered = renderChangedVerificationPlan(plan);

  assert.match(rendered, /leaf\.test\.ts/);
  assert.match(rendered, /@orbit\/web/);
  assert.match(rendered, /format:check --path/);
  assert.doesNotMatch(rendered, /RehearsalWorkspace/);
  assert.doesNotMatch(rendered, /@orbit\/api/);
  assert.doesNotMatch(rendered, /uv run pytest/);
});

test("등록된 shared 계약만 exact consumer test를 Tier 3에 추가한다", () => {
  const path = "packages/shared/src/example.schema.ts";
  const plan = createChangedVerificationPlan(
    [path],
    [
      context(path, {
        workspace: { area: "shared" },
        verification: { tier1: [], tier2: [] },
      }),
    ],
    {
      contracts: {
        [path]: {
          consumers: ["shared", "python"],
          tests: [
            "packages/shared/src/example.schema.test.ts",
            "services/python-worker/tests/test_example.py",
          ],
        },
      },
    },
    { maxTier: 3 },
  );
  const tierThree = plan.tiers.find((tier) => tier.tier === 3);

  assert.deepEqual(
    tierThree.commands.map((item) => item.command),
    [
      "pnpm turbo run test --filter=@orbit/shared --env-mode=loose -- src/example.schema.test.ts",
      "cd services/python-worker && uv run pytest tests/test_example.py",
    ],
  );
});

test("중복 명령을 합치고 첫 실패에서 실행을 멈춘다", () => {
  const plan = createChangedVerificationPlan(
    ["apps/web/src/one.ts", "apps/web/src/two.ts"],
    [context("apps/web/src/one.ts"), context("apps/web/src/two.ts")],
    { contracts: {} },
    { maxTier: 2 },
  );
  const commands = plan.tiers.flatMap((tier) => tier.commands);
  assert.equal(
    commands.filter((item) => item.command.includes("leaf.test.ts")).length,
    1,
  );

  const invoked = [];
  const status = executeChangedVerificationPlan(plan, {
    runner(item) {
      invoked.push(item.command);
      return { status: invoked.length === 2 ? 7 : 0 };
    },
  });
  assert.equal(status, 7);
  assert.equal(invoked.length, 2);
});
