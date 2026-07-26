import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  DomainManifestError,
  loadDomainCatalog,
  renderDomainContext
} from "./context.mjs";

function writeFixture(root, path, content = "") {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function createManifest(id, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    summary: `${id} domain`,
    ownedPaths: ["src/**"],
    entrypoints: [{ area: "app", path: "src/index.ts" }],
    contracts: ["src/contract.ts"],
    tests: ["tests/domain.test.ts"],
    fastChecks: ["node --test tests/domain.test.ts"],
    fullCheckTriggers: ["contract changed"],
    boundaries: ["keep contract stable"],
    ...overrides
  };
}

function createRepositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "orbit-agent-context-"));
  writeFixture(root, "src/index.ts");
  writeFixture(root, "src/contract.ts");
  writeFixture(root, "tests/domain.test.ts");
  writeFixture(
    root,
    "docs/agent/domains/example.json",
    JSON.stringify(createManifest("example"))
  );
  return root;
}

test("유효한 domain catalog를 id 순으로 반환한다", () => {
  const root = createRepositoryFixture();
  writeFixture(
    root,
    "docs/agent/domains/another.json",
    JSON.stringify(createManifest("another"))
  );

  const catalog = loadDomainCatalog(root);

  assert.deepEqual(
    catalog.map((manifest) => manifest.id),
    ["another", "example"]
  );
});

test("domain context를 150줄 이하로 렌더링한다", () => {
  const root = createRepositoryFixture();
  const [manifest] = loadDomainCatalog(root);

  const rendered = renderDomainContext(manifest);

  assert.match(rendered, /^# example/m);
  assert.match(rendered, /## Fast checks/);
  assert.ok(rendered.trimEnd().split("\n").length <= 150);
});

test("존재하지 않는 entrypoint와 contract를 거부한다", () => {
  const root = createRepositoryFixture();
  writeFixture(
    root,
    "docs/agent/domains/example.json",
    JSON.stringify(
      createManifest("example", {
        entrypoints: [{ area: "app", path: "src/missing.ts" }],
        contracts: ["src/missing-contract.ts"]
      })
    )
  );

  assert.throws(
    () => loadDomainCatalog(root),
    (error) =>
      error instanceof DomainManifestError &&
      error.message.includes("entrypoint가 없습니다") &&
      error.message.includes("contracts 경로가 없습니다")
  );
});

test("파일 이름과 domain id 불일치를 거부한다", () => {
  const root = createRepositoryFixture();
  writeFixture(
    root,
    "docs/agent/domains/example.json",
    JSON.stringify(createManifest("different"))
  );

  assert.throws(
    () => loadDomainCatalog(root),
    (error) =>
      error instanceof DomainManifestError &&
      error.message.includes("파일 이름과 domain id가 일치해야 합니다")
  );
});
