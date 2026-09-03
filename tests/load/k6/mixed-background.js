import encoding from "k6/encoding";
import http from "k6/http";
import { check, sleep } from "k6";
import { requireSafeTarget } from "../lib/profile.js";

const profileName = __ENV.MIXED_PROFILE || "smoke";
if (!["smoke", "average"].includes(profileName)) {
  throw new Error(`Unsupported MIXED_PROFILE: ${profileName}`);
}
if (profileName === "average" && __ENV.CONFIRM_LARGE_LOAD !== "true") {
  throw new Error("average profile requires CONFIRM_LARGE_LOAD=true.");
}
for (const key of [
  "AUTH_COOKIE",
  "BASE_URL",
  "K6_PROMETHEUS_RW_SERVER_URL",
  "LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN",
  "MIXED_K6_RUNTIME_PATH",
]) {
  if (!__ENV[key]) throw new Error(`${key} is required.`);
}

const runtime = parseRuntime(JSON.parse(open(__ENV.MIXED_K6_RUNTIME_PATH)));
const baseUrl = requireSafeTarget(__ENV);
const iterations = profileName === "average" ? 5 : 1;
const scenario = (exec) => ({
  exec,
  executor: "per-vu-iterations",
  iterations,
  maxDuration: "5m",
  vus: 1,
});

export const options = {
  scenarios: {
    project_deck_read: scenario("projectDeckRead"),
    file_round_trip: scenario("fileRoundTrip"),
    worker_health: scenario("workerHealth"),
    job_report_poll: scenario("jobReportPoll"),
    presentation_read: scenario("presentationRead"),
  },
  thresholds: {
    checks: ["rate>0.99"],
    dropped_iterations: ["count==0"],
    http_req_failed: ["rate<0.01"],
  },
};

const png = encoding.b64decode(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "std",
);

export function projectDeckRead() {
  const listed = http.get(
    `${baseUrl}/api/v1/workspaces/${segment(runtime.workspaceId)}/projects`,
    requestOptions("project-list"),
  );
  check(listed, {
    "project list returned 200": (value) => value.status === 200,
  });
  for (const projectId of runtime.projectIds) {
    const deck = http.get(
      `${baseUrl}/api/v1/projects/${segment(projectId)}/deck`,
      requestOptions("deck-read"),
    );
    check(deck, { "deck read returned 200": (value) => value.status === 200 });
  }
}

export function fileRoundTrip() {
  const projectId = runtime.projectIds[__ITER % runtime.projectIds.length];
  const root = `${baseUrl}/api/v1/projects/${segment(projectId)}/assets`;
  const requested = http.post(
    `${root}/upload-url`,
    JSON.stringify({
      mimeType: "image/png",
      originalName: `mixed-${runtime.runId}-${__VU}-${__ITER}.png`,
      purpose: "reference-material",
      size: png.byteLength,
    }),
    requestOptions("file-upload-url", true),
  );
  if (
    !check(requested, { "upload URL issued": (value) => value.status === 201 })
  ) {
    return;
  }
  const fileId = requested.json("fileId");
  const uploadUrl = requested.json("uploadUrl");
  const uploadHeaders = requested.json("headers") || {};
  const uploaded = http.put(uploadUrl, png, {
    headers: uploadHeaders,
    tags: { operation: "file-upload" },
  });
  if (
    !check(uploaded, {
      "small file uploaded": (value) => [200, 204].includes(value.status),
    })
  ) {
    return;
  }
  const completed = http.post(
    `${root}/complete`,
    JSON.stringify({ fileId }),
    requestOptions("file-complete", true),
  );
  if (
    !check(completed, {
      "small file completed": (value) => value.status === 201,
    })
  ) {
    return;
  }
  const downloaded = http.get(
    `${root}/${segment(fileId)}/content`,
    requestOptions("file-download", false, "binary"),
  );
  check(downloaded, {
    "small file round trip matched": (value) =>
      value.status === 200 && value.body.byteLength === png.byteLength,
  });
}

