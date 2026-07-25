import {
  appEnvSchema,
  defaultRehearsalAudioMaxBytes,
  jobQueueDriverSchema,
  liveSttProviderSchema,
  llmProviderSchema,
  nodeEnvSchema,
  ocrProviderSchema,
  openAiModelDefaults,
  openAiRealtimeTranscriptionDelaySchema,
  openAiRehearsalAudioMaxBytes,
  reportSttProviderSchema,
  storageDriverSchema
} from "@orbit/shared";
import { ZodError, z } from "zod";

const booleanStringSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return value;
}, z.boolean());

const optionalBooleanStringSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return value;
}, z.boolean().optional());

const requiredString = (name: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z
      .string({ required_error: `${name} is required` })
      .min(1, `${name} is required`)
  );

const defaultedString = (defaultValue: string) =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value ?? defaultValue;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? defaultValue : trimmed;
  }, z.string().min(1));

const optionalString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).optional());

const requiredUrl = (name: string) =>
  requiredString(name).pipe(z.string().url(`${name} must be a valid URL`));

const optionalUrl = (name: string) =>
  optionalString.pipe(
    z
      .string()
      .refine(isValidAbsoluteUrl, `${name} must be a valid URL`)
      .optional()
  );

const isValidAbsoluteUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
};

const usesHttpProtocol = (url: string): boolean => new URL(url).protocol === "http:";

const requiredPort = (name: string) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") {
        return undefined;
      }

      return Number(value);
    },
    z.number({ required_error: `${name} is required` }).int().min(1).max(65535)
  );

const optionalPositiveInteger = (name: string, defaultValue: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") {
        return defaultValue;
      }

      return Number(value);
    },
    z
      .number({ invalid_type_error: `${name}은 양의 정수여야 합니다.` })
      .int(`${name}은 양의 정수여야 합니다.`)
      .positive(`${name}은 양의 정수여야 합니다.`)
  );

const optionalIntegerInRange = (
  name: string,
  defaultValue: number,
  min: number,
  max: number
) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") {
        return defaultValue;
      }

      return Number(value);
    },
    z
      .number({ invalid_type_error: `${name}은 정수여야 합니다.` })
      .int(`${name}은 정수여야 합니다.`)
      .min(min, `${name}은 ${min} 이상이어야 합니다.`)
      .max(max, `${name}은 ${max} 이하여야 합니다.`)
  );

const remoteEnvValues = ["staging", "production"] as const;
const remoteEnvSet = new Set<string>(remoteEnvValues);
const logLevelSchema = z
  .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
  .default("info");

const localDefaults = {
  WEB_ORIGIN: "http://localhost:5173",
  API_BASE_URL: "http://localhost:3000",
  PYTHON_WORKER_URL: "http://localhost:8000",
  DATABASE_URL: "postgres://orbit:orbit@localhost:5432/orbit",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "local-session-secret-change-me",
  COOKIE_SECRET: "local-cookie-secret-change-me",
  S3_ENDPOINT: "http://localhost:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "orbit-local"
} as const;

