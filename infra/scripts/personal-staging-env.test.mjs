import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  decodeEnvValue,
  parseComposeEnvironmentKeys,
  parseComposeServiceEnvironmentKeys,
  parseEnvFileContent,
  selectDopplerChanges,
  validatePersonalStagingPolicy,
} from "./personal-staging-env.mjs";
import { parseArguments } from "./sync-personal-staging-doppler.mjs";

test("env parser reports duplicates without exposing values", () => {
  const result = parseEnvFileContent(
    ['SAFE_DEFAULT="5"', "SAFE_DEFAULT=6"].join("\n"),
    "fixture.env",
  );

  assert.equal(result.entries.size, 1);
  assert.deepEqual(result.failures, [
    "fixture.env:2 duplicate env key: SAFE_DEFAULT",
  ]);
  assert.equal(decodeEnvValue(result.entries.get("SAFE_DEFAULT")), "5");
});

test("policy requires explicit source and delivery for every staging key", () => {
  const stagingEntries = new Map([
    ["SAFE_DEFAULT", "5"],
    ["REQUIRED_SECRET", "replace-me"],
  ]);
  const policy = {
    version: 1,
    variables: {
      SAFE_DEFAULT: {
        source: "repo-default",
        delivery: "compose",
      },
      REQUIRED_SECRET: {
        source: "doppler-required",
        delivery: "compose",
      },
    },
  };

  assert.deepEqual(
    validatePersonalStagingPolicy({
      stagingEntries,
      policy,
      composeKeys: new Set(["SAFE_DEFAULT", "REQUIRED_SECRET"]),
    }),
    [],
  );
});

test("policy rejects unsafe defaults and Compose delivery mismatches", () => {
  const stagingEntries = new Map([
    ["UNSAFE_DEFAULT", "replace-me"],
    ["MISSING_COMPOSE", "enabled"],
    ["CODE_DEFAULT", "enabled"],
  ]);
  const policy = {
    version: 1,
    variables: {
      UNSAFE_DEFAULT: {
        source: "repo-default",
        delivery: "compose",
      },
      MISSING_COMPOSE: {
        source: "doppler-optional",
        delivery: "compose",
      },
      CODE_DEFAULT: {
        source: "repo-default",
        delivery: "code-default",
      },
    },
  };

  assert.deepEqual(
    validatePersonalStagingPolicy({
      stagingEntries,
      policy,
      composeKeys: new Set(["UNSAFE_DEFAULT", "CODE_DEFAULT"]),
    }),
    [
      "infra/env/personal-staging-env-policy.json unsafe repo default for env key: UNSAFE_DEFAULT",
      "personal staging Compose does not deliver env key: MISSING_COMPOSE",
      "infra/env/personal-staging-env-policy.json delivery does not match Compose for env key: CODE_DEFAULT",
    ],
  );
});

test("Compose delivery requires same-key interpolation in environment mappings", () => {
  const keys = parseComposeEnvironmentKeys(`
services:
  api:
    environment:
      HARD_CODED: redis://private-evidence-redis:6379
      SELF_INTERPOLATED: \${SELF_INTERPOLATED:?}
      OTHER_INTERPOLATION: \${SOURCE_VALUE:?}
    build:
      args:
        BUILD_ONLY: \${BUILD_ONLY:?}
x-orbit-env: &orbit-env
  QUOTED_INTERPOLATION: "\${QUOTED_INTERPOLATION:-enabled}"
`);

  assert.deepEqual([...keys].sort(), [
    "QUOTED_INTERPOLATION",
    "SELF_INTERPOLATED",
  ]);
});

test("Compose service delivery keeps OOXML rollout flags aligned", () => {
  const services = parseComposeServiceEnvironmentKeys(`
services:
  api:
    environment:
      FEATURE_ENABLED: "\${FEATURE_ENABLED:-false}"
      ALLOWLIST: "\${ALLOWLIST:-}"
  python-worker:
    environment:
      FEATURE_ENABLED: "\${FEATURE_ENABLED:-false}"
      HARD_CODED: "ignored"
volumes:
  data:
`);

  assert.deepEqual([...services.get("api")].sort(), [
    "ALLOWLIST",
    "FEATURE_ENABLED",
  ]);
  assert.deepEqual([...services.get("python-worker")], ["FEATURE_ENABLED"]);
});

