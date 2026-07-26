#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BENCHMARK_TASKS } from "./benchmark.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const TOKEN_KEYS = {
  inputTokens: ["input_tokens", "inputTokens"],
  cachedInputTokens: ["cached_input_tokens", "cachedInputTokens"],
  outputTokens: ["output_tokens", "outputTokens"],
  reasoningTokens: [
    "reasoning_tokens",
    "reasoningTokens",
    "reasoning_output_tokens",
  ],
};

function visit(value, callback) {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, callback));
    return;
  }
  if (value && typeof value === "object") {
    callback(value);
    Object.values(value).forEach((item) => visit(item, callback));
  }
}

export function parseCodexJsonl(output) {
  const events = output
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const usage = Object.fromEntries(
    Object.keys(TOKEN_KEYS).map((key) => [key, 0]),
  );
  const commands = [];

  for (const event of events) {
    visit(event, (object) => {
      for (const [metric, aliases] of Object.entries(TOKEN_KEYS)) {
        for (const alias of aliases) {
          if (Number.isFinite(object[alias])) {
            usage[metric] = Math.max(usage[metric], object[alias]);
          }
        }
      }
    });
    if (
      event.type === "item.completed" &&
      event.item?.type === "command_execution"
    ) {
      commands.push(event.item.command ?? "");
    }
  }

  const firstPatchIndex = commands.findIndex((command) =>
    /(?:apply_patch|git apply|patch\s+-p)/.test(command),
  );
  const beforePatch =
    firstPatchIndex === -1 ? commands : commands.slice(0, firstPatchIndex);
  const pathPattern =
    /(?:apps|packages|services|tools|docs)\/[A-Za-z0-9_./-]+/g;
  const filesRead = new Set(
    beforePatch.flatMap((command) => command.match(pathPattern) ?? []),
  );
  const topLevelAreas = new Set(
    [...filesRead].map((path) => path.split("/")[0]),
  );
  const testCommands = commands.filter((command) =>
    /(?:\btest\b|pytest|vitest|node --test)/.test(command),
  );
  const verifiedWorkspaces = new Set(
    testCommands.flatMap((command) => {
      const areas = [];
      if (command.includes("@orbit/web")) areas.push("web");
      if (command.includes("@orbit/api")) areas.push("api");
      if (command.includes("@orbit/worker")) areas.push("worker");
      if (command.includes("@orbit/shared")) areas.push("shared");
      if (command.includes("services/python-worker")) areas.push("python");
      return areas;
    }),
  );

  return {
    usage,
    metrics: {
      filesReadBeforeFirstPatch: filesRead.size,
      searchCallsBeforeFirstPatch: beforePatch.filter((command) =>
        /(?:^|\s)(?:rg|find|git grep)(?:\s|$)/.test(command),
      ).length,
      toolCallsBeforeFirstTargetedTest:
        commands.findIndex((command) =>
          /(?:\btest\b|pytest|vitest|node --test)/.test(command),
        ) + 1,
      topLevelAreasRead: [...topLevelAreas].sort(),
      workspacesVerified: [...verifiedWorkspaces].sort(),
      rollbackCount: commands.filter((command) =>
        /git (?:reset|checkout --|revert)/.test(command),
      ).length,
      commandCalls: commands.length,
    },
  };
}

function parseArguments(argv) {
  const options = {
    model: null,
    output: null,
    ref: "HEAD",
    runs: 1,
    tasks: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") {
      options.tasks = BENCHMARK_TASKS.map((task) => task.id);
    } else if (argument === "--model") {
      options.model = argv[++index];
    } else if (argument === "--output") {
      options.output = argv[++index];
    } else if (argument === "--ref") {
      options.ref = argv[++index];
    } else if (argument === "--runs") {
      options.runs = Number(argv[++index]);
    } else if (argument === "--task") {
      options.tasks.push(argv[++index]);
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    }
  }
  if (options.tasks.length === 0 || !options.output) {
    throw new Error(
      "사용법: agent:benchmark:codex (--all|--task <id>) --output <json> " +
        "[--runs <n>] [--ref <git-ref>] [--model <model>]",
    );
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 3) {
    throw new Error("--runs는 1부터 3 사이의 정수여야 합니다.");
  }
  return options;
}

function runTask(task, options, runNumber) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "orbit-codex-benchmark-"));
  const worktree = join(temporaryRoot, "worktree");
  const taskFile = resolve(repositoryRoot, task.taskFile);
  if (!existsSync(taskFile)) {
    throw new Error(`benchmark task 파일이 없습니다: ${task.taskFile}`);
  }
  try {
    execFileSync(
      "git",
      ["worktree", "add", "--detach", worktree, options.ref],
      {
        cwd: repositoryRoot,
        stdio: "ignore",
      },
    );
    const prompt = [
      readFileSync(taskFile, "utf8").trim(),
      "",
      "규칙:",
      "- 대상 worktree 안에서만 수정한다.",
      "- commit, push, PR, 외부 서비스 변경을 하지 않는다.",
      "- 가장 좁은 관련 테스트를 실행한다.",
      "- 완료 결과는 간결하게 보고한다.",
    ].join("\n");
    const argv = [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--cd",
      worktree,
    ];
    if (options.model) {
      argv.push("--model", options.model);
    }
    argv.push(prompt);
    const startedAt = Date.now();
    const result = spawnSync("codex", argv, {
      cwd: worktree,
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    });
    const parsed = parseCodexJsonl(result.stdout ?? "");
    return {
      run: runNumber,
      status: result.status === 0 ? "succeeded" : "failed",
      exitCode: result.status,
      seconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
      ...parsed,
    };
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktree], {
        cwd: repositoryRoot,
        stdio: "ignore",
      });
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }
}

function run() {
  const options = parseArguments(process.argv.slice(2));
  const selectedTasks = options.tasks.map((id) => {
    const task = BENCHMARK_TASKS.find((candidate) => candidate.id === id);
    if (!task) {
      throw new Error(`알 수 없는 benchmark task입니다: ${id}`);
    }
    return task;
  });
  const results = [];
  for (const task of selectedTasks) {
    const runs = [];
    for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
      runs.push(runTask(task, options, runNumber));
    }
    results.push({
      id: task.id,
      description: task.description,
      path: task.path,
      runs,
    });
  }
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    ref: options.ref,
    model: options.model ?? "default",
    tasks: results,
  };
  writeFileSync(
    resolve(repositoryRoot, options.output),
    `${JSON.stringify(output, null, 2)}\n`,
  );
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