export const orbitEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  APP_ENV: appEnvSchema,
  WEB_PORT: requiredPort("WEB_PORT"),
  API_PORT: requiredPort("API_PORT"),
  WORKER_PORT: requiredPort("WORKER_PORT"),
  PYTHON_WORKER_PORT: requiredPort("PYTHON_WORKER_PORT"),
  WEB_ORIGIN: requiredUrl("WEB_ORIGIN"),
  API_BASE_URL: requiredUrl("API_BASE_URL"),
  PYTHON_WORKER_URL: requiredUrl("PYTHON_WORKER_URL"),
  DATABASE_URL: requiredString("DATABASE_URL"),
  REDIS_URL: requiredString("REDIS_URL"),
  SESSION_SECRET: requiredString("SESSION_SECRET").pipe(
    z.string().min(16, "SESSION_SECRET must be at least 16 characters")
  ),
  COOKIE_SECRET: requiredString("COOKIE_SECRET").pipe(
    z.string().min(16, "COOKIE_SECRET must be at least 16 characters")
  ),
  STORAGE_DRIVER: storageDriverSchema,
  S3_ENDPOINT: optionalString,
  S3_PUBLIC_ENDPOINT: optionalString,
  S3_BUCKET: requiredString("S3_BUCKET"),
  S3_REGION: requiredString("S3_REGION"),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: booleanStringSchema.default(true),
  JOB_QUEUE_DRIVER: jobQueueDriverSchema,
  LIVE_STT_PROVIDER: liveSttProviderSchema,
  REPORT_STT_PROVIDER: reportSttProviderSchema,
  REHEARSAL_AUDIO_MAX_BYTES: optionalPositiveInteger(
    "REHEARSAL_AUDIO_MAX_BYTES",
    defaultRehearsalAudioMaxBytes
  ),
  OCR_PROVIDER: ocrProviderSchema,
  LLM_PROVIDER: llmProviderSchema,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: requiredString("OPENAI_MODEL"),
  OPENAI_TRANSCRIPTION_MODEL: requiredString("OPENAI_TRANSCRIPTION_MODEL"),
  OPENAI_EMBEDDING_MODEL: requiredString("OPENAI_EMBEDDING_MODEL"),
  OPENAI_REALTIME_TRANSCRIPTION_MODEL: defaultedString(
    openAiModelDefaults.realtimeTranscriptionModel
  ),
  OPENAI_REALTIME_TRANSCRIPTION_DELAY:
    openAiRealtimeTranscriptionDelaySchema.default(
      openAiModelDefaults.realtimeTranscriptionDelay
    ),
  OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS: optionalIntegerInRange(
    "OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS",
    openAiModelDefaults.realtimeClientSecretTtlSeconds,
    10,
    7200
  ),
  WHISPERX_API_URL: optionalUrl("WHISPERX_API_URL"),
  WHISPERX_API_KEY: optionalString,
  WHISPERX_MODEL: optionalString,
  WHISPERX_TIMEOUT_MS: optionalPositiveInteger("WHISPERX_TIMEOUT_MS", 30000),
  AWS_REGION: requiredString("AWS_REGION"),
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  TRANSCRIBE_LANGUAGE_CODE: requiredString("TRANSCRIBE_LANGUAGE_CODE"),
  TEXTRACT_ENABLED: booleanStringSchema.default(false),
  AUTH_COOKIE_SECURE: optionalBooleanStringSchema,
  LOG_LEVEL: logLevelSchema,
  LOG_PRETTY: booleanStringSchema.default(false),
  DEMO_USER_ID: requiredString("DEMO_USER_ID"),
  DEMO_WORKSPACE_ID: requiredString("DEMO_WORKSPACE_ID"),
  DEMO_PROJECT_ID: requiredString("DEMO_PROJECT_ID"),
  DEMO_DECK_ID: requiredString("DEMO_DECK_ID"),
  DEMO_SESSION_ID: requiredString("DEMO_SESSION_ID")
}).superRefine((value, context) => {
  if (value.STORAGE_DRIVER === "minio") {
    for (const key of [
      "S3_ENDPOINT",
      "S3_PUBLIC_ENDPOINT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY"
    ] as const) {
      if (!value[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when STORAGE_DRIVER=minio`
        });
      }
    }
  }

  if (remoteEnvSet.has(value.APP_ENV)) {
    for (const [key, localValue] of Object.entries(localDefaults)) {
      const configKey = key as keyof typeof localDefaults;
      if (value[configKey] === localValue) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must not use the local default in ${value.APP_ENV}`
        });
      }
    }

    if (!value.OPENAI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: `OPENAI_API_KEY is required in ${value.APP_ENV}`
      });
    }
  }

  if (value.LOG_PRETTY && value.NODE_ENV !== "development") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LOG_PRETTY"],
      message: "LOG_PRETTY can only be true when NODE_ENV=development"
    });
  }

  if (value.REPORT_STT_PROVIDER === "whisperx") {
    for (const key of [
      "WHISPERX_API_URL",
      "WHISPERX_API_KEY",
      "WHISPERX_MODEL"
    ] as const) {
      if (!value[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when REPORT_STT_PROVIDER=whisperx`
        });
      }
    }
  }

  if (
    value.REPORT_STT_PROVIDER === "openai" &&
    value.REHEARSAL_AUDIO_MAX_BYTES > openAiRehearsalAudioMaxBytes
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["REHEARSAL_AUDIO_MAX_BYTES"],
      message:
        "REPORT_STT_PROVIDER=openai일 때 REHEARSAL_AUDIO_MAX_BYTES는 25000000 이하여야 합니다."
    });
  }

  if (value.APP_ENV === "production" && value.AUTH_COOKIE_SECURE === false) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_COOKIE_SECURE"],
      message: "AUTH_COOKIE_SECURE cannot be false in production"
    });
  }

  if (
    value.APP_ENV === "staging" &&
    value.AUTH_COOKIE_SECURE === false &&
    (!usesHttpProtocol(value.WEB_ORIGIN) || !usesHttpProtocol(value.API_BASE_URL))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_COOKIE_SECURE"],
      message:
        "AUTH_COOKIE_SECURE=false is only allowed when WEB_ORIGIN and API_BASE_URL use http in staging"
    });
  }
});

export type OrbitConfig = z.infer<typeof orbitEnvSchema>;

export interface LoadOrbitConfigOptions {
  service?: "api" | "worker" | "web" | "shared";
}

export class OrbitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrbitConfigError";
  }
}

export function loadOrbitConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadOrbitConfigOptions = {}
): OrbitConfig {
  const result = orbitEnvSchema.safeParse(env);

  if (!result.success) {
    throw new OrbitConfigError(formatOrbitConfigError(result.error, options));
  }

  return result.data;
}

export function formatOrbitConfigError(
  error: ZodError,
  options: LoadOrbitConfigOptions = {}
): string {
  const service = options.service ?? "shared";
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".") || "env";
    return `- ${path}: ${issue.message}`;
  });

  return [
    `Invalid ORBIT environment for ${service}.`,
    "Fix the variables below or copy .env.example to .env.local for local development.",
    ...lines
  ].join("\n");
}
