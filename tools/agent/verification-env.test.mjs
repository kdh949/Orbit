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
    [
      "API_PORT=3000",
      "APP_ENV=local",
      "PRESENTATION_PASSCODE_ENCRYPTION_KEY=public-local-key",
      "PRESENTATION_PASSCODE_ENCRYPTION_KEY_VERSION=1",
      "PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY=",
      "PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY_VERSION=",
      "ADAPTIVE_REHEARSAL_COACH_ENABLED=true",
      "",
    ].join("\n"),
  );

  const environment = createVerificationEnvironment(root, {
    APP_ENV: "test",
  });

  assert.equal(environment.API_PORT, "3000");
  assert.equal(environment.APP_ENV, "test");
  assert.equal(
    environment.PRESENTATION_PASSCODE_ENCRYPTION_KEY,
    "public-local-key",
  );
  assert.equal(environment.PRESENTATION_PASSCODE_ENCRYPTION_KEY_VERSION, "1");
  assert.equal(environment.PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY, "");
  assert.equal(
    environment.PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY_VERSION,
    "",
  );
  assert.equal(environment.ADAPTIVE_REHEARSAL_COACH_ENABLED, undefined);
});
