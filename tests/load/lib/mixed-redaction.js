const SENSITIVE_KEY =
  /(?:audience.*passcode|auth.*cookie|cookie|email|password|raw.*audio|signed.*url|speaker.*(?:notes|script)|presenter.*script|token|transcript)/i;

export function redactMixedDiagnostic(value, secretValues = []) {
  const secrets = secretValues
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .sort((left, right) => right.length - left.length);
  return redactValue(value, secrets);
}

function redactValue(value, secrets) {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(item, secrets),
    ]),
  );
}

function redactString(value, secrets) {
  let redacted = value;
  for (const secret of secrets) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  redacted = redacted.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    "[REDACTED]",
  );
  redacted = redacted.replace(
    /\b(?:orbit_session|session|cookie|passcode|password|token)=([^;\s]+)/giu,
    "[REDACTED]",
  );
  return redacted.replace(/https?:\/\/[^\s"'<>]+/gu, (candidate) => {
    try {
      const url = new URL(candidate);
      return url.search ? `${url.origin}${url.pathname}?[REDACTED]` : candidate;
    } catch {
      return "[REDACTED]";
    }
  });
}
