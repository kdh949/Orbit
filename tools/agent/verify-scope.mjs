#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadDomainCatalog } from "./context.mjs";
import { createVerificationEnvironment } from "./verification-env.mjs";

const DEFAULT_DOMAIN_DIRECTORY = "docs/agent/domains";
const AREA_PACKAGE_NAMES = {
  api: "api",
  core: "editor-core",
  web: "web",
  worker: "worker",
};

export function parseVerificationScope(value) {
  const [area, domain, ...remainder] = value.split(":");
  if (!area || !domain || remainder.length > 0) {
    throw new Error(`scope는 <area>:<domain> 형식이어야 합니다: ${value}`);
  }
  return { area, domain };
}

function manifestNames(manifest) {
  const aliases = Array.isArray(manifest.aliases) ? manifest.aliases : [];
  return [manifest.id, ...aliases];
}

export function resolveVerificationScope(catalog, value) {
  const { area, domain } = parseVerificationScope(value);
  const manifest = catalog.find((candidate) =>
    manifestNames(candidate).includes(domain),
  );
  if (!manifest) {
    throw new Error(
      `알 수 없는 domain입니다: ${domain}. 사용 가능: ${catalog
        .flatMap(manifestNames)
        .sort()
        .join(", ")}`,
    );
  }

  let commands;
  if (area === "python") {
    commands = manifest.fastChecks.filter((command) =>
      command.startsWith("cd services/python-worker && "),
    );
  } else {
    const packageName = AREA_PACKAGE_NAMES[area];
    if (!packageName) {
      throw new Error(`지원하지 않는 area입니다: ${area}`);
    }
    const filter = `--filter=@orbit/${packageName}`;
    commands = manifest.fastChecks.filter((command) =>
      command.includes(filter),
    );
  }

  if (commands.length === 0) {
    throw new Error(`${value}에 등록된 fast check가 없습니다.`);
  }

  return {
    requestedScope: value,
    resolvedScope: `${area}:${manifest.id}`,
    manifest,
    commands,
  };
}

export function renderVerificationPlan(plan) {
  const lines = [
    `[verify:scope] requested=${plan.requestedScope} resolved=${plan.resolvedScope}`,
  ];
  for (const [index, command] of plan.commands.entries()) {
    lines.push(`${index + 1}. ${command}`);
  }
  return `${lines.join("\n")}\n`;
}

export function executeVerificationCommands(plan, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const environment = createVerificationEnvironment(
    root,
    options.environment ?? process.env,
  );
  const runner =
    options.runner ??
    ((command) =>
      spawnSync("/bin/sh", ["-c", command], {
        cwd: root,
        env: environment,
        stdio: "inherit",
      }));

  for (const command of plan.commands) {
    const result = runner(command);
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
}

function parseArguments(argv) {
  const options = {
    dryRun: false,
    root: process.cwd(),
    domainDirectory: DEFAULT_DOMAIN_DIRECTORY,
    scope: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--root") {
      if (!argv[index + 1]) {
        throw new Error("--root 다음에 repository 경로가 필요합니다.");
      }
      options.root = argv[index + 1];
      index += 1;
    } else if (argument === "--domain-dir") {
      if (!argv[index + 1]) {
        throw new Error("--domain-dir 다음에 manifest 경로가 필요합니다.");
      }
      options.domainDirectory = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    } else if (options.scope === null) {
      options.scope = argument;
    } else {
      throw new Error(`scope는 하나만 지정할 수 있습니다: ${argument}`);
    }
  }

  if (options.scope === null) {
    throw new Error("scope를 <area>:<domain> 형식으로 지정해야 합니다.");
  }
  return options;
}

function run() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const catalog = loadDomainCatalog(options.root, {
      domainDirectory: options.domainDirectory,
    });
    const plan = resolveVerificationScope(catalog, options.scope);
    process.stdout.write(renderVerificationPlan(plan));
    if (!options.dryRun) {
      process.exitCode = executeVerificationCommands(plan, {
        root: options.root,
      });
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
