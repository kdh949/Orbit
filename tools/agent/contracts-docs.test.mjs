import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const domainDocs = new Map([
  ["ai-deck", "docs/contracts/ai-deck.md"],
  ["editor", "docs/contracts/deck-editor.md"],
  ["pptx", "docs/contracts/pptx.md"],
  ["rehearsal", "docs/contracts/rehearsal.md"],
]);

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("contract index가 모든 domain 문서만 탐색 링크로 제공한다", () => {
  const index = read("docs/contracts.md");

  for (const path of [...domainDocs.values(), "docs/contracts/common.md"]) {
    expectIndexLink(index, path);
  }
  assert.doesNotMatch(index, /^## (Deck JSON|Job 상태|리허설 STT)/m);
});

test("domain manifest가 index 전체 대신 필요한 계약 문서만 선택한다", () => {
  for (const [domain, domainDoc] of domainDocs) {
    const manifest = JSON.parse(read(`docs/agent/domains/${domain}.json`));
    const allContracts = [
      ...(manifest.primaryContracts ?? manifest.contracts),
      ...(manifest.secondaryContracts ?? []),
    ];
    const selectedDocs = allContracts.filter((path) =>
      path.startsWith("docs/contracts"),
    );

    assert.deepEqual(selectedDocs, [domainDoc, "docs/contracts/common.md"]);
    assert.ok(!allContracts.includes("docs/contracts.md"));
  }
});

function expectIndexLink(index, path) {
  const relativePath = `./${path.replace(/^docs\//, "")}`;
  assert.ok(index.includes(`](${relativePath})`), `${path} link is missing`);
}
