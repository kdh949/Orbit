import http from "k6/http";
import { check, sleep } from "k6";
import {
  handleLoadSummary,
  jsonHeaders,
  profile,
  scenarioOptions,
} from "./common.js";

if (!__ENV.PROJECT_ID) throw new Error("PROJECT_ID is required.");

export const options = {
  scenarios: { async_worker_health: scenarioOptions() },
  thresholds: { checks: ["rate>0.99"], http_req_failed: ["rate<0.01"] },
};

export default function () {
  const created = http.post(
    `${profile.baseUrl}/api/v1/jobs`,
    JSON.stringify({
      projectId: __ENV.PROJECT_ID,
      type: "worker-health-check",
      payload: {},
    }),
    {
      headers: jsonHeaders(),
      tags: { operation: "job-enqueue", job_class: "worker-health-check" },
    },
  );
  if (!check(created, { "job was queued": (value) => value.status === 201 }))
    return;
  const jobId = created.json("jobId");
  if (typeof jobId !== "string") return;

  const pollLimit = Number(__ENV.JOB_POLL_LIMIT || 10);
  for (let attempt = 0; attempt < pollLimit; attempt += 1) {
    const polled = http.get(
      `${profile.baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}`,
      {
        headers: jsonHeaders(),
        tags: { operation: "job-poll", job_class: "worker-health-check" },
      },
    );
    const status = polled.json("status");
    if (status === "succeeded" || status === "failed") {
      check(polled, {
        "worker health job succeeded": () => status === "succeeded",
      });
      return;
    }
    sleep(0.5);
  }
  check(null, { "job completed within poll limit": () => false });
}

export const handleSummary = handleLoadSummary;
