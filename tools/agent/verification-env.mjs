import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const verificationDefaultKeys = new Set([
  "API_BASE_URL",
  "API_PORT",
  "APP_ENV",
  "AWS_ACCESS_KEY_ID",
  "AWS_REGION",
  "AWS_SECRET_ACCESS_KEY",
  "COOKIE_SECRET",
  "DATABASE_URL",
  "DEMO_DECK_ID",
  "DEMO_PROJECT_ID",
  "DEMO_SESSION_ID",
  "DEMO_USER_ID",
  "DEMO_WORKSPACE_ID",
  "JOB_QUEUE_DRIVER",
  "LIVE_STT_PROVIDER",
  "LLM_PROVIDER",
  "NODE_ENV",
  "OCR_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "OPENAI_MODEL",
  "OPENAI_TRANSCRIPTION_MODEL",
  "PYTHON_WORKER_PORT",
  "PYTHON_WORKER_URL",
  "REDIS_URL",
  "REPORT_STT_PROVIDER",
  "S3_ACCESS_KEY_ID",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_PUBLIC_ENDPOINT",
  "S3_REGION",
  "S3_SECRET_ACCESS_KEY",
  "SESSION_SECRET",
  "STORAGE_DRIVER",
  "TRANSCRIBE_LANGUAGE_CODE",
  "WEB_ORIGIN",
  "WEB_PORT",
  "WORKER_PORT",
]);

export function createVerificationEnvironment(
  root,
  currentEnvironment = process.env,
) {
  const parsedDefaults = parseEnv(
    readFileSync(resolve(root, ".env.example"), "utf8"),
  );
  const publicDefaults = Object.fromEntries(
    Object.entries(parsedDefaults).filter(([key]) =>
      verificationDefaultKeys.has(key),
    ),
  );
  return {
    ...publicDefaults,
    ...currentEnvironment,
  };
}
