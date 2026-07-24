import {
  collectComposeEnvironmentKeys,
  isBlankEnvValue,
  readEnvFile,
  readPersonalStagingPolicy,
  validatePersonalStagingPolicy,
} from "./personal-staging-env.mjs";

const requiredKeys = [
  "NODE_ENV",
  "APP_ENV",
  "WEB_PORT",
  "API_PORT",
  "API_JSON_BODY_LIMIT_BYTES",
  "WORKER_PORT",
  "PYTHON_WORKER_PORT",
  "WEB_ORIGIN",
  "API_BASE_URL",
  "PYTHON_WORKER_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "PRIVATE_EVIDENCE_REDIS_URL",
  "IPAD_PRESENTER_COMPANION_ENABLED",
  "ASYNC_JOB_ADMISSION_MODE",
  "ADAPTIVE_REHEARSAL_COACH_ENABLED",
  "FOCUSED_PRACTICE_ENABLED",
  "CHALLENGE_QNA_ENABLED",
  "SLIDE_PRACTICE_ENABLED",
  "SLIDE_QUESTION_GUIDES_ENABLED",
  "DEMO_COACHING_FIXTURE_ENABLED",
  "DEMO_AI_DECK_CACHE_ENABLED",
  "DEMO_AI_DECK_SOURCE_PROJECT_ID",
  "DEMO_AI_DECK_TRIGGER_TOPIC",
  "DEMO_FIXTURE_ENV_ALLOWLIST",
  "ADAPTIVE_COACHING_PROJECT_ALLOWLIST",
  "COACHING_IDEMPOTENCY_HMAC_SECRET",
  "COACHING_IDEMPOTENCY_HMAC_KEY_VERSION",
  "COACHING_IDEMPOTENCY_HMAC_PREVIOUS_SECRET",
  "COACHING_IDEMPOTENCY_HMAC_PREVIOUS_KEY_VERSION",
  "SESSION_SECRET",
  "COOKIE_SECRET",
  "STORAGE_DRIVER",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_BUCKET",
  "S3_ASSETS_BUCKET",
  "S3_PRIVATE_AUDIO_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
  "JOB_QUEUE_DRIVER",
  "AI_DECK_EXECUTION_MODE",
  "AI_DECK_WORKER_QUEUE",
  "AI_DECK_WORKER_CONCURRENCY",
  "AI_DECK_USER_CONCURRENCY",
  "LIVE_STT_PROVIDER",
  "LIVE_STT_ENGINE",
  "REPORT_STT_PROVIDER",
  "REHEARSAL_AUDIO_MAX_BYTES",
  "OCR_PROVIDER",
  "LLM_PROVIDER",
  "AI_SLIDE_IMAGE_REVIEW_MODE",
  "ORBIT_PPTX_OOXML_VECTOR_IMPORT",
  "VITE_SEMANTIC_CUE_NLI_ENABLED",
  "VITE_SEMANTIC_CUE_NLI_PROVIDER",
  "VITE_SEMANTIC_CUE_NLI_MODEL_ID",
  "VITE_SEMANTIC_CUE_NLI_BENCHMARK_PASSED",
  "VITE_SEMANTIC_CUE_NLI_BENCHMARK_DEVICE",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "AI_PPT_VISUAL_QA_MODEL",
  "OPENAI_IMAGE_MODEL",
  "IMAGE_PROVIDER",
  "PUBLIC_IMAGE_PROVIDER",
  "IMAGE_MAX_PER_DECK",
  "IMAGE_MAX_PER_USER_PER_DAY",
  "OPENAI_TRANSCRIPTION_MODEL",
  "OPENAI_EMBEDDING_MODEL",
  "OPENAI_REALTIME_TRANSCRIPTION_MODEL",
  "OPENAI_REALTIME_TRANSCRIPTION_DELAY",
  "OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS",
  "WHISPERX_API_URL",
  "WHISPERX_API_KEY",
  "WHISPERX_MODEL",
  "WHISPERX_TIMEOUT_MS",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "TRANSCRIBE_LANGUAGE_CODE",
  "TEXTRACT_ENABLED",
  "AUTH_COOKIE_SECURE",
  "LOG_LEVEL",
  "LOG_PRETTY",
  "DEMO_USER_ID",
  "DEMO_WORKSPACE_ID",
  "DEMO_PROJECT_ID",
  "DEMO_DECK_ID",
  "DEMO_SESSION_ID",
];

const exampleFiles = [
  ".env.example",
  ".env.staging.example",
  ".env.production.example",
];

const commonAllowedEmptyKeys = [
  "ADAPTIVE_COACHING_PROJECT_ALLOWLIST",
  "AUTH_COOKIE_SECURE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AI_PPT_VISUAL_QA_MODEL",
  "COACHING_IDEMPOTENCY_HMAC_SECRET",
  "COACHING_IDEMPOTENCY_HMAC_PREVIOUS_SECRET",
  "COACHING_IDEMPOTENCY_HMAC_PREVIOUS_KEY_VERSION",
  "DEMO_FIXTURE_ENV_ALLOWLIST",
  "DEMO_AI_DECK_SOURCE_PROJECT_ID",
  "DEMO_AI_DECK_TRIGGER_TOPIC",
  "S3_ENDPOINT",
  "S3_PRIVATE_AUDIO_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "VITE_SEMANTIC_CUE_NLI_BENCHMARK_DEVICE",
  "WHISPERX_API_URL",
  "WHISPERX_API_KEY",
  "WHISPERX_MODEL",
];

const allowedEmptyKeysByFile = new Map([
  [".env.example", new Set([...commonAllowedEmptyKeys, "OPENAI_API_KEY"])],
  [".env.staging.example", new Set(commonAllowedEmptyKeys)],
  [".env.production.example", new Set(commonAllowedEmptyKeys)],
]);

const failures = [];
const envFiles = new Map(
  exampleFiles.map((file) => {
    const result = readEnvFile(file);
    failures.push(...result.failures);
    return [file, result.entries];
  }),
);

for (const [file, entries] of envFiles) {
  const allowedEmptyKeys = allowedEmptyKeysByFile.get(file);

  for (const key of requiredKeys) {
    if (!entries.has(key)) {
      failures.push(`${file} missing env key: ${key}`);
    }
  }

  for (const [key, value] of entries) {
    if (isBlankEnvValue(value) && !allowedEmptyKeys.has(key)) {
      failures.push(`${file} has an empty required env value: ${key}`);
    }
  }
}

const localKeys = new Set(envFiles.get(".env.example").keys());
for (const file of exampleFiles.slice(1)) {
  const keys = new Set(envFiles.get(file).keys());

  for (const key of localKeys) {
    if (!keys.has(key)) {
      failures.push(`${file} does not match .env.example: missing ${key}`);
    }
  }

  for (const key of keys) {
    if (!localKeys.has(key)) {
      failures.push(`${file} does not match .env.example: extra ${key}`);
    }
  }
}

const personalStagingPolicyFile = "infra/env/personal-staging-env-policy.json";

try {
  const policy = readPersonalStagingPolicy(personalStagingPolicyFile);
  const composeKeys = collectComposeEnvironmentKeys([
    "docker-compose.yml",
    "docker-compose.staging.yml",
  ]);

  failures.push(
    ...validatePersonalStagingPolicy({
      stagingEntries: envFiles.get(".env.staging.example"),
      policy,
      composeKeys,
      policyFile: personalStagingPolicyFile,
    }),
  );
} catch {
  failures.push(`${personalStagingPolicyFile} is not valid JSON`);
}

if (failures.length > 0) {
  console.error("Environment contract validation failed:");
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Environment contract validation passed.");
