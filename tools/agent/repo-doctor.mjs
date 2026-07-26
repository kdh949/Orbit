#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "docs/agent/repository-truth.json";
const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*]\(([^)]+)\)/g;
const WORKFLOW_REFERENCE_PATTERN =
  /(?:actions\/workflows\/|\.github\/workflows\/)([A-Za-z0-9._-]+\.ya?ml)/g;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function listMarkdownFiles(rootPath) {
  if (!existsSync(rootPath)) {
    return [];
  }

  const entries = readdirSync(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function normalizeMarkdownTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<") && trimmed.includes(">")) {
    return trimmed.slice(1, trimmed.indexOf(">"));
  }

  const titleSeparator = trimmed.search(/\s+["']/);
  return titleSeparator === -1 ? trimmed : trimmed.slice(0, titleSeparator);
}

function resolveMarkdownTarget(root, documentPath, rawTarget) {
  const target = normalizeMarkdownTarget(rawTarget);
  if (
    target.length === 0 ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    URI_SCHEME_PATTERN.test(target)
  ) {
    return null;
  }

  const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  if (withoutFragment.length === 0) {
    return null;
  }

  let decodedTarget;
  try {
    decodedTarget = decodeURIComponent(withoutFragment);
  } catch {
    decodedTarget = withoutFragment;
  }

  if (isAbsolute(decodedTarget)) {
    return resolve(root, `.${decodedTarget}`);
  }

  return resolve(dirname(documentPath), decodedTarget);
}

function extractWorkflowReferences(content) {
  const references = new Set();
  for (const match of content.matchAll(WORKFLOW_REFERENCE_PATTERN)) {
    references.add(match[1]);
  }
  return [...references];
}

function validateConfig(config, configFile, issues) {
  if (config.schemaVersion !== 1) {
    issues.push({
      code: "CONFIG_SCHEMA",
      file: configFile,
      message: "schemaVersion은 1이어야 합니다."
    });
  }

  for (const key of [
    "activeDocs",
    "workflowClaimDocs",
    "canonicalSources",
    "forbiddenReferences",
    "historicalRoots"
  ]) {
    if (!Array.isArray(config[key])) {
      issues.push({
        code: "CONFIG_FIELD",
        file: configFile,
        message: `${key}는 배열이어야 합니다.`
      });
    }
  }
}

export function inspectRepository(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const configPath = resolve(root, options.configPath ?? DEFAULT_CONFIG_PATH);
  const configRepoPath = toRepoPath(root, configPath);
  const issues = [];
  const warnings = [];

  if (!existsSync(configPath)) {
    return {
      issues: [
        {
          code: "CONFIG_MISSING",
          file: configRepoPath,
          message: "repository truth 설정 파일이 없습니다."
        }
      ],
      warnings
    };
  }

  let config;
  try {
    config = readJson(configPath);
  } catch (error) {
    return {
      issues: [
        {
          code: "CONFIG_INVALID",
          file: configRepoPath,
          message: `JSON을 읽을 수 없습니다: ${error.message}`
        }
      ],
      warnings
    };
  }

  validateConfig(config, configRepoPath, issues);
  if (issues.length > 0) {
    return { issues, warnings };
  }

  const activeDocs = new Set(config.activeDocs);
  if (activeDocs.size !== config.activeDocs.length) {
    issues.push({
      code: "ACTIVE_DOC_DUPLICATE",
      file: configRepoPath,
      message: "activeDocs에 중복 경로가 있습니다."
    });
  }

  for (const document of activeDocs) {
    const historicalRoot = config.historicalRoots.find(
      (rootPath) =>
        document === rootPath || document.startsWith(`${rootPath}/`),
    );
    if (historicalRoot) {
      issues.push({
        code: "ACTIVE_DOC_HISTORICAL",
        file: document,
        message: `active 문서는 historical root에 둘 수 없습니다: ${historicalRoot}`,
      });
    }
  }

  for (const source of config.canonicalSources) {
    if (!existsSync(resolve(root, source))) {
      issues.push({
        code: "CANONICAL_SOURCE_MISSING",
        file: configRepoPath,
        message: `canonical source가 없습니다: ${source}`
      });
    }
  }

  for (const document of config.activeDocs) {
    const documentPath = resolve(root, document);
    if (!existsSync(documentPath) || !statSync(documentPath).isFile()) {
      issues.push({
        code: "ACTIVE_DOC_MISSING",
        file: document,
        message: "active 문서가 없습니다."
      });
      continue;
    }

    const content = readFileSync(documentPath, "utf8");

    for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
      const targetPath = resolveMarkdownTarget(root, documentPath, match[1]);
      if (targetPath && !existsSync(targetPath)) {
        issues.push({
          code: "BROKEN_MARKDOWN_LINK",
          file: document,
          message: `대상이 없습니다: ${normalizeMarkdownTarget(match[1])}`
        });
      }
    }

    for (const forbidden of config.forbiddenReferences) {
      if (content.includes(forbidden.value)) {
        issues.push({
          code: "FORBIDDEN_REFERENCE",
          file: document,
          message: `${forbidden.value} 대신 ${forbidden.replacement}을 사용해야 합니다.`
        });
      }
    }
  }

  for (const document of config.workflowClaimDocs) {
    const documentPath = resolve(root, document);
    if (!existsSync(documentPath)) {
      continue;
    }

    const content = readFileSync(documentPath, "utf8");
    for (const workflow of extractWorkflowReferences(content)) {
      if (!existsSync(resolve(root, ".github/workflows", workflow))) {
        issues.push({
          code: "WORKFLOW_REFERENCE_MISSING",
          file: document,
          message: `참조한 workflow가 없습니다: .github/workflows/${workflow}`
        });
      }
    }
  }

  for (const historicalRoot of config.historicalRoots) {
    const historicalPath = resolve(root, historicalRoot);
    for (const documentPath of listMarkdownFiles(historicalPath)) {
      const content = readFileSync(documentPath, "utf8");
      for (const forbidden of config.forbiddenReferences) {
        if (content.includes(forbidden.value)) {
          warnings.push({
            code: "HISTORICAL_FORBIDDEN_REFERENCE",
            file: toRepoPath(root, documentPath),
            message: `역사 자료가 이전 경로를 참조합니다: ${forbidden.value}`
          });
        }
      }
    }
  }

  issues.sort((left, right) =>
    `${left.file}:${left.code}:${left.message}`.localeCompare(
      `${right.file}:${right.code}:${right.message}`
    )
  );
  warnings.sort((left, right) =>
    `${left.file}:${left.code}:${left.message}`.localeCompare(
      `${right.file}:${right.code}:${right.message}`
    )
  );

  return { issues, warnings };
}

function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    configPath: DEFAULT_CONFIG_PATH,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--root") {
      options.root = argv[index + 1];
      index += 1;
    } else if (argument === "--config") {
      options.configPath = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    }
  }

  return options;
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  for (const issue of result.issues) {
    process.stderr.write(`[error] ${issue.code} ${issue.file}: ${issue.message}\n`);
  }
  for (const warning of result.warnings) {
    process.stdout.write(`[warn] ${warning.code} ${warning.file}: ${warning.message}\n`);
  }

  if (result.issues.length === 0) {
    process.stdout.write(
      `repo:doctor 통과 (${result.warnings.length}개의 역사 자료 경고)\n`
    );
  } else {
    process.stderr.write(`repo:doctor 실패 (${result.issues.length}개 오류)\n`);
  }
}

function run() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const result = inspectRepository(options.root, {
    configPath: options.configPath
  });
  printResult(result, options.json);
  if (result.issues.length > 0) {
    process.exitCode = 1;
  }
}

const currentEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (currentEntry === import.meta.url) {
  run();
}
