import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeLocalDevelopmentEnv,
  validateLocalDevelopmentEnv,
} from "./local-development-env.mjs";

const validLocalEnv = {
  NODE_ENV: "development",
  APP_ENV: "local",
  WEB_PORT: "5173",
  API_PORT: "3000",
  PYTHON_WORKER_PORT: "8000",
  WEB_ORIGIN: "http://localhost:5173",
  API_BASE_URL: "http://localhost:3000",
  PYTHON_WORKER_URL: "http://localhost:8000",
  DATABASE_URL: "postgres://orbit:orbit@localhost:5432/orbit",
  REDIS_URL: "redis://localhost:6379",
  PRIVATE_EVIDENCE_REDIS_URL: "redis://localhost:6380",
  S3_ENDPOINT: "http://localhost:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
};

test("local development environment accepts the hybrid localhost topology", () => {
  assert.deepEqual(validateLocalDevelopmentEnv(validLocalEnv), []);
});

test("local development environment rejects missing connection variables", () => {
  const env = { ...validLocalEnv };
  delete env.DATABASE_URL;

  assert.deepEqual(validateLocalDevelopmentEnv(env), [
    "DATABASE_URL is required for local development",
  ]);
});

test("local development environment rejects non-local app environments", () => {
  const failures = validateLocalDevelopmentEnv({
    ...validLocalEnv,
    APP_ENV: "staging",
  });

  assert.deepEqual(failures, ["APP_ENV must be local for local development"]);
});

test("local development environment rejects remote database hosts", () => {
  const failures = validateLocalDevelopmentEnv({
    ...validLocalEnv,
    DATABASE_URL: "postgres://user:secret@staging-rds.example.com:5432/orbit",
  });

  assert.deepEqual(failures, [
    "DATABASE_URL must target local PostgreSQL on port 5432",
  ]);
});

test("local development environment requires separate Redis instances", () => {
  const failures = validateLocalDevelopmentEnv({
    ...validLocalEnv,
    PRIVATE_EVIDENCE_REDIS_URL: validLocalEnv.REDIS_URL,
  });

  assert.deepEqual(failures, [
    "PRIVATE_EVIDENCE_REDIS_URL must target local Redis on port 6380",
    "PRIVATE_EVIDENCE_REDIS_URL must use a separate Redis instance",
  ]);
});

test("validation failures never expose credentials or complete URLs", () => {
  const secret = "do-not-print-this";
  const failures = validateLocalDevelopmentEnv({
    ...validLocalEnv,
    DATABASE_URL: `postgres://user:${secret}@remote.example.com:5432/orbit`,
  });
  const output = failures.join("\n");

  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /remote\.example\.com/);
  assert.doesNotMatch(output, /postgres:\/\//);
});

test("env-file values override inherited shell values", () => {
  assert.deepEqual(
    mergeLocalDevelopmentEnv(
      { DATABASE_URL: "postgres://shell.example.com/orbit", PATH: "/bin" },
      new Map([
        ["DATABASE_URL", "postgres://localhost:5432/orbit"],
        ["APP_ENV", "local"],
      ]),
    ),
    {
      DATABASE_URL: "postgres://localhost:5432/orbit",
      PATH: "/bin",
      APP_ENV: "local",
    },
  );
});
