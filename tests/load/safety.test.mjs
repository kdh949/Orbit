import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { buildK6Profile, requireSafeTarget } from "./lib/profile.js";

test("smoke profile remains bounded to two one-shot VUs", () => {
  assert.deepEqual(buildK6Profile({ BASE_URL: "http://127.0.0.1:3000" }), {
    baseUrl: "http://127.0.0.1:3000",
    profile: "smoke",
    vus: 2,
    iterations: 1,
    maxDuration: "30s",
  });
  assert.throws(
    () => buildK6Profile({ BASE_URL: "http://localhost:3000", K6_VUS: "3" }),
    /limited to 2 VUs/,
  );
});

test("large and deployed-host profiles require explicit confirmations", () => {
  assert.throws(
    () =>
      buildK6Profile({
        BASE_URL: "http://localhost:3000",
        LOAD_PROFILE: "acceptance",
        K6_VUS: "10",
        K6_ITERATIONS_PER_VU: "1",
      }),
    /CONFIRM_LARGE_LOAD/,
  );
  assert.throws(
    () => requireSafeTarget({ BASE_URL: "https://orbit.dhkim.cloud" }),
    /CONFIRM_ORBIT_DHKIM_CLOUD/,
  );
});

test("Artillery configs parse and keep smoke and acceptance bounds explicit", async () => {
  const smoke = parse(
    await readFile(
      new URL("./artillery/realtime-smoke.yml", import.meta.url),
      "utf8",
    ),
  );
  const acceptance = parse(
    await readFile(
      new URL("./artillery/realtime-acceptance.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(smoke.config.phases[0].arrivalCount, 2);
  assert.equal(smoke.config.phases[0].maxVusers, 2);
  assert.equal(acceptance.config.phases[0].duration, 300);
  assert.equal(acceptance.config.phases[0].arrivalCount, 1000);
  assert.equal(acceptance.config.phases[0].maxVusers, 1000);
  assert.deepEqual(acceptance.before.flow, [{ function: "assertSafety" }]);
  assert.equal(
    acceptance.config.plugins["publish-metrics"][0].pushgateway,
    "{{ $env.ARTILLERY_PUSHGATEWAY_URL }}",
  );
});

test("k6 scripts use per-vu iterations and only the safe async job class", async () => {
  const common = await readFile(
    new URL("./k6/common.js", import.meta.url),
    "utf8",
  );
  const asyncJob = await readFile(
    new URL("./k6/async-job.js", import.meta.url),
    "utf8",
  );
  assert.match(common, /executor: "per-vu-iterations"/);
  assert.match(asyncJob, /type: "worker-health-check"/);
  assert.doesNotMatch(asyncJob, /ai-deck-generation|rehearsal-stt/);
});

test("network smoke scripts preserve origin checks and binary integrity", async () => {
  const processor = await readFile(
    new URL("./artillery/processor.cjs", import.meta.url),
    "utf8",
  );
  const files = await readFile(
    new URL("./k6/files.js", import.meta.url),
    "utf8",
  );
  assert.match(processor, /origin: env\.baseUrl/);
  assert.match(processor, /env\.profile === "smoke" \? 5_000 : 10_000/);
  assert.match(files, /responseType: "binary"/);
  assert.match(files, /value\.body\.byteLength === png\.byteLength/);
});
