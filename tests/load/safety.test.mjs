import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { buildK6Profile, requireSafeTarget } from "./lib/profile.js";

const require = createRequire(import.meta.url);
const {
  assertSafety,
  getRealtimeProfile,
  runRealtimeScenario,
} = require("./artillery/processor.cjs");

function withTemporaryEnvironment(values, run) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function artillerySafetyError() {
  let received;
  assertSafety({}, {}, (error) => {
    received = error;
  });
  return received;
}

test("smoke profile remains bounded to two one-shot VUs", () => {
  assert.deepEqual(buildK6Profile({ BASE_URL: "http://127.0.0.1:3000" }), {
    baseUrl: "http://127.0.0.1:3000",
    profile: "smoke",
    executor: "per-vu-iterations",
    vus: 2,
    iterations: 1,
    maxDuration: "30s",
  });
  assert.throws(
    () => buildK6Profile({ BASE_URL: "http://localhost:3000", K6_VUS: "3" }),
    /limited to 2 VUs/,
  );
});

test("k6 arrival-rate profiles keep conservative fixed-RPS stages", () => {
  const confirmed = {
    BASE_URL: "http://172.16.16.30",
    CONFIRM_LARGE_LOAD: "true",
  };

  assert.deepEqual(buildK6Profile({ ...confirmed, LOAD_PROFILE: "average" }), {
    baseUrl: "http://172.16.16.30",
    profile: "average",
    executor: "ramping-arrival-rate",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 20,
    stages: [
      { target: 5, duration: "1m" },
      { target: 5, duration: "5m" },
      { target: 0, duration: "1m" },
    ],
  });
  assert.deepEqual(buildK6Profile({ ...confirmed, LOAD_PROFILE: "load" }), {
    baseUrl: "http://172.16.16.30",
    profile: "load",
    executor: "ramping-arrival-rate",
    startRate: 5,
    timeUnit: "1s",
    preAllocatedVUs: 80,
    stages: [
      { target: 10, duration: "2m" },
      { target: 10, duration: "3m" },
      { target: 20, duration: "2m" },
      { target: 20, duration: "5m" },
      { target: 0, duration: "1m" },
    ],
  });
  assert.deepEqual(buildK6Profile({ ...confirmed, LOAD_PROFILE: "stress" }), {
    baseUrl: "http://172.16.16.30",
    profile: "stress",
    executor: "ramping-arrival-rate",
    startRate: 20,
    timeUnit: "1s",
    preAllocatedVUs: 160,
    stages: [
      { target: 30, duration: "2m" },
      { target: 30, duration: "3m" },
      { target: 40, duration: "2m" },
      { target: 40, duration: "3m" },
      { target: 0, duration: "2m" },
    ],
  });
  assert.deepEqual(buildK6Profile({ ...confirmed, LOAD_PROFILE: "spike" }), {
    baseUrl: "http://172.16.16.30",
    profile: "spike",
    executor: "ramping-arrival-rate",
    startRate: 5,
    timeUnit: "1s",
    preAllocatedVUs: 240,
    stages: [
      { target: 5, duration: "1m" },
      { target: 60, duration: "10s" },
      { target: 60, duration: "30s" },
      { target: 5, duration: "10s" },
      { target: 5, duration: "1m" },
      { target: 0, duration: "10s" },
    ],
  });
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
    () =>
      buildK6Profile({
        BASE_URL: "http://172.16.16.30",
        LOAD_PROFILE: "average",
      }),
    /CONFIRM_LARGE_LOAD/,
  );
  assert.throws(
    () => requireSafeTarget({ BASE_URL: "https://orbit.dhkim.cloud" }),
    /CONFIRM_ORBIT_DHKIM_CLOUD/,
  );
});

test("safe target parsing works without the Node URL global", () => {
  const originalUrl = globalThis.URL;
  try {
    globalThis.URL = undefined;
    assert.equal(
      requireSafeTarget({ BASE_URL: "http://172.16.16.30/" }),
      "http://172.16.16.30",
    );
  } finally {
    globalThis.URL = originalUrl;
  }
});

