import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(
  new URL("./assert-cfn-change-set-safe.mjs", import.meta.url),
);

function runChangeSet(resourceChange) {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "orbit-cfn-safe-"));
  const fixturePath = join(fixtureDirectory, "change-set.json");
  writeFileSync(
    fixturePath,
    JSON.stringify({ Changes: [{ ResourceChange: resourceChange }] }),
  );

  try {
    return spawnSync(process.execPath, [scriptPath, fixturePath], {
      encoding: "utf8",
    });
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
}

test("rejects protected resource removal", () => {
  const result = runChangeSet({
    Action: "Remove",
    LogicalResourceId: "Database",
    ResourceType: "AWS::RDS::DBInstance",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Database: Remove/);
});

for (const replacement of ["True", "Conditional"]) {
  test(`rejects protected Modify with Replacement=${replacement}`, () => {
    const result = runChangeSet({
      Action: "Modify",
      LogicalResourceId: "Assets",
      Replacement: replacement,
      ResourceType: "AWS::S3::Bucket",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Replacement: ${replacement}`));
  });
}

test("allows protected Modify only when replacement is explicitly false", () => {
  const result = runChangeSet({
    Action: "Modify",
    LogicalResourceId: "Distribution",
    Replacement: "False",
    ResourceType: "AWS::CloudFront::Distribution",
  });

  assert.equal(result.status, 0);
});

test("allows a newly added protected resource", () => {
  const result = runChangeSet({
    Action: "Add",
    LogicalResourceId: "NewBucket",
    ResourceType: "AWS::S3::Bucket",
  });

  assert.equal(result.status, 0);
});

test("workflows enforce the CloudFormation execution role boundary", () => {
  const planWorkflow = readFileSync(
    ".github/workflows/aws-infrastructure-plan.yml",
    "utf8",
  );
  const applyWorkflow = readFileSync(
    ".github/workflows/aws-infrastructure-apply.yml",
    "utf8",
  );

  assert.match(
    planWorkflow,
    /AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN: \$\{\{ vars\.AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN \}\}/,
  );
  assert.match(
    planWorkflow,
    /--role-arn "\$AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN"/,
  );
  assert.match(
    planWorkflow,
    /plan:\s*\n\s+if: github\.event_name == 'workflow_dispatch'[\s\S]*?permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/,
  );
  assert.match(
    planWorkflow,
    /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]/,
  );
  assert.doesNotMatch(
    planWorkflow,
    /^permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/m,
  );
  assert.match(
    planWorkflow,
    /- \.github\/workflows\/aws-infrastructure-apply\.yml/,
  );
  assert.match(
    applyWorkflow,
    /AWS_INFRA_APPLY_ROLE_ARN: \$\{\{ vars\.AWS_INFRA_APPLY_ROLE_ARN \}\}/,
  );
  assert.match(
    applyWorkflow,
    /role-to-assume: \$\{\{ vars\.AWS_INFRA_APPLY_ROLE_ARN \}\}/,
  );
  assert.doesNotMatch(
    applyWorkflow,
    /^    env:\s*\n\s+AWS_INFRA_APPLY_ROLE_ARN:/m,
  );
  assert.match(
    applyWorkflow,
    /CHANGE_SET_ARN: \$\{\{ inputs\.change_set_arn \}\}/,
  );
  assert.match(
    applyWorkflow,
    /Change set ARN must match the selected region/,
  );
  assert.doesNotMatch(
    applyWorkflow,
    /"\$\{\{ inputs\.(?:change_set_arn|region) \}\}"/,
    "workflow inputs must not be interpolated directly into shell commands",
  );
});
