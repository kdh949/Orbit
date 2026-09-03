import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMixedProfile,
  validateMixedEnvironment,
} from "./lib/mixed-profile.js";
import { buildMixedManifest } from "./lib/mixed-manifest.js";
import { redactMixedDiagnostic } from "./lib/mixed-redaction.js";

const require = createRequire(import.meta.url);
const {
  buildActivityAnswers,
  getMixedAudienceProfile,
  parseMixedActivities,
  requireAudiencePayloadBoundary,
  runMixedAudienceScenario,
  validateMixedAudienceEnvironment,
} = require("./artillery/mixed-processor.cjs");

const directEnvironment = {
  ARTILLERY_PUSHGATEWAY_URL: "http://172.16.16.18:9091",
  BASE_URL: "http://172.16.16.30",
  CONFIRM_LARGE_LOAD: "true",
  K6_PROMETHEUS_RW_SERVER_URL: "http://172.16.16.18:9090/api/v1/write",
  LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN: "x".repeat(32),
  MIXED_TEST_EMAIL: "mixed@example.test",
  MIXED_TEST_PASSWORD: "mixed-password",
};

test("mixed profiles keep smoke and average actor bounds fixed", () => {
  assert.deepEqual(buildMixedProfile("smoke", directEnvironment), {
    audienceVus: 10,
    baseUrl: "http://172.16.16.30",
    ownerContexts: 1,
    profile: "smoke",
    responseWindowMs: 5_000,
  });
  assert.deepEqual(buildMixedProfile("average", directEnvironment), {
    audienceVus: 50,
    baseUrl: "http://172.16.16.30",
    ownerContexts: 5,
    profile: "average",
    responseWindowMs: 15_000,
  });
  assert.throws(
    () => buildMixedProfile("load", directEnvironment),
    /Unsupported MIXED_PROFILE/,
  );
});

test("mixed average requires credentials, confirmations, and metric endpoints", () => {
  assert.throws(
    () =>
      validateMixedEnvironment("average", {
        ...directEnvironment,
        CONFIRM_LARGE_LOAD: undefined,
      }),
    /CONFIRM_LARGE_LOAD/,
  );
  assert.throws(
    () =>
      validateMixedEnvironment("average", {
        ...directEnvironment,
        ARTILLERY_PUSHGATEWAY_URL: undefined,
      }),
    /ARTILLERY_PUSHGATEWAY_URL/,
  );
  assert.throws(
    () =>
      validateMixedEnvironment("average", {
        ...directEnvironment,
        K6_PROMETHEUS_RW_SERVER_URL: undefined,
      }),
    /K6_PROMETHEUS_RW_SERVER_URL/,
  );
  assert.throws(
    () =>
      validateMixedEnvironment("average", {
        ...directEnvironment,
        MIXED_TEST_PASSWORD: undefined,
      }),
    /MIXED_TEST_PASSWORD/,
  );
});

test("mixed target validation retains the deployed-host confirmation guard", () => {
  assert.throws(
    () =>
      validateMixedEnvironment("smoke", {
        ...directEnvironment,
        BASE_URL: "https://orbit.dhkim.cloud",
        CONFIRM_ORBIT_DHKIM_CLOUD: undefined,
      }),
    /CONFIRM_ORBIT_DHKIM_CLOUD/,
  );
  assert.equal(
    validateMixedEnvironment("average", directEnvironment).baseUrl,
    "http://172.16.16.30",
  );
});

test("mixed manifest keeps diagnostic ids but excludes credentials and private content", () => {
  const manifest = buildMixedManifest({
    baseUrl: "http://172.16.16.30",
    endedAt: "2026-09-02T01:10:00.000Z",
    gitSha: "a".repeat(40),
    profile: "average",
    resources: {
      activityIds: ["activity_pre", "activity_poll", "activity_satisfaction"],
      jobIds: ["job_1"],
      projectIds: ["project_1"],
      runIds: ["run_1"],
      sessionIds: ["session_1"],
    },
    results: ["k6-summary.json", "artillery.json"],
    runId: "20260902-010000-mixed-average",
    startedAt: "2026-09-02T01:00:00.000Z",
    unsafe: {
      audiencePasscode: "2468",
      authCookie: "orbit_session=secret",
      email: "mixed@example.test",
      password: "secret",
      signedUrl: "http://minio/object?X-Amz-Signature=secret",
      speakerNotes: "private notes",
      token: "secret-token",
      transcript: "private transcript",
    },
  });

  assert.equal(manifest.runId, "20260902-010000-mixed-average");
  assert.deepEqual(manifest.resources.projectIds, ["project_1"]);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /secret|2468|mixed@example|private/,
  );
  assert.equal("unsafe" in manifest, false);
  assert.throws(
    () =>
      buildMixedManifest({
        baseUrl: "http://172.16.16.30",
        endedAt: "2026-09-02T01:10:00.000Z",
        gitSha: "a".repeat(40),
        profile: "load",
        runId: "invalid-profile",
        startedAt: "2026-09-02T01:00:00.000Z",
      }),
    /profile/,
  );
});

