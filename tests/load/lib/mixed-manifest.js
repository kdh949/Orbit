const ALLOWED_RESOURCE_KEYS = [
  "activityIds",
  "jobIds",
  "projectIds",
  "runIds",
  "sessionIds",
];

export function buildMixedManifest(input) {
  const profile = requiredString(input.profile, "profile");
  if (profile !== "smoke" && profile !== "average") {
    throw new Error("profile must be smoke or average.");
  }
  const runId = requiredString(input.runId, "runId");
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(runId)) {
    throw new Error("runId contains unsupported characters.");
  }
  const target = new URL(requiredString(input.baseUrl, "baseUrl")).origin;
  const startedAt = isoDateTime(input.startedAt, "startedAt");
  const endedAt = isoDateTime(input.endedAt, "endedAt");
  const resources = {};
  for (const key of ALLOWED_RESOURCE_KEYS) {
    resources[key] = stringArray(input.resources?.[key]);
  }
  return {
    schemaVersion: 1,
    runId,
    profile,
    target,
    gitSha: requiredString(input.gitSha, "gitSha"),
    startedAt,
    endedAt,
    resources,
    results: stringArray(input.results),
  };
}

function isoDateTime(value, key) {
  const required = requiredString(value, key);
  if (Number.isNaN(Date.parse(required))) {
    throw new Error(`${key} must be an ISO date-time.`);
  }
  return required;
}

function requiredString(value, key) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim());
}
