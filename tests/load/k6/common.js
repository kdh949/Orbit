import { buildK6Profile } from "../lib/profile.js";

export const profile = buildK6Profile(__ENV);

export function scenarioOptions() {
  if (profile.executor === "ramping-arrival-rate") {
    return {
      executor: "ramping-arrival-rate",
      startRate: profile.startRate,
      timeUnit: profile.timeUnit,
      preAllocatedVUs: profile.preAllocatedVUs,
      stages: profile.stages,
    };
  }
  return {
    executor: "per-vu-iterations",
    vus: profile.vus,
    iterations: profile.iterations,
    maxDuration: profile.maxDuration,
  };
}

export function authenticatedHeaders(extra = {}) {
  if (!__ENV.AUTH_COOKIE) throw new Error("AUTH_COOKIE is required.");
  return { Cookie: __ENV.AUTH_COOKIE, ...extra };
}

export function jsonHeaders() {
  return authenticatedHeaders({ "Content-Type": "application/json" });
}

export function handleLoadSummary(data) {
  const output = { stdout: `${JSON.stringify(data, null, 2)}\n` };
  if (__ENV.SUMMARY_PATH)
    output[__ENV.SUMMARY_PATH] = JSON.stringify(data, null, 2);
  return output;
}
