import { requireSafeTarget } from "./profile.js";

const MIXED_PROFILES = {
  smoke: {
    audienceVus: 10,
    ownerContexts: 1,
    responseWindowMs: 5_000,
  },
  average: {
    audienceVus: 50,
    ownerContexts: 5,
    responseWindowMs: 15_000,
  },
};

export function buildMixedProfile(profileName, env) {
  const profile = MIXED_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unsupported MIXED_PROFILE: ${profileName}`);
  }
  const { baseUrl } = validateMixedEnvironment(profileName, env);
  return { baseUrl, profile: profileName, ...profile };
}

export function validateMixedEnvironment(profileName, env) {
  if (!MIXED_PROFILES[profileName]) {
    throw new Error(`Unsupported MIXED_PROFILE: ${profileName}`);
  }

  const required = [
    "ARTILLERY_PUSHGATEWAY_URL",
    "BASE_URL",
    "K6_PROMETHEUS_RW_SERVER_URL",
    "MIXED_TEST_EMAIL",
    "MIXED_TEST_PASSWORD",
    "LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN",
  ];
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`${key} is required.`);
  }
  if (env.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN.trim().length < 32) {
    throw new Error(
      "LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN must be at least 32 characters.",
    );
  }
  if (profileName === "average" && env.CONFIRM_LARGE_LOAD !== "true") {
    throw new Error("average profile requires CONFIRM_LARGE_LOAD=true.");
  }

  const baseUrl = requireSafeTarget(env);
  if (env.ARTILLERY_PUSHGATEWAY_URL) {
    requireHttpUrl("ARTILLERY_PUSHGATEWAY_URL", env.ARTILLERY_PUSHGATEWAY_URL);
  }
  if (env.K6_PROMETHEUS_RW_SERVER_URL) {
    requireHttpUrl(
      "K6_PROMETHEUS_RW_SERVER_URL",
      env.K6_PROMETHEUS_RW_SERVER_URL,
    );
  }
  return { baseUrl };
}

function requireHttpUrl(key, value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${key} must use HTTP or HTTPS.`);
  }
}
