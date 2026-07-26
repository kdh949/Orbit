import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  createPathContext,
  DomainManifestError,
  loadDomainCatalog,
  renderDomainContext,
  renderPathContext,
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
    ...overrides,
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
    JSON.stringify(createManifest("example")),
  );
  return root;
}

test("유효한 domain catalog를 id 순으로 반환한다", () => {
  const root = createRepositoryFixture();
  writeFixture(
    root,
    "docs/agent/domains/another.json",
    JSON.stringify(createManifest("another")),
  );

  const catalog = loadDomainCatalog(root);

  assert.deepEqual(
    catalog.map((manifest) => manifest.id),
    ["another", "example"],
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
        contracts: ["src/missing-contract.ts"],
      }),
    ),
  );

  assert.throws(
    () => loadDomainCatalog(root),
    (error) =>
      error instanceof DomainManifestError &&
      error.message.includes("entrypoint가 없습니다") &&
      error.message.includes("contracts 경로가 없습니다"),
  );
});

test("파일 이름과 domain id 불일치를 거부한다", () => {
  const root = createRepositoryFixture();
  writeFixture(
    root,
    "docs/agent/domains/example.json",
    JSON.stringify(createManifest("different")),
  );

  assert.throws(
    () => loadDomainCatalog(root),
    (error) =>
      error instanceof DomainManifestError &&
      error.message.includes("파일 이름과 domain id가 일치해야 합니다"),
  );
});

test("파일 경로에서 workspace, domain, dependency와 인접 test를 추론한다", () => {
  const root = createRepositoryFixture();
  writeFixture(
    root,
    "src/index.ts",
    'import { contract } from "./contract";\nexport const value = contract;\n',
  );
  writeFixture(root, "src/contract.ts", "export const contract = 1;\n");
  writeFixture(
    root,
    "src/index.test.ts",
    'import { value } from "./index";\nvoid value;\n',
  );
  writeFixture(root, "AGENTS.md", "# Root\n");

  const context = createPathContext(root, "src/index.ts");

  assert.equal(context.ownership.status, "owned");
  assert.deepEqual(context.ownership.domains, ["example"]);
  assert.deepEqual(context.dependencies.direct, ["src/contract.ts"]);
  assert.deepEqual(context.dependencies.reverse, ["src/index.test.ts"]);
  assert.ok(context.tests.includes("src/index.test.ts"));
  assert.equal(context.nearestAgentInstructions, "AGENTS.md");
  assert.deepEqual(context.contracts, ["src/contract.ts"]);
  assert.match(renderPathContext(context), /## Tier 0/);
});

test("path context는 manifest 전체가 아닌 전이 의존 contract만 표시한다", () => {
  const root = createRepositoryFixture();
  writeFixture(root, "src/unused-contract.ts", "export const unused = 1;\n");
  writeFixture(
    root,
    "docs/agent/domains/example.json",
    JSON.stringify(
      createManifest("example", {
        contracts: ["src/contract.ts", "src/unused-contract.ts"],
      }),
    ),
  );
  writeFixture(
    root,
    "src/index.ts",
    'import { contract } from "./contract";\nexport const value = contract;\n',
  );
  writeFixture(root, "src/contract.ts", "export const contract = 1;\n");

  const context = createPathContext(root, "src/index.ts");

  assert.deepEqual(context.contracts, ["src/contract.ts"]);
});

test("manifest 미소유 파일도 path fallback context를 반환한다", () => {
  const root = createRepositoryFixture();
  writeFixture(root, "apps/web/src/runtime/speech/helper.ts");

  const context = createPathContext(
    root,
    "apps/web/src/runtime/speech/helper.ts",
  );

  assert.equal(context.ownership.status, "fallback");
  assert.equal(context.capability, "speech");
  assert.equal(context.workspace.packageName, "@orbit/web");
});
