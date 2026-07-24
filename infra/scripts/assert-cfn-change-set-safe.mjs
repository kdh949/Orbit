import { readFile } from "node:fs/promises";

const [changeSetPath] = process.argv.slice(2);
if (!changeSetPath) {
  console.error("Usage: node infra/scripts/assert-cfn-change-set-safe.mjs <change-set.json>");
  process.exit(2);
}

const protectedTypes = new Set([
  "AWS::RDS::DBInstance",
  "AWS::S3::Bucket",
  "AWS::CloudFront::Distribution",
  "AWS::EC2::Instance",
]);

const changeSet = JSON.parse(await readFile(changeSetPath, "utf8"));
const unsafe = (changeSet.Changes ?? []).filter(({ ResourceChange: change }) =>
  protectedTypes.has(change?.ResourceType) &&
  (
    ["Remove", "Delete", "Replace"].includes(change?.Action) ||
    (change?.Action === "Modify" && change?.Replacement !== "False")
  ),
);

if (unsafe.length > 0) {
  console.error("Unsafe CloudFormation change set: protected resources would be replaced or deleted.");
  for (const { ResourceChange: change } of unsafe) {
    console.error(
      `- ${change.ResourceType} ${change.LogicalResourceId}: ${change.Action} (Replacement: ${change.Replacement ?? "unknown"})`,
    );
  }
  process.exit(1);
}

console.log("CloudFormation change set contains no protected resource replacement or deletion.");
