import fs from "node:fs";

export const PERSONAL_STAGING_ENV_SOURCES = new Set([
  "repo-default",
  "doppler-optional",
  "doppler-required",
]);

export const PERSONAL_STAGING_ENV_DELIVERIES = new Set([
  "compose",
  "code-default",
]);

export function parseEnvFileContent(content, file = "<env>") {
  const entries = new Map();
  const failures = [];

  content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      return;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      failures.push(`${file}:${index + 1} invalid env declaration`);
      return;
    }

    const [, key, rawValue] = match;
    if (entries.has(key)) {
      failures.push(`${file}:${index + 1} duplicate env key: ${key}`);
      return;
    }

    entries.set(key, rawValue);
  });

  return { entries, failures };
}

export function readEnvFile(file) {
  return parseEnvFileContent(fs.readFileSync(file, "utf8"), file);
}

export function decodeEnvValue(rawValue) {
  const value = rawValue.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

export function isBlankEnvValue(rawValue) {
  return decodeEnvValue(rawValue).trim().length === 0;
}

export function isSafeRepoDefault(rawValue) {
  const value = decodeEnvValue(rawValue).trim();

  if (!value || value.includes("${") || value.includes("$(")) {
    return false;
  }

  return !/(?:replace|change[-_ ]?me|placeholder|todo|<[^>]+>)/i.test(value);
}

export function readPersonalStagingPolicy(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function parseComposeEnvironmentKeys(content) {
  const keys = new Set();
  let environmentIndent = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    if (environmentIndent !== null && indent <= environmentIndent) {
      environmentIndent = null;
    }

    if (
      /^(?:environment|x-orbit-env):(?:\s+&[A-Za-z0-9_-]+)?$/.test(line)
    ) {
      environmentIndent = indent;
      continue;
    }

    if (environmentIndent === null) {
      continue;
    }

    const declaration = /^([A-Z][A-Z0-9_]*):\s*(.+)$/.exec(line);
    if (!declaration) {
      continue;
    }

    const [, key, rawValue] = declaration;
    const value = rawValue.trim();
    const quotedValue = /^(?:"([^"]*)"|'([^']*)')$/.exec(value);
    const interpolation = /^\$\{([A-Z][A-Z0-9_]*)(?::?[-+?][^}]*)?\}$/.exec(
      quotedValue ? (quotedValue[1] ?? quotedValue[2]) : value,
    );

    if (interpolation?.[1] === key) {
      keys.add(key);
    }
  }

  return keys;
}

export function parseComposeServiceEnvironmentKeys(content) {
  const services = new Map();
  let servicesIndent = null;
  let serviceIndent = null;
  let environmentIndent = null;
  let currentService = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const indent = rawLine.length - rawLine.trimStart().length;

    if (line === "services:") {
      servicesIndent = indent;
      serviceIndent = null;
      environmentIndent = null;
      currentService = null;
      continue;
    }
    if (servicesIndent === null) {
      continue;
    }
    if (indent <= servicesIndent) {
      servicesIndent = null;
      serviceIndent = null;
      environmentIndent = null;
      currentService = null;
      continue;
    }

    const service = /^([a-z0-9][a-z0-9_-]*):$/.exec(line);
    if (service && indent === servicesIndent + 2) {
      currentService = service[1];
      serviceIndent = indent;
      environmentIndent = null;
      services.set(currentService, new Set());
      continue;
    }
    if (currentService === null || serviceIndent === null) {
      continue;
    }
    if (environmentIndent !== null && indent <= environmentIndent) {
      environmentIndent = null;
    }
    if (line === "environment:" && indent > serviceIndent) {
      environmentIndent = indent;
      continue;
    }
    if (environmentIndent === null) {
      continue;
    }

    const declaration = /^([A-Z][A-Z0-9_]*):\s*(.+)$/.exec(line);
    if (!declaration) {
      continue;
    }
    const [, key, rawValue] = declaration;
    const value = rawValue.trim();
    const quotedValue = /^(?:"([^"]*)"|'([^']*)')$/.exec(value);
    const interpolation = /^\$\{([A-Z][A-Z0-9_]*)(?::?[-+?][^}]*)?\}$/.exec(
      quotedValue ? (quotedValue[1] ?? quotedValue[2]) : value,
    );
    if (interpolation?.[1] === key) {
      services.get(currentService).add(key);
    }
  }

  return services;
}

