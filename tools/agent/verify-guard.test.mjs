import assert from "node:assert/strict";
import test from "node:test";

import { createGuardPlan } from "./verify-guard.mjs";

test("dependency 설치 전 실행 가능한 canonical guard를 구성한다", () => {
  const plan = createGuardPlan();
  const commands = plan.map((argv) => argv.join(" "));

  assert.ok(commands.some((command) => command.includes("repo-doctor.mjs")));
  assert.ok(commands.some((command) => command.includes("context.mjs --list")));
  assert.ok(
    commands.some((command) => command.includes("check-import-boundaries.mjs")),
  );
  assert.ok(
    commands.some((command) => command.includes("check-source-cycles.mjs")),
  );
  assert.ok(
    commands.some((command) => command.includes("benchmark.mjs validate")),
  );
  assert.ok(commands.every((command) => !command.includes("prettier")));
});