export function workerHealth() {
  const projectId = runtime.projectIds[__ITER % runtime.projectIds.length];
  const created = http.post(
    `${baseUrl}/api/v1/jobs`,
    JSON.stringify({ projectId, type: "worker-health-check", payload: {} }),
    requestOptions("worker-health-enqueue", true),
  );
  if (
    !check(created, {
      "worker health job queued": (value) => value.status === 201,
    })
  ) {
    return;
  }
  pollJob(String(created.json("jobId")), "worker-health-check");
}

export function jobReportPoll() {
  const jobId = runtime.jobIds[__ITER % runtime.jobIds.length];
  pollJob(jobId, "retained-journey-job");
  for (const path of runtime.reportPaths) {
    const report = http.get(`${baseUrl}${path}`, requestOptions("report-read"));
    check(report, {
      "retained report returned 200": (value) => value.status === 200,
    });
  }
}

export function presentationRead() {
  const current = http.get(
    `${baseUrl}/api/v1/projects/${segment(runtime.presentation.projectId)}/presentation-sessions/current?deckId=${segment(runtime.presentation.deckId)}`,
    requestOptions("presentation-current"),
  );
  check(current, {
    "presentation current returned 200": (value) => value.status === 200,
  });
  const results = http.get(
    `${baseUrl}/api/v1/projects/${segment(runtime.presentation.projectId)}/presentation-sessions/${segment(runtime.presentation.sessionId)}/results`,
    requestOptions("presentation-results"),
  );
  check(results, {
    "presentation results returned 200": (value) => value.status === 200,
  });
  const run = http.get(
    `${baseUrl}/api/v1/projects/${segment(runtime.presentation.projectId)}/presentation-sessions/${segment(runtime.presentation.sessionId)}/runs`,
    requestOptions("presentation-run"),
  );
  check(run, {
    "presentation run returned 200": (value) => value.status === 200,
  });
}

function pollJob(jobId, jobClass) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = http.get(
      `${baseUrl}/api/v1/jobs/${segment(jobId)}`,
      requestOptions("job-poll", false, undefined, { job_class: jobClass }),
    );
    const status = response.json("status");
    if (status === "succeeded" || status === "failed") {
      check(response, { "polled job succeeded": () => status === "succeeded" });
      return;
    }
    sleep(0.5);
  }
  check(null, { "job completed within bounded polling": () => false });
}

function requestOptions(operation, json = false, responseType, extraTags = {}) {
  return {
    headers: {
      Cookie: __ENV.AUTH_COOKIE,
      ...(json ? { "Content-Type": "application/json" } : {}),
      "x-orbit-load-test-token": __ENV.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN,
    },
    ...(responseType ? { responseType } : {}),
    tags: { operation, ...extraTags },
  };
}

function parseRuntime(input) {
  if (!input?.runId || !input?.workspaceId) {
    throw new Error("Mixed k6 runtime requires runId and workspaceId.");
  }
  if (!Array.isArray(input.projectIds) || input.projectIds.length < 2) {
    throw new Error("Mixed k6 runtime requires AI and PPTX project IDs.");
  }
  if (!Array.isArray(input.jobIds) || input.jobIds.length === 0) {
    throw new Error("Mixed k6 runtime requires retained job IDs.");
  }
  if (!Array.isArray(input.reportPaths) || input.reportPaths.length === 0) {
    throw new Error("Mixed k6 runtime requires report paths.");
  }
  if (
    !input.presentation?.deckId ||
    !input.presentation?.projectId ||
    !input.presentation?.sessionId
  ) {
    throw new Error("Mixed k6 runtime requires presentation identifiers.");
  }
  return input;
}

function segment(value) {
  return encodeURIComponent(value);
}

export function handleSummary(data) {
  const output = { stdout: `${JSON.stringify(data, null, 2)}\n` };
  if (__ENV.SUMMARY_PATH) {
    output[__ENV.SUMMARY_PATH] = JSON.stringify(data, null, 2);
  }
  return output;
}
