import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createVerificationEnvironment } from "./verification-env.mjs";

test("공개 기본값을 로드하고 호출자 환경변수를 우선한다", () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-verification-env-"));
  writeFileSync(
    join(root, ".env.example"),
    "API_PORT=3000\nAPP_ENV=local\nADAPTIVE_REHEARSAL_COACH_ENABLED=true\n",
  );

  const environment = createVerificationEnvironment(root, {
    APP_ENV: "test",
  });

  assert.equal(environment.API_PORT, "3000");
  assert.equal(environment.APP_ENV, "test");
  assert.equal(environment.ADAPTIVE_REHEARSAL_COACH_ENABLED, undefined);
});