test("sync selection never overwrites existing keys or creates manual values", () => {
  const policy = {
    variables: {
      EXISTING_DEFAULT: {
        source: "repo-default",
        delivery: "compose",
      },
      NEW_DEFAULT: {
        source: "repo-default",
        delivery: "compose",
      },
      OPTIONAL_OVERRIDE: {
        source: "doppler-optional",
        delivery: "compose",
      },
      REQUIRED_SECRET: {
        source: "doppler-required",
        delivery: "compose",
      },
      CODE_ONLY: {
        source: "repo-default",
        delivery: "code-default",
      },
    },
  };

  assert.deepEqual(
    selectDopplerChanges({
      policy,
      dopplerKeys: new Set(["EXISTING_DEFAULT"]),
    }),
    {
      missingAuto: ["NEW_DEFAULT"],
      missingRequired: ["REQUIRED_SECRET"],
      missingOptional: ["OPTIONAL_OVERRIDE"],
    },
  );
});

test("sync arguments are dry-run by default and reject unknown input", () => {
  assert.deepEqual(parseArguments([]), {
    apply: false,
    project: "orbit",
    config: "stg",
  });
  assert.deepEqual(parseArguments(["--apply", "--config", "stg_demo"]), {
    apply: true,
    project: "orbit",
    config: "stg_demo",
  });
  assert.throws(() => parseArguments(["--unknown"]), /unknown argument/);
});

test("develop deploy syncs safe Doppler defaults before server deployment", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/environment-contract-ci.yml",
    "utf8",
  );

  assert.match(workflow, /^  sync-personal-staging-env:$/m);
  assert.match(
    workflow,
    /DOPPLER_TOKEN: \$\{\{ secrets\.DOPPLER_STG_SYNC_TOKEN \}\}/,
  );
  assert.match(
    workflow,
    /node infra\/scripts\/sync-personal-staging-doppler\.mjs \\\s+--apply/,
  );
  assert.doesNotMatch(
    workflow,
    /uses: \.\/\.github\/workflows\/deploy-personal-staging\.yml/,
  );
  assert.match(
    workflow,
    /needs\.sync-personal-staging-env\.result == 'success'/,
  );
  assert.match(
    workflow,
    /'personal-staging-deploy' \|\| format\('environment-contract-\{0\}-\{1\}', github\.workflow, github\.ref\)/,
  );
  assert.match(
    workflow,
    /sudo \/usr\/local\/sbin\/orbit-deploy-personal-staging "\$DEPLOYMENT_MODE" "\$EXPECTED_SHA"/,
  );
});

test("manual full recovery uses the existing dispatch and serialized develop sync path", () => {
  const contractWorkflow = fs.readFileSync(
    ".github/workflows/environment-contract-ci.yml",
    "utf8",
  );
  const deployWorkflow = fs.readFileSync(
    ".github/workflows/deploy-personal-staging.yml",
    "utf8",
  );

  assert.doesNotMatch(contractWorkflow, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(deployWorkflow, /^  workflow_call:$/m);
  assert.match(deployWorkflow, /^  workflow_dispatch:$/m);
  assert.match(deployWorkflow, /^          - manual$/m);
  assert.match(
    deployWorkflow,
    /inputs\.deployment_mode == 'full' &&[\s\S]*inputs\.trigger_source == 'manual' &&[\s\S]*github\.ref == 'refs\/heads\/develop'/,
  );
  assert.doesNotMatch(deployWorkflow, /develop-push/);
  assert.match(
    deployWorkflow,
    /^concurrency:\s+group: personal-staging-deploy\s+cancel-in-progress: false$/m,
  );
});