test("mixed audience profiles keep connection and response windows bounded", () => {
  assert.deepEqual(getMixedAudienceProfile("smoke"), {
    audienceVus: 10,
    connectRampMs: 5_000,
    responseWindowMs: 5_000,
  });
  assert.deepEqual(getMixedAudienceProfile("average"), {
    audienceVus: 50,
    connectRampMs: 60_000,
    responseWindowMs: 15_000,
  });
});

test("mixed audience answers cover pre-question, poll, and satisfaction contracts", () => {
  assert.deepEqual(
    buildActivityAnswers(
      {
        questions: [
          { questionId: "question_pre", required: true, type: "free-text" },
        ],
        template: "pre-question",
      },
      "audience-1",
    ),
    [
      {
        questionId: "question_pre",
        text: "혼합 테스트 질문 audience-1",
        type: "free-text",
      },
    ],
  );

  assert.deepEqual(
    buildActivityAnswers(
      {
        questions: [
          {
            options: [{ optionId: "option_a" }, { optionId: "option_b" }],
            questionId: "question_poll",
            required: true,
            type: "single-choice",
          },
        ],
        template: "poll",
      },
      "audience-1",
    ),
    [
      {
        optionId: "option_a",
        questionId: "question_poll",
        type: "single-choice",
      },
    ],
  );

  const satisfaction = buildActivityAnswers(
    {
      questions: [
        { questionId: "question_rating", required: true, type: "rating" },
        {
          options: [{ optionId: "option_single" }],
          questionId: "question_single",
          required: true,
          type: "single-choice",
        },
        {
          maxSelections: 2,
          options: [
            { optionId: "option_multi_a" },
            { optionId: "option_multi_b" },
          ],
          questionId: "question_multi",
          required: false,
          type: "multiple-choice",
        },
        { questionId: "question_text", required: false, type: "free-text" },
      ],
      template: "satisfaction",
    },
    "audience-1",
  );
  assert.deepEqual(satisfaction, [
    { questionId: "question_rating", type: "rating", value: 4 },
    {
      optionId: "option_single",
      questionId: "question_single",
      type: "single-choice",
    },
    {
      optionIds: ["option_multi_a", "option_multi_b"],
      questionId: "question_multi",
      type: "multiple-choice",
    },
    {
      questionId: "question_text",
      text: "혼합 테스트 의견 audience-1",
      type: "free-text",
    },
  ]);
});

test("mixed Artillery processor uses the async two-argument contract", () => {
  assert.equal(runMixedAudienceScenario.constructor.name, "AsyncFunction");
  assert.equal(runMixedAudienceScenario.length, 2);
});

test("mixed Artillery safety requires the runtime handoff and average confirmation", () => {
  const environment = {
    ARTILLERY_PUSHGATEWAY_URL: "http://172.16.16.18:9091",
    AUDIENCE_PASSCODE: "123456",
    BASE_URL: directEnvironment.BASE_URL,
    CONFIRM_LARGE_LOAD: "true",
    LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN:
      directEnvironment.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN,
    MIXED_ACTIVITY_RUNTIME_PATH: "/tmp/orbit-mixed-runtime.json",
    MIXED_PROFILE: "average",
    PROJECT_ID: "project_1",
    SESSION_ID: "session_1",
  };
  assert.equal(
    validateMixedAudienceEnvironment(environment).profile,
    "average",
  );
  assert.throws(
    () =>
      validateMixedAudienceEnvironment({
        ...environment,
        CONFIRM_LARGE_LOAD: undefined,
      }),
    /CONFIRM_LARGE_LOAD/,
  );
  assert.throws(
    () =>
      validateMixedAudienceEnvironment({
        ...environment,
        MIXED_ACTIVITY_RUNTIME_PATH: undefined,
      }),
    /MIXED_ACTIVITY_RUNTIME_PATH/,
  );
});

test("mixed activity runtime accepts exactly the three ordered activity templates", () => {
  const activities = parseMixedActivities({
    activities: [
      {
        activityId: "activity_pre",
        activityRunId: "run_pre",
        questions: [
          { questionId: "question_pre", required: true, type: "free-text" },
        ],
        template: "pre-question",
      },
      {
        activityId: "activity_poll",
        activityRunId: "run_poll",
        questions: [
          {
            options: [{ optionId: "a" }, { optionId: "b" }],
            questionId: "question_poll",
            required: true,
            type: "single-choice",
          },
        ],
        template: "poll",
      },
      {
        activityId: "activity_satisfaction",
        activityRunId: "run_satisfaction",
        questions: [
          { questionId: "question_rating", required: true, type: "rating" },
        ],
        template: "satisfaction",
      },
    ],
  });
  assert.deepEqual(
    activities.map((activity) => activity.template),
    ["pre-question", "poll", "satisfaction"],
  );
  assert.throws(
    () => parseMixedActivities({ activities: activities.slice(0, 2) }),
    /three ordered activities/,
  );
});

