import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

const packagePaths = [
  "apps/web/package.json",
  "apps/api/package.json",
  "apps/worker/package.json"
];

test("Turbo가 dependency build 순서를 단독으로 소유한다", () => {
  const turbo = readJson("turbo.json");

  for (const task of ["lint", "test", "typecheck"]) {
    assert.deepEqual(turbo.tasks[task].dependsOn, ["^build"]);
  }
});

test("app 검증 script가 workspace dependency build를 직접 실행하지 않는다", () => {
  for (const packagePath of packagePaths) {
    const packageJson = readJson(packagePath);
    for (const task of ["lint", "test", "typecheck"]) {
      const script = packageJson.scripts[task];
      assert.equal(typeof script, "string", `${packagePath} ${task} script 누락`);
      assert.doesNotMatch(
        script,
        /(?:corepack\s+)?pnpm\s+--filter\s+.+\s+build/,
        `${packagePath} ${task}가 dependency build를 직접 실행함`
      );
    }
  }
});

test("migration command의 명시적 config build는 유지한다", () => {
  const api = readJson("apps/api/package.json");

  for (const task of ["migration:run", "migration:revert", "migration:generate"]) {
    assert.match(api.scripts[task], /@orbit\/shared build/);
    assert.match(api.scripts[task], /@orbit\/config build/);
  }
});
