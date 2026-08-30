import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  decodeEnvValue,
  parseComposeEnvironmentKeys,
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

test("hosted image workflow validates env contracts without changing Doppler or the server", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/build-personal-staging-images.yml",
    "utf8",
  );

  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /node infra\/scripts\/check-env\.mjs/);
  assert.match(workflow, /infra\/scripts\/personal-staging-env\.test\.mjs/);
  assert.doesNotMatch(workflow, /DOPPLER_TOKEN|DOPPLER_STG_SYNC_TOKEN/);
  assert.doesNotMatch(workflow, /sync-personal-staging-doppler\.mjs/);
  assert.doesNotMatch(workflow, /\/usr\/local\/sbin\/orbit-deploy/);
});

test("manual dispatch rebuilds images but never deploys to the personal server", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/build-personal-staging-images.yml",
    "utf8",
  );

  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /push:\s+branches:\s+- develop/m);
  assert.doesNotMatch(workflow, /runs-on:.*self-hosted|\bssh\b/i);
  assert.doesNotMatch(
    workflow,
    /sudo .*deploy-personal-server|\.\/infra\/scripts\/deploy-personal-server\.sh/,
  );
  assert.doesNotMatch(
    workflow,
    /DOPPLER_TOKEN|sync-personal-staging-doppler\.mjs/,
  );
});
