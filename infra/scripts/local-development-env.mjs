import { spawn } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  decodeEnvValue,
  parseEnvFileContent,
} from "./personal-staging-env.mjs";

const requiredKeys = [
  "NODE_ENV",
  "APP_ENV",
  "WEB_PORT",
  "API_PORT",
  "PYTHON_WORKER_PORT",
  "WEB_ORIGIN",
  "API_BASE_URL",
  "PYTHON_WORKER_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "PRIVATE_EVIDENCE_REDIS_URL",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
];

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function mergeLocalDevelopmentEnv(inheritedEnv, fileEntries) {
  const decodedEntries = Object.fromEntries(
    [...fileEntries].map(([key, rawValue]) => [key, decodeEnvValue(rawValue)]),
  );

  return { ...inheritedEnv, ...decodedEntries };
}

export function validateLocalDevelopmentEnv(env) {
  const failures = [];

  for (const key of requiredKeys) {
    if (!env[key]?.trim()) {
      failures.push(`${key} is required for local development`);
    }
  }

  if (env.APP_ENV && env.APP_ENV !== "local") {
    failures.push("APP_ENV must be local for local development");
  }

  if (env.NODE_ENV && env.NODE_ENV !== "development") {
    failures.push("NODE_ENV must be development for local development");
  }

  validateFixedTarget(failures, env.DATABASE_URL, {
    key: "DATABASE_URL",
    protocols: ["postgres:", "postgresql:"],
    port: 5432,
    service: "PostgreSQL",
  });
  validateFixedTarget(failures, env.REDIS_URL, {
    key: "REDIS_URL",
    protocols: ["redis:"],
    port: 6379,
    service: "Redis",
  });
  validateFixedTarget(failures, env.PRIVATE_EVIDENCE_REDIS_URL, {
    key: "PRIVATE_EVIDENCE_REDIS_URL",
    protocols: ["redis:"],
    port: 6380,
    service: "Redis",
  });
  validateFixedTarget(failures, env.S3_ENDPOINT, {
    key: "S3_ENDPOINT",
    protocols: ["http:"],
    port: 9000,
    service: "MinIO",
  });
  validateFixedTarget(failures, env.S3_PUBLIC_ENDPOINT, {
    key: "S3_PUBLIC_ENDPOINT",
    protocols: ["http:"],
    port: 9000,
    service: "MinIO",
  });

  validateDeclaredPortTarget(failures, env.WEB_ORIGIN, env.WEB_PORT, {
    key: "WEB_ORIGIN",
    portKey: "WEB_PORT",
    service: "Web",
  });
  validateDeclaredPortTarget(failures, env.API_BASE_URL, env.API_PORT, {
    key: "API_BASE_URL",
    portKey: "API_PORT",
    service: "API",
  });
  validateDeclaredPortTarget(
    failures,
    env.PYTHON_WORKER_URL,
    env.PYTHON_WORKER_PORT,
    {
      key: "PYTHON_WORKER_URL",
      portKey: "PYTHON_WORKER_PORT",
      service: "Python worker",
    },
  );

  if (
    env.REDIS_URL &&
    env.PRIVATE_EVIDENCE_REDIS_URL &&
    normalizeUrl(env.REDIS_URL) === normalizeUrl(env.PRIVATE_EVIDENCE_REDIS_URL)
  ) {
    failures.push(
      "PRIVATE_EVIDENCE_REDIS_URL must use a separate Redis instance",
    );
  }

  return failures;
}

function validateFixedTarget(failures, value, options) {
  if (!value) return;

  const parsed = parseUrl(value);
  if (
    !parsed ||
    !options.protocols.includes(parsed.protocol) ||
    !loopbackHosts.has(parsed.hostname) ||
    Number(parsed.port) !== options.port
  ) {
    failures.push(
      `${options.key} must target local ${options.service} on port ${options.port}`,
    );
  }
}

function validateDeclaredPortTarget(failures, value, declaredPort, options) {
  if (!value || !declaredPort) return;

  const port = Number(declaredPort);
  const parsed = parseUrl(value);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !parsed ||
    parsed.protocol !== "http:" ||
    !loopbackHosts.has(parsed.hostname) ||
    Number(parsed.port) !== port
  ) {
    failures.push(
      `${options.key} must target local ${options.service} on ${options.portKey}`,
    );
  }
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  return parseUrl(value)?.href ?? null;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) {
    return {
      env: null,
      failures: [`local environment file not found: ${file}`],
    };
  }

  const parsed = parseEnvFileContent(fs.readFileSync(file, "utf8"), file);
  return {
    env: mergeLocalDevelopmentEnv(process.env, parsed.entries),
    failures: parsed.failures,
  };
}

function parseArguments(args) {
  if (args[0] !== "--env-file" || !args[1]) {
    throw new Error(
      "usage: local-development-env.mjs --env-file <path> [--check | -- <command> ...]",
    );
  }

  const remainder = args.slice(2);
  if (remainder.length === 0 || remainder[0] === "--check") {
    return { envFile: args[1], command: null, commandArgs: [] };
  }

  if (remainder[0] !== "--" || !remainder[1]) {
    throw new Error(
      "usage: local-development-env.mjs --env-file <path> [--check | -- <command> ...]",
    );
  }

  return {
    envFile: args[1],
    command: remainder[1],
    commandArgs: remainder.slice(2),
  };
}

async function runCli() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const loaded = loadEnvFile(options.envFile);
  const failures = [
    ...loaded.failures,
    ...(loaded.env ? validateLocalDevelopmentEnv(loaded.env) : []),
  ];

  if (failures.length > 0) {
    console.error("Local development environment validation failed:");
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    console.error(
      "Compare the affected keys with .env.example. No values were changed.",
    );
    process.exitCode = 1;
    return;
  }

  if (!options.command) {
    console.log("Local development environment validation passed.");
    return;
  }

  await runCommand(options.command, options.commandArgs, loaded.env);
}

function runCommand(command, args, env) {
  return new Promise((resolve) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, args, {
      detached,
      env,
      stdio: "inherit",
    });

    const forwardSignal = (signal) => {
      try {
        if (detached && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };

    process.once("SIGINT", () => forwardSignal("SIGINT"));
    process.once("SIGTERM", () => forwardSignal("SIGTERM"));

    child.once("error", (error) => {
      console.error(
        `Failed to start local development command: ${error.message}`,
      );
      process.exitCode = 1;
      resolve();
    });
    child.once("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
      resolve();
    });
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runCli();
}
