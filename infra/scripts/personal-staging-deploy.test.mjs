import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.join(scriptDirectory, "deploy-personal-server.sh");
const expectedSha = "125727bbd2194bcf0937a7eca452231ffc7a4bb1";
const appImages = [
  "ghcr.io/na-man-mu-303-team2/orbit-api:develop",
  "ghcr.io/na-man-mu-303-team2/orbit-worker:develop",
  "ghcr.io/na-man-mu-303-team2/orbit-python-worker:develop",
  `ghcr.io/na-man-mu-303-team2/orbit-web:${expectedSha}`,
];

function toBashPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.replace(
    /^([A-Za-z]):/,
    (_, drive) => `/${drive.toLowerCase()}`,
  );
}

function resolveBash() {
  if (process.platform !== "win32") return "bash";

  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ];
  const bash = candidates.find((candidate) => fs.existsSync(candidate));
  if (!bash) throw new Error("Git Bash is required to test the deploy script.");
  return bash;
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function runEnvironmentOnlyDeploy({ missingImage }) {
  const fixtureDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "orbit-personal-staging-deploy-"),
  );
  const fakeBin = path.join(fixtureDirectory, "bin");
  const appDirectory = path.join(fixtureDirectory, "app");
  const commandLog = path.join(fixtureDirectory, "commands.log");
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(appDirectory);

  writeExecutable(
    path.join(fakeBin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-} \${2:-}" == "rev-parse HEAD" ]]; then
  printf '%s\\n' "$EXPECTED_SHA"
  exit 0
fi
echo "unexpected git command: $*" >&2
exit 1
`,
  );
  writeExecutable(
    path.join(fakeBin, "flock"),
    `#!/usr/bin/env bash
exit 0
`,
  );
  writeExecutable(
    path.join(fakeBin, "doppler"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "run" && "\${2:-}" == "--" ]]; then
  shift 2
  if [[ "\${1:-}" == "bash" ]]; then
    exit 0
  fi
  exec "$@"
fi
echo "unexpected doppler command: $*" >&2
exit 1
`,
  );
  writeExecutable(
    path.join(fakeBin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$COMMAND_LOG"
if [[ "\${1:-} \${2:-}" == "compose -f" && "$*" == *" config --images"* ]]; then
  printf '%s\\n' \\
    "ghcr.io/na-man-mu-303-team2/orbit-api:$IMAGE_TAG" \\
    "ghcr.io/na-man-mu-303-team2/orbit-worker:$IMAGE_TAG" \\
    "ghcr.io/na-man-mu-303-team2/orbit-python-worker:$IMAGE_TAG" \\
    "ghcr.io/na-man-mu-303-team2/orbit-web:$WEB_IMAGE_TAG"
  exit 0
fi
if [[ "\${1:-} \${2:-}" == "image inspect" && -n "\${MISSING_IMAGE:-}" && "\${3:-}" == "$MISSING_IMAGE" ]]; then
  exit 1
fi
exit 0
`,
  );
  writeExecutable(
    path.join(fakeBin, "curl"),
    `#!/usr/bin/env bash
exit 0
`,
  );

  const bashPath = resolveBash();
  const environment = {
    ...process.env,
    COMMAND_LOG: toBashPath(commandLog),
    EXPECTED_SHA: expectedSha,
    IMAGE_TAG: "latest",
    MISSING_IMAGE: missingImage ?? "",
    ORBIT_APP_DIR: toBashPath(appDirectory),
    ORBIT_DEPLOY_LOCK_FILE: toBashPath(
      path.join(fixtureDirectory, "deploy.lock"),
    ),
    WEB_IMAGE_TAG: "latest",
  };
  const result = spawnSync(
    bashPath,
    [
      "-c",
      'export PATH="$1:/usr/bin:/bin"; exec "$2" environment-only "$3"',
      "orbit-deploy-test",
      toBashPath(fakeBin),
      toBashPath(deployScript),
      expectedSha,
    ],
    {
      encoding: "utf8",
      env: environment,
    },
  );
  const commands = fs.existsSync(commandLog)
    ? fs.readFileSync(commandLog, "utf8").trim().split(/\r?\n/)
    : [];

  fs.rmSync(fixtureDirectory, { force: true, recursive: true });
  return { commands, result };
}

test("environment-only stops before replacing containers when an app image is missing", () => {
  const missingImage = appImages.at(-1);
  const { commands, result } = runEnvironmentOnlyDeploy({ missingImage });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    new RegExp(
      `Required personal staging app image is not available locally: ${missingImage}`,
    ),
  );
  assert.ok(
    commands.some((command) => command === `image inspect ${missingImage}`),
  );
  assert.ok(
    commands.every((command) => !command.includes(" up ")),
    `container replacement started unexpectedly:\n${commands.join("\n")}`,
  );
});

test("environment-only resolves exact tags and replaces containers only after every image check", () => {
  const { commands, result } = runEnvironmentOnlyDeploy({});

  assert.equal(result.status, 0, result.stderr);
  const inspectIndexes = appImages.map((image) =>
    commands.indexOf(`image inspect ${image}`),
  );
  assert.ok(inspectIndexes.every((index) => index >= 0));

  const upIndex = commands.findIndex((command) => command.includes(" up "));
  assert.ok(upIndex > Math.max(...inspectIndexes));
  assert.match(commands[upIndex], /--no-build --pull never --force-recreate/);
  assert.doesNotMatch(commands.join("\n"), /orbit-web:latest/);
});