test("mixed audience payload boundary rejects presenter-only content", () => {
  assert.doesNotThrow(() =>
    requireAudiencePayloadBoundary({
      activity: { activityId: "activity_1", publicResult: null },
    }),
  );
  for (const forbidden of [
    { speakerNotes: "private notes" },
    { transcript: "private transcript" },
    { rawAudioUrl: "https://storage/private.wav" },
    { presenterScript: "private script" },
  ]) {
    assert.throws(
      () => requireAudiencePayloadBoundary({ activity: forbidden }),
      /presenter-only content/,
    );
  }
});

test("mixed Artillery configs cap smoke at 10 and average at 50 audience users", async () => {
  const [smoke, average] = await Promise.all([
    readFile(new URL("./artillery/mixed-smoke.yml", import.meta.url), "utf8"),
    readFile(new URL("./artillery/mixed-average.yml", import.meta.url), "utf8"),
  ]);
  assert.match(smoke, /arrivalCount: 10/);
  assert.match(smoke, /maxVusers: 10/);
  assert.match(average, /arrivalCount: 50/);
  assert.match(average, /maxVusers: 50/);
  assert.match(average, /orbit_http_submit_ms\.p95["']?: 1000/);
  assert.match(average, /orbit_revision_event_ms\.p95["']?: 1000/);
  assert.match(average, /vusers\.failed == 0/);
});

test("mixed k6 script keeps five finite owner roles and the agreed thresholds", async () => {
  const source = await readFile(
    new URL("./k6/mixed-background.js", import.meta.url),
    "utf8",
  );
  for (const scenario of [
    "project_deck_read",
    "file_round_trip",
    "worker_health",
    "job_report_poll",
    "presentation_read",
  ]) {
    assert.match(source, new RegExp(`${scenario}:`));
  }
  assert.doesNotMatch(source, /ramping-arrival-rate|constant-arrival-rate/);
  assert.match(source, /executor: "per-vu-iterations"/);
  assert.match(source, /checks: \["rate>0\.99"\]/);
  assert.match(source, /http_req_failed: \["rate<0\.01"\]/);
  assert.match(source, /dropped_iterations: \["count==0"\]/);
  assert.match(source, /type: "worker-health-check"/);
});

test("mixed Playwright config disables sensitive artifacts and enables fake microphone input", async () => {
  const source = await readFile(
    new URL("./playwright.mixed.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /trace: "off"/);
  assert.match(source, /screenshot: "off"/);
  assert.match(source, /video: "off"/);
  assert.match(source, /--use-fake-device-for-media-stream/);
  assert.match(source, /--use-file-for-fake-audio-capture=/);
  assert.match(source, /--unsafely-treat-insecure-origin-as-secure=/);
});

test("mixed Playwright journey copies one login into bounded contexts and covers core UI labels", async () => {
  const source = await readFile(
    new URL("../e2e/mixed-user-lifecycle.spec.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /storageState/);
  assert.match(source, /ownerContexts/);
  assert.match(source, /import-fidelity-notes\.pptx/);
  for (const label of [
    "웹 리서치 허용",
    "AI 이미지 사용",
    "내용 편집하기",
    "발표 메모 수정",
    "PPTX 내보내기...",
    "PNG ZIP 내보내기...",
    "전체 리허설",
    "사전 질문",
    "실시간 투표",
    "만족도 조사",
    "응답 마감",
    "결과 공개",
  ]) {
    assert.match(source, new RegExp(label.replaceAll(".", "\\.")));
  }
  assert.match(source, /startMixedLoadProcesses/);
  assert.match(source, /responseCount/);
});

test("mixed failure diagnostics redact secret values, identity, and signed URL query", () => {
  const diagnostic = redactMixedDiagnostic(
    {
      cookie: "orbit_session=private-cookie",
      email: "mixed@example.test",
      message:
        "login mixed@example.test failed token-secret at https://storage/object?X-Amz-Signature=signed",
      presenterScript: "private presenter script",
      rawAudioUrl: "https://storage/private-audio.wav?signature=secret",
      transcript: "private transcript",
    },
    ["token-secret", "private-cookie"],
  );
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(
    serialized,
    /mixed@example|token-secret|private-cookie|private transcript|private presenter|private-audio|X-Amz-Signature/,
  );
  assert.match(serialized, /\[REDACTED\]/);
});

test("mixed runner preflights target and tools and always removes temporary runtime files", async () => {
  const source = await readFile(
    new URL("./run-mixed.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/health/);
  assert.match(source, /\/\-\/healthy/);
  assert.match(source, /k6", \["version"\]/);
  assert.match(source, /playwright", "--version"/);
  assert.match(source, /finally/);
  assert.match(source, /rm\(temporaryDirectory/);
  assert.match(source, /buildMixedManifest/);
  assert.ok(
    source.indexOf("validateRunId(runId)") <
      source.indexOf('path.join(repositoryRoot, "results", runId)'),
    "RUN_ID must be validated before it is used as a result path",
  );
});
