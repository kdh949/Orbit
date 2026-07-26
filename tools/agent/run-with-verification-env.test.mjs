import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWithVerificationEnvironment } from "./run-with-verification-env.mjs";

test("공개 검증 기본값을 자식 명령에 주입한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-test-env-"));
  writeFileSync(join(root, ".env.example"), "APP_ENV=local\nAPI_PORT=3000\n");
  let invoked;

  const status = runWithVerificationEnvironment(["test-command", "arg"], {
    root,
    environment: {},
    runner(command, args, environment) {
      invoked = { command, args, environment };
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(invoked, {
    command: "test-command",
    args: ["arg"],
    environment: {
      API_PORT: "3000",
      APP_ENV: "local",
    },
  });
});
