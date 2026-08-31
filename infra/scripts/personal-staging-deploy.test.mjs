import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.join(scriptDirectory, "deploy-personal-server.sh");
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const imageWorkflow = path.join(
  repositoryRoot,
  ".github/workflows/build-personal-staging-images.yml",
);
const stagingCompose = path.join(repositoryRoot, "docker-compose.staging.yml");
const expectedSha = "125727bbd2194bcf0937a7eca452231ffc7a4bb1";
const appImages = [
  `ghcr.io/kdh949/orbit-api:${expectedSha}`,
  `ghcr.io/kdh949/orbit-worker:${expectedSha}`,
  `ghcr.io/kdh949/orbit-python-worker:${expectedSha}`,
  `ghcr.io/kdh949/orbit-web:${expectedSha}`,
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

function runDeploy({
  ghcrToken = "test-ghcr-token",
  missingImage,
  mode = "environment-only",
  pullFails = false,
}) {
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
if [[ "\${1:-}" == "switch" || "\${1:-} \${2:-}" == "pull --ff-only" ]]; then
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
if [[ "\${1:-} \${2:-} \${3:-}" == "secrets get GHCR_TOKEN" && "\${4:-}" == "--plain" ]]; then
  if [[ -n "\${FAKE_GHCR_TOKEN:-}" ]]; then
    printf '%s\\n' "$FAKE_GHCR_TOKEN"
    exit 0
  fi
  exit 1
fi
if [[ "\${1:-} \${2:-} \${3:-}" == "secrets get GHCR_USERNAME" && "\${4:-}" == "--plain" ]]; then
  printf '%s\\n' 'kdh949'
  exit 0
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
    "ghcr.io/kdh949/orbit-api:$IMAGE_TAG" \\
    "ghcr.io/kdh949/orbit-worker:$IMAGE_TAG" \\
    "ghcr.io/kdh949/orbit-python-worker:$IMAGE_TAG" \\
    "ghcr.io/kdh949/orbit-web:$IMAGE_TAG"
  exit 0
fi
if [[ "\${1:-} \${2:-}" == "image inspect" && -n "\${MISSING_IMAGE:-}" && "\${3:-}" == "$MISSING_IMAGE" ]]; then
  exit 1
fi
if [[ "\${1:-}" == "compose" && "$*" == *" pull api worker python-worker web"* && "\${PULL_FAILS:-}" == "true" ]]; then
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
    FAKE_GHCR_TOKEN: ghcrToken,
    GHCR_TOKEN: "",
    GHCR_USERNAME: "",
    IMAGE_TAG: "latest",
    MISSING_IMAGE: missingImage ?? "",
    ORBIT_APP_DIR: toBashPath(appDirectory),
    ORBIT_DEPLOY_LOCK_FILE: toBashPath(
      path.join(fixtureDirectory, "deploy.lock"),
    ),
    PULL_FAILS: String(pullFails),
    REGISTRY_PULL_ATTEMPTS: "1",
  };
  const result = spawnSync(
    bashPath,
    [
      "-c",
      'export PATH="$1:/usr/bin:/bin"; exec "$2" "$3" "$4"',
      "orbit-deploy-test",
      toBashPath(fakeBin),
      toBashPath(deployScript),
      mode,
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

function runEnvironmentOnlyDeploy({ missingImage }) {
  return runDeploy({ missingImage });
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

  const minioInitIndex = commands.findIndex((command) =>
    command.includes(" run --rm --no-deps --pull never minio-init"),
  );
  const upIndex = commands.findIndex((command) => command.includes(" up "));
  assert.ok(minioInitIndex > Math.max(...inspectIndexes));
  assert.ok(upIndex > minioInitIndex);
  assert.match(commands[upIndex], /--no-build --pull never --force-recreate/);
  assert.doesNotMatch(commands.join("\n"), /orbit-web:latest/);
});

test("full deploy requires a read-only GHCR token before pulling or replacing containers", () => {
  const { commands, result } = runDeploy({ ghcrToken: "", mode: "full" });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /GHCR_TOKEN with read:packages is required/);
  assert.ok(commands.every((command) => !command.startsWith("login ")));
  assert.ok(commands.every((command) => !command.includes(" pull ")));
  assert.ok(commands.every((command) => !command.includes(" up ")));
});

test("full deploy requires an explicit 40-character target SHA", () => {
  const fixtureDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "orbit-personal-staging-sha-"),
  );
  const result = spawnSync(resolveBash(), [toBashPath(deployScript), "full"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ORBIT_APP_DIR: toBashPath(fixtureDirectory),
    },
  });

  fs.rmSync(fixtureDirectory, { force: true, recursive: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Full deployment requires an expected SHA/);
});

test("full deploy pulls one immutable SHA set and never builds application images on-box", () => {
  const { commands, result } = runDeploy({ mode: "full" });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    commands.some((command) =>
      command.startsWith("login ghcr.io -u kdh949 --password-stdin"),
    ),
  );
  const pullIndex = commands.findIndex((command) =>
    command.includes(" pull api worker python-worker web"),
  );
  const finalUpIndex = commands.findIndex(
    (command) =>
      command.includes(" up -d --no-build --pull never") &&
      !command.includes("postgres"),
  );
  assert.ok(pullIndex >= 0);
  assert.ok(finalUpIndex > pullIndex);
  assert.ok(
    appImages.every((image) =>
      commands.some((command) => command === `image inspect ${image}`),
    ),
  );
  assert.ok(
    commands.some((command) =>
      command.includes(
        " run --rm --pull never api corepack pnpm db:migration:run",
      ),
    ),
  );
  assert.doesNotMatch(commands.join("\n"), /(^| )build( |$)|:latest/);
});

test("personal staging workflow publishes every app image by immutable commit SHA", () => {
  const workflow = fs.readFileSync(imageWorkflow, "utf8");

  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.match(workflow, /packages: write/);
  for (const service of ["api", "worker", "python-worker"]) {
    assert.match(workflow, new RegExp(`- ${service}`));
  }
  assert.match(
    workflow,
    /orbit-\$\{\{ matrix\.service \}\}:\$\{\{ github\.sha \}\}/,
  );
  assert.match(workflow, /orbit-web:\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /\/usr\/local\/sbin\/orbit-deploy/);
});

test("personal staging compose requires one shared image SHA for every app service", () => {
  const compose = fs.readFileSync(stagingCompose, "utf8");

  for (const service of ["api", "worker", "python-worker", "web"]) {
    assert.match(
      compose,
      new RegExp(
        `image: ghcr\\.io/kdh949/orbit-${service}:\\$\\{IMAGE_TAG:\\?IMAGE_TAG is required\\}`,
      ),
    );
  }
  assert.doesNotMatch(compose, /WEB_IMAGE_TAG|:latest/);
});
