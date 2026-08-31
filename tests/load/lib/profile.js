const LARGE_CONFIRMATION = "true";
const ORBIT_PRODUCTION_HOST = "orbit.dhkim.cloud";

export function buildK6Profile(env) {
  const profile = env.LOAD_PROFILE || "smoke";
  const baseUrl = requireSafeTarget(env);

  if (profile === "smoke") {
    const vus = integer(env.K6_VUS, 2);
    const iterations = integer(env.K6_ITERATIONS_PER_VU, 1);
    const maxDurationSeconds = integer(env.K6_MAX_DURATION_SECONDS, 30);
    if (vus < 1 || vus > 2 || iterations !== 1 || maxDurationSeconds > 30) {
      throw new Error(
        "Smoke profile is limited to 2 VUs, one iteration per VU, and 30 seconds.",
      );
    }
    return {
      baseUrl,
      profile,
      vus,
      iterations,
      maxDuration: `${maxDurationSeconds}s`,
    };
  }

  if (profile !== "acceptance")
    throw new Error(`Unsupported LOAD_PROFILE: ${profile}`);
  requireLargeConfirmation(env);
  const vus = integer(env.K6_VUS, 0);
  const iterations = integer(env.K6_ITERATIONS_PER_VU, 0);
  const maxDurationSeconds = integer(env.K6_MAX_DURATION_SECONDS, 600);
  if (vus < 1 || vus > 1_000 || iterations < 1 || maxDurationSeconds < 1) {
    throw new Error(
      "Acceptance profile requires explicit positive K6_VUS and K6_ITERATIONS_PER_VU (VUs <= 1000).",
    );
  }
  return {
    baseUrl,
    profile,
    vus,
    iterations,
    maxDuration: `${maxDurationSeconds}s`,
  };
}

export function requireSafeTarget(env) {
  if (!env.BASE_URL) throw new Error("BASE_URL is required.");
  const target = new URL(env.BASE_URL);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("BASE_URL must use HTTP or HTTPS.");
  if (
    target.hostname === ORBIT_PRODUCTION_HOST &&
    env.CONFIRM_ORBIT_DHKIM_CLOUD !== LARGE_CONFIRMATION
  ) {
    throw new Error(
      "orbit.dhkim.cloud requires CONFIRM_ORBIT_DHKIM_CLOUD=true.",
    );
  }
  return target.origin;
}

export function requireLargeConfirmation(env) {
  if (env.CONFIRM_LARGE_LOAD !== LARGE_CONFIRMATION) {
    throw new Error("Large profiles require CONFIRM_LARGE_LOAD=true.");
  }
}

function integer(value, fallback) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed))
    throw new Error(`Expected an integer, received: ${String(value)}`);
  return parsed;
}
