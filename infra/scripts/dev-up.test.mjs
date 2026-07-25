import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptDirectory, "dev-up.sh");
const script = fs.readFileSync(scriptPath, "utf8").replaceAll("\r\n", "\n");

test("dev-up exports .env.local before starting local services", () => {
  const loadIndex = script.indexOf("load_local_environment\n");
  const composeIndex = script.indexOf("docker compose up");

  assert.ok(loadIndex >= 0);
  assert.ok(composeIndex > loadIndex);
  assert.match(
    script,
    /set -a\n\s+# shellcheck disable=SC1090\n\s+source "\$LOCAL_ENV_FILE"\n\s+set \+a/,
  );
  assert.match(script, /missing \.env\.local/);
});

test("dev-up waits portably without Bash wait -n", () => {
  assert.doesNotMatch(script, /\bwait\s+-n\b/);
  assert.match(script, /while kill -0 "\$NODE_DEV_PID"/);
  assert.match(script, /kill -0 "\$PYTHON_DEV_PID"/);
  assert.match(script, /wait_for_dev_process\n$/);
});

test("dev-up remains valid in the macOS system Bash", () => {
  const result = spawnSync("/bin/bash", ["-n", scriptPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
});
