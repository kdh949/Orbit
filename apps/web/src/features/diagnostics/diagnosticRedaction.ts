import type {
  DiagnosticData,
  DiagnosticJsonValue,
  DiagnosticMode
} from "./diagnosticTypes";

const forbiddenKeys = new Set([
  "apikey",
  "authorization",
  "base64",
  "clientsecret",
  "cookie",
  "password",
  "presignedurl",
  "rawaudio",
  "refreshtoken",
  "sdp",
  "secret",
  "sessiontoken",
  "token",
  "url"
]);

const sensitiveTextKeys = new Set([
  "alternative",
  "alternatives",
  "biasphrase",
  "biasphrases",
  "canonicaltext",
  "delta",
  "fulltranscript",
  "latesttranscript",
  "normalizedtext",
  "phrase",
  "phrases",
  "speakernotes",
  "text",
  "transcript"
]);

export function redactDiagnosticData(
  data: DiagnosticData,
  mode: Exclude<DiagnosticMode, "off">
): DiagnosticData {
  return redactObject(data, mode);
}

function redactObject(
  value: Record<string, DiagnosticJsonValue>,
  mode: Exclude<DiagnosticMode, "off">
): DiagnosticData {
  const output: DiagnosticData = {};

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (isForbiddenKey(normalizedKey)) {
      continue;
    }

    if (mode === "metadata" && isSensitiveTextKey(normalizedKey)) {
      output[key] = describeRedactedValue(entry);
      continue;
    }

    output[key] = redactValue(entry, mode);
  }

  return output;
}

function redactValue(
  value: DiagnosticJsonValue,
  mode: Exclude<DiagnosticMode, "off">
): DiagnosticJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, mode));
  }
  if (isRecord(value)) {
    return redactObject(value, mode);
  }
  return value;
}

function describeRedactedValue(value: DiagnosticJsonValue): DiagnosticJsonValue {
  if (typeof value === "string") {
    return { redacted: true, length: value.length };
  }
  if (Array.isArray(value)) {
    return { redacted: true, count: value.length };
  }
  if (isRecord(value)) {
    return { redacted: true, fieldCount: Object.keys(value).length };
  }
  return value;
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isForbiddenKey(key: string) {
  return (
    forbiddenKeys.has(key) ||
    key.endsWith("token") ||
    key.endsWith("secret") ||
    key.endsWith("password") ||
    key.endsWith("cookie") ||
    key.endsWith("base64") ||
    key.endsWith("sdp")
  );
}

function isSensitiveTextKey(key: string) {
  return (
    sensitiveTextKeys.has(key) ||
    key.endsWith("transcript") ||
    key.endsWith("speakernotes") ||
    key.endsWith("biasphrases")
  );
}

function isRecord(
  value: DiagnosticJsonValue
): value is Record<string, DiagnosticJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
