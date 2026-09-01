import http from "k6/http";
import { check } from "k6";
import {
  authenticatedHeaders,
  handleLoadSummary,
  profile,
  scenarioOptions,
} from "./common.js";

if (!__ENV.SYNC_PATH || !__ENV.SYNC_PATH.startsWith("/api/v1/")) {
  throw new Error("SYNC_PATH must be an explicit /api/v1/ read path.");
}

export const options = {
  scenarios: { sync_api: scenarioOptions() },
  thresholds: {
    checks: ["rate>0.99"],
    dropped_iterations: ["count==0"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const response = http.get(`${profile.baseUrl}${__ENV.SYNC_PATH}`, {
    headers: authenticatedHeaders(),
    tags: { operation: "sync-api-read" },
  });
  check(response, { "sync API returned 200": (value) => value.status === 200 });
}

export const handleSummary = handleLoadSummary;
