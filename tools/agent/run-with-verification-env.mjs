#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createVerificationEnvironment } from "./verification-env.mjs";

export function runWithVerificationEnvironment(argv, options = {}) {
  if (argv.length === 0) {
    throw new Error("실행할 명령이 필요합니다.");
  }
  const root = resolve(options.root ?? process.cwd());
  const environment = createVerificationEnvironment(
    root,
    options.environment ?? process.env,
  );
  const runner =
    options.runner ??
    ((command, args) =>
      spawnSync(command, args, {
        cwd: root,
        env: environment,
        stdio: "inherit",
      }));
  const result = runner(argv[0], argv.slice(1), environment);
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  try {
    process.exitCode = runWithVerificationEnvironment(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
