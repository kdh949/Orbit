const LARGE_CONFIRMATION = "true";
const ORBIT_PRODUCTION_HOST = "orbit.dhkim.cloud";
const ARRIVAL_RATE_PROFILES = {
  average: {
    startRate: 1,
    preAllocatedVUs: 20,
    stages: [
      { target: 5, duration: "1m" }, // 1에서 5까지 증가 (1분간)
      { target: 5, duration: "5m" }, // 5인 상태로 유지 (5분간)
      { target: 0, duration: "1m" }, // 5에서 0으로 감소 (1분간)
    ],
  },
  load: {
    startRate: 5,
    preAllocatedVUs: 80,
    stages: [
      { target: 10, duration: "2m" },
      { target: 10, duration: "3m" },
      { target: 20, duration: "2m" },
      { target: 20, duration: "5m" },
      { target: 0, duration: "1m" },
    ],
  },
  stress: {
    startRate: 20,
    preAllocatedVUs: 160,
    stages: [
      { target: 30, duration: "2m" },
      { target: 30, duration: "3m" },
      { target: 40, duration: "2m" },
      { target: 40, duration: "3m" },
      { target: 0, duration: "2m" },
    ],
  },
  spike: {
    startRate: 5,
    preAllocatedVUs: 240,
    stages: [
      { target: 5, duration: "1m" },
      { target: 60, duration: "10s" },
      { target: 60, duration: "30s" },
      { target: 5, duration: "10s" },
      { target: 5, duration: "1m" },
      { target: 0, duration: "10s" },
    ],
  },
};

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
      executor: "per-vu-iterations",
      vus,
      iterations,
      maxDuration: `${maxDurationSeconds}s`,
    };
  }

  if (Object.hasOwn(ARRIVAL_RATE_PROFILES, profile)) {
    requireLargeConfirmation(env);
    return {
      baseUrl,
      profile,
      executor: "ramping-arrival-rate",
      timeUnit: "1s",
      ...ARRIVAL_RATE_PROFILES[profile],
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
    executor: "per-vu-iterations",
    vus,
    iterations,
    maxDuration: `${maxDurationSeconds}s`,
  };
}

export function requireSafeTarget(env) {
  if (!env.BASE_URL) throw new Error("BASE_URL is required.");
  const value = env.BASE_URL.trim();
  if (!/^https?:\/\//i.test(value))
    throw new Error("BASE_URL must use HTTP or HTTPS.");
  const match =
    /^(https?):\/\/(\[[0-9a-f:.]+\]|[^/?#:@\s]+)(?::([0-9]{1,5}))?(?:[/?#].*)?$/i.exec(
      value,
    );
  if (!match) throw new Error("BASE_URL must be a valid HTTP(S) URL.");

  const protocol = match[1].toLowerCase();
  const rawHostname = match[2];
  const hostname = rawHostname.startsWith("[")
    ? rawHostname.slice(1, -1).toLowerCase()
    : rawHostname.toLowerCase();
  const port = match[3] ? Number(match[3]) : undefined;
  if (port !== undefined && port > 65_535)
    throw new Error("BASE_URL port must be between 0 and 65535.");

  const normalizedHost = rawHostname.startsWith("[")
    ? `[${hostname}]`
    : hostname;
  const includePort =
    port !== undefined &&
    !(
      (protocol === "http" && port === 80) ||
      (protocol === "https" && port === 443)
    );
  const origin = `${protocol}://${normalizedHost}${includePort ? `:${port}` : ""}`;
  if (
    hostname === ORBIT_PRODUCTION_HOST &&
    env.CONFIRM_ORBIT_DHKIM_CLOUD !== LARGE_CONFIRMATION
  ) {
    throw new Error(
      "orbit.dhkim.cloud requires CONFIRM_ORBIT_DHKIM_CLOUD=true.",
    );
  }
  return origin;
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