test("Artillery configs keep 50, 100, 200, and 1000 VU bounds explicit", async () => {
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
  const stagedProfiles = [
    {
      name: "average",
      duration: 60,
      arrivals: 50,
      submissionWindowMs: 30_000,
    },
    {
      name: "load",
      duration: 120,
      arrivals: 100,
      submissionWindowMs: 10_000,
    },
    {
      name: "stress",
      duration: 180,
      arrivals: 200,
      submissionWindowMs: 3_000,
    },
  ];
  assert.equal(smoke.config.phases[0].arrivalCount, 2);
  assert.equal(smoke.config.phases[0].maxVusers, 2);
  for (const expected of stagedProfiles) {
    const config = parse(
      await readFile(
        new URL(`./artillery/realtime-${expected.name}.yml`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(config.config.phases[0].duration, expected.duration);
    assert.equal(config.config.phases[0].arrivalCount, expected.arrivals);
    assert.equal(config.config.phases[0].maxVusers, expected.arrivals);
    assert.deepEqual(config.before.flow, [{ function: "assertSafety" }]);
    assert.equal(
      config.config.plugins["publish-metrics"][0].pushgateway,
      "{{ $env.ARTILLERY_PUSHGATEWAY_URL }}",
    );
    assert.deepEqual(getRealtimeProfile(expected.name), {
      rampDurationMs: expected.duration * 1_000,
      submissionWindowMs: expected.submissionWindowMs,
    });
  }
  assert.equal(acceptance.config.phases[0].duration, 300);
  assert.equal(acceptance.config.phases[0].arrivalCount, 1000);
  assert.equal(acceptance.config.phases[0].maxVusers, 1000);
  assert.deepEqual(acceptance.before.flow, [{ function: "assertSafety" }]);
  assert.equal(
    acceptance.config.plugins["publish-metrics"][0].pushgateway,
    "{{ $env.ARTILLERY_PUSHGATEWAY_URL }}",
  );
});

test("Artillery processor uses the callback contract only for synchronous hooks", () => {
  assert.equal(assertSafety.constructor.name, "Function");
  assert.equal(assertSafety.length, 3);
  assert.equal(runRealtimeScenario.constructor.name, "AsyncFunction");
  assert.equal(runRealtimeScenario.length, 2);
});

test("Artillery staged profiles require load and Pushgateway confirmations", () => {
  const required = {
    BASE_URL: "http://172.16.16.30",
    SESSION_ID: "session-id",
    PROJECT_ID: "project-id",
    ACTIVITY_ID: "activity-id",
    ACTIVITY_RUN_ID: "activity-run-id",
    QUESTION_ID: "question-id",
    LOAD_PROFILE: "average",
  };

  withTemporaryEnvironment(
    {
      ...required,
      CONFIRM_LARGE_LOAD: undefined,
      ARTILLERY_PUSHGATEWAY_URL: undefined,
    },
    () => {
      assert.match(artillerySafetyError().message, /CONFIRM_LARGE_LOAD/);
    },
  );
  withTemporaryEnvironment(
    {
      ...required,
      CONFIRM_LARGE_LOAD: "true",
      ARTILLERY_PUSHGATEWAY_URL: undefined,
    },
    () => {
      assert.match(artillerySafetyError().message, /ARTILLERY_PUSHGATEWAY_URL/);
    },
  );
  withTemporaryEnvironment(
    {
      ...required,
      CONFIRM_LARGE_LOAD: "true",
      ARTILLERY_PUSHGATEWAY_URL: "http://172.16.16.18:9091",
    },
    () => {
      assert.equal(artillerySafetyError(), undefined);
    },
  );
});

test("k6 scripts support closed and arrival-rate executors with drop guards", async () => {
  const common = await readFile(
    new URL("./k6/common.js", import.meta.url),
    "utf8",
  );
  const asyncJob = await readFile(
    new URL("./k6/async-job.js", import.meta.url),
    "utf8",
  );
  const syncApi = await readFile(
    new URL("./k6/sync-api.js", import.meta.url),
    "utf8",
  );
  const files = await readFile(
    new URL("./k6/files.js", import.meta.url),
    "utf8",
  );
  assert.match(common, /executor: "per-vu-iterations"/);
  assert.match(common, /executor: "ramping-arrival-rate"/);
  for (const script of [syncApi, asyncJob, files]) {
    assert.match(script, /dropped_iterations: \["count==0"\]/);
  }
  assert.match(asyncJob, /type: "worker-health-check"/);
  assert.doesNotMatch(asyncJob, /ai-deck-generation|rehearsal-stt/);
});

test("load-test package exposes all staged Artillery commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("./package.json", import.meta.url), "utf8"),
  );
  for (const profile of ["average", "load", "stress", "acceptance"]) {
    assert.equal(
      packageJson.scripts[`artillery:${profile}`],
      `node run-artillery.mjs ${profile}`,
    );
  }
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
