import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildMixedManifest } from "./lib/mixed-manifest.js";
import { buildMixedProfile } from "./lib/mixed-profile.js";
import { redactMixedDiagnostic } from "./lib/mixed-redaction.js";

const loadRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(loadRoot, "../..");
const profileName = process.argv[2];
const startedAt = new Date().toISOString();
const runId = process.env.RUN_ID || createRunId(profileName);
validateRunId(runId);
const resultsDirectory = path.join(repositoryRoot, "results", runId);
let temporaryDirectory;
let failure;
let resourceResult = emptyResourceResult();

try {
  const profile = buildMixedProfile(profileName, process.env);
  await mkdir(resultsDirectory, { recursive: true });
  await preflight(profile.baseUrl);

  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "orbit-mixed-"));
  const fakeAudioPath = path.join(temporaryDirectory, "fake-microphone.wav");
  const activityRuntimePath = path.join(
    temporaryDirectory,
    "activity-runtime.json",
  );
  const k6RuntimePath = path.join(temporaryDirectory, "k6-runtime.json");
  await writeFile(fakeAudioPath, createFakeMicrophoneWav(), { mode: 0o600 });

  const exitCode = await runPlaywright({
    activityRuntimePath,
    fakeAudioPath,
    k6RuntimePath,
    profileName: profile.profile,
    resultsDirectory,
    runId,
  });
  if (exitCode !== 0) {
    throw new Error(
      `Mixed Playwright lifecycle failed with exit code ${exitCode}.`,
    );
  }
  resourceResult = await readResourceResult(resultsDirectory);
} catch (cause) {
  failure = cause instanceof Error ? cause : new Error(String(cause));
  await mkdir(resultsDirectory, { recursive: true });
  const diagnostic = redactMixedDiagnostic(
    {
      at: new Date().toISOString(),
      message: failure.message,
      name: failure.name,
    },
    secretValues(),
  );
  await writeFile(
    path.join(resultsDirectory, "failure.json"),
    `${JSON.stringify(diagnostic, null, 2)}\n`,
  );
  resourceResult.results.push("failure.json");
} finally {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
  const resourcesPath = path.join(resultsDirectory, "resources.json");
  await unlink(resourcesPath).catch(() => undefined);
  const manifest = buildMixedManifest({
    baseUrl: new URL(process.env.BASE_URL || "http://invalid.local").origin,
    endedAt: new Date().toISOString(),
    gitSha: readGitSha(),
    profile: profileName,
    resources: resourceResult.resources,
    results: unique(resourceResult.results),
    runId,
    startedAt,
  });
  await writeFile(
    path.join(resultsDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

if (failure) {
  console.error(`혼합 테스트를 완료하지 못했습니다. 결과: ${resultsDirectory}`);
  process.exitCode = 1;
} else {
  console.log(`혼합 테스트 결과: ${resultsDirectory}`);
}

async function preflight(baseUrl) {
  await stat(
    path.join(
      repositoryRoot,
      "services/python-worker/tests/fixtures/pptx/import-fidelity-notes.pptx",
    ),
  );
  preflightTool("k6", ["version"]);
  preflightTool(process.execPath, [
    path.join(loadRoot, "node_modules/artillery/bin/run"),
    "--version",
  ]);
  preflightTool("pnpm", ["exec", "playwright", "--version"]);

  await requireHealthy(new URL("/health", baseUrl), "Orbit API");
  await requireHealthy(
    healthUrl(process.env.ARTILLERY_PUSHGATEWAY_URL),
    "Artillery Pushgateway",
  );
  await requireHealthy(
    healthUrl(process.env.K6_PROMETHEUS_RW_SERVER_URL),
    "Prometheus remote write",
  );
}

function preflightTool(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`${path.basename(command)} tool preflight failed.`);
  }
}

async function requireHealthy(url, label) {
  const response = await fetch(url, {
    headers: {
      "x-orbit-load-test-token": process.env.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN,
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`${label} health check failed.`);
}

function healthUrl(value) {
  const url = new URL(value);
  url.pathname = "/-/healthy";
  url.search = "";
  return url;
}

function runPlaywright(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config",
        path.join(loadRoot, "playwright.mixed.config.ts"),
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          K6_PROMETHEUS_RW_STALE_MARKERS: "true",
          K6_PROMETHEUS_RW_TREND_STATS: "p(50),p(95),p(99),max",
          MIXED_ACTIVITY_RUNTIME_PATH: input.activityRuntimePath,
          MIXED_FAKE_AUDIO_PATH: input.fakeAudioPath,
          MIXED_K6_RUNTIME_PATH: input.k6RuntimePath,
          MIXED_PROFILE: input.profileName,
          MIXED_RESULTS_DIR: input.resultsDirectory,
          RUN_ID: input.runId,
          RUN_MIXED_LIFECYCLE: "true",
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Playwright interrupted by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function readResourceResult(directory) {
  const filePath = path.join(directory, "resources.json");
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  const resources = {};
  for (const key of [
    "activityIds",
    "jobIds",
    "projectIds",
    "runIds",
    "sessionIds",
  ]) {
    resources[key] = stringArray(parsed.resources?.[key]);
  }
  return { resources, results: stringArray(parsed.results) };
}

function emptyResourceResult() {
  return {
    resources: {
      activityIds: [],
      jobIds: [],
      projectIds: [],
      runIds: [],
      sessionIds: [],
    },
    results: [],
  };
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.length > 0)
    : [];
}

function createRunId(profile) {
  if (profile !== "smoke" && profile !== "average") {
    throw new Error("Expected mixed profile smoke or average.");
  }
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-mixed-${profile}`;
}

function validateRunId(value) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(value)) {
    throw new Error(
      "RUN_ID must contain only letters, digits, dot, dash, or underscore.",
    );
  }
}

function readGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Git SHA preflight failed.");
  return result.stdout.trim();
}

function createFakeMicrophoneWav() {
  const sampleRate = 16_000;
  const durationSeconds = 10;
  const dataLength = sampleRate * durationSeconds * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < sampleRate * durationSeconds; index += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 4_000,
    );
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
}

function secretValues() {
  return [
    process.env.MIXED_TEST_EMAIL,
    process.env.MIXED_TEST_PASSWORD,
    process.env.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN,
    "4826",
  ].filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}