export function collectComposeEnvironmentKeys(files) {
  const keys = new Set();

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const key of parseComposeEnvironmentKeys(content)) {
      keys.add(key);
    }
  }

  return keys;
}

export function collectComposeServiceEnvironmentKeys(file) {
  return parseComposeServiceEnvironmentKeys(fs.readFileSync(file, "utf8"));
}

export function validatePersonalStagingPolicy({
  stagingEntries,
  policy,
  composeKeys,
  policyFile = "infra/env/personal-staging-env-policy.json",
}) {
  const failures = [];

  if (policy?.version !== 1) {
    failures.push(`${policyFile} version must be 1`);
  }

  if (
    !policy?.variables ||
    typeof policy.variables !== "object" ||
    Array.isArray(policy.variables)
  ) {
    failures.push(`${policyFile} variables must be an object`);
    return failures;
  }

  const stagingKeys = new Set(stagingEntries.keys());
  const policyKeys = new Set(Object.keys(policy.variables));

  for (const key of stagingKeys) {
    if (!policyKeys.has(key)) {
      failures.push(`${policyFile} missing policy for env key: ${key}`);
    }
  }

  for (const key of policyKeys) {
    if (!stagingKeys.has(key)) {
      failures.push(`${policyFile} has unknown env key: ${key}`);
    }
  }

  for (const [key, settings] of Object.entries(policy.variables)) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      failures.push(`${policyFile} invalid policy for env key: ${key}`);
      continue;
    }

    const unexpectedFields = Object.keys(settings).filter(
      (field) => field !== "source" && field !== "delivery",
    );
    if (unexpectedFields.length > 0) {
      failures.push(
        `${policyFile} unexpected policy field for env key: ${key}`,
      );
    }

    if (!PERSONAL_STAGING_ENV_SOURCES.has(settings.source)) {
      failures.push(`${policyFile} invalid source for env key: ${key}`);
    }

    if (!PERSONAL_STAGING_ENV_DELIVERIES.has(settings.delivery)) {
      failures.push(`${policyFile} invalid delivery for env key: ${key}`);
      continue;
    }

    if (
      settings.source === "doppler-required" &&
      settings.delivery !== "compose"
    ) {
      failures.push(
        `${policyFile} required Doppler key is not delivered: ${key}`,
      );
    }

    if (settings.delivery === "compose" && !composeKeys.has(key)) {
      failures.push(
        `personal staging Compose does not deliver env key: ${key}`,
      );
    }

    if (settings.delivery === "code-default" && composeKeys.has(key)) {
      failures.push(
        `${policyFile} delivery does not match Compose for env key: ${key}`,
      );
    }

    if (
      settings.source === "repo-default" &&
      stagingEntries.has(key) &&
      !isSafeRepoDefault(stagingEntries.get(key))
    ) {
      failures.push(`${policyFile} unsafe repo default for env key: ${key}`);
    }
  }

  return failures;
}

export function selectDopplerChanges({ policy, dopplerKeys }) {
  const missingAuto = [];
  const missingRequired = [];
  const missingOptional = [];

  for (const [key, settings] of Object.entries(policy.variables)) {
    if (settings.delivery !== "compose" || dopplerKeys.has(key)) {
      continue;
    }

    if (settings.source === "repo-default") {
      missingAuto.push(key);
    } else if (settings.source === "doppler-required") {
      missingRequired.push(key);
    } else if (settings.source === "doppler-optional") {
      missingOptional.push(key);
    }
  }

  return {
    missingAuto: missingAuto.sort(),
    missingRequired: missingRequired.sort(),
    missingOptional: missingOptional.sort(),
  };
}
