#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { parsers } from "prettier/plugins/postcss";
import { defaultCssEntries, resolveCssImportFiles } from "./css-ownership.mjs";

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function canonicalCss(source) {
  let output = "";
  let whitespace = false;
  let quote = "";
  let escaped = false;
  let comment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (comment) {
      if (character === "*" && nextCharacter === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      if (whitespace && output && !output.endsWith(" ")) {
        output += " ";
      }
      whitespace = false;
      quote = character;
      output += character;
      continue;
    }
    if (/\s/.test(character)) {
      whitespace = true;
      continue;
    }
    if (whitespace && output && !output.endsWith(" ")) {
      output += " ";
    }
    whitespace = false;
    output += character;
  }
  return output.trim();
}

function atRuleContext(source, node) {
  const start = node.source?.start?.offset;
  const end = node.source?.end?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return "";
  }
  const raw = source.slice(start, end);
  const blockStart = raw.indexOf("{");
  return canonicalCss(blockStart >= 0 ? raw.slice(0, blockStart) : raw);
}

function isEmptyRule(node) {
  return (node.nodes ?? []).every((child) => child.type === "css-comment");
}

async function collectRuleOccurrences(root, filePaths) {
  const occurrences = [];
  const sources = new Map();

  for (const filePath of filePaths) {
    const absolutePath = resolve(root, filePath);
    const source = readFileSync(absolutePath, "utf8");
    const ast = await parsers.css.parse(source, { filepath: absolutePath });
    sources.set(filePath, source);

    function visit(nodes, context = []) {
      for (const node of nodes ?? []) {
        if (node.type === "css-atrule") {
          visit(node.nodes, [...context, atRuleContext(source, node)]);
          continue;
        }
        if (node.type !== "css-rule") {
          continue;
        }
        const start = node.source?.start?.offset;
        const end = node.source?.end?.offset;
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
          continue;
        }
        const lineStart = source.lastIndexOf("\n", start - 1) + 1;
        const removalStart =
          source.slice(lineStart, start).trim().length === 0
            ? lineStart
            : start;
        const raw = source.slice(start, end);
        occurrences.push({
          context,
          empty: isEmptyRule(node),
          end,
          filePath,
          line: node.source?.start?.line ?? 1,
          signature: `${context.join(" > ")} || ${canonicalCss(raw)}`,
          start: removalStart,
        });
      }
    }

    visit(ast.nodes);
  }

  return { occurrences, sources };
}

function createFingerprint(occurrences) {
  const lastBySignature = new Map();
  occurrences.forEach((occurrence, index) => {
    if (!occurrence.empty) {
      lastBySignature.set(occurrence.signature, index);
    }
  });
  const effectiveSignatures = occurrences
    .filter(
      (occurrence, index) =>
        !occurrence.empty &&
        lastBySignature.get(occurrence.signature) === index,
    )
    .map((occurrence) => occurrence.signature);
  return createHash("sha256")
    .update(effectiveSignatures.join("\n"))
    .digest("hex");
}

export async function analyzeCssBundle(rootDirectory, entryPath) {
  const root = resolve(rootDirectory);
  const filePaths = resolveCssImportFiles(root, [entryPath]);
  const { occurrences, sources } = await collectRuleOccurrences(
    root,
    filePaths,
  );
  const occurrencesBySignature = new Map();

  for (const occurrence of occurrences) {
    if (occurrence.empty) {
      continue;
    }
    const matches = occurrencesBySignature.get(occurrence.signature) ?? [];
    matches.push(occurrence);
    occurrencesBySignature.set(occurrence.signature, matches);
  }

  const duplicateRules = [...occurrencesBySignature.values()]
    .filter((matches) => matches.length > 1)
    .flatMap((matches) => matches.slice(0, -1));
  const emptyRules = occurrences.filter((occurrence) => occurrence.empty);
  const removals = [...duplicateRules, ...emptyRules].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) || left.start - right.start,
  );

  return {
    duplicateRuleCount: duplicateRules.length,
    emptyRuleCount: emptyRules.length,
    entryPath,
    filePaths,
    fingerprint: createFingerprint(occurrences),
    removableByteCount: removals.reduce(
      (total, removal) => total + removal.end - removal.start,
      0,
    ),
    removals,
    ruleCount: occurrences.length,
    sources,
  };
}

function applyRemovals(source, removals) {
  let output = source;
  for (const removal of [...removals].sort(
    (left, right) => right.start - left.start,
  )) {
    output = `${output.slice(0, removal.start)}${output.slice(removal.end)}`;
  }
  return output;
}

export async function cleanupCssBundles(
  rootDirectory,
  entryPaths = defaultCssEntries,
  options = {},
) {
  const root = resolve(rootDirectory);
  const reports = [];

  for (const entryPath of entryPaths) {
    const before = await analyzeCssBundle(root, entryPath);
    if (options.write && before.removals.length > 0) {
      const removalsByFile = new Map();
      for (const removal of before.removals) {
        const matches = removalsByFile.get(removal.filePath) ?? [];
        matches.push(removal);
        removalsByFile.set(removal.filePath, matches);
      }
      for (const [filePath, removals] of removalsByFile) {
        const source = before.sources.get(filePath);
        writeFileSync(
          resolve(root, filePath),
          applyRemovals(source, removals),
          "utf8",
        );
      }

      const after = await analyzeCssBundle(root, entryPath);
      if (after.fingerprint !== before.fingerprint) {
        throw new Error(
          `CSS cascade fingerprint changed for ${entryPath}: ${before.fingerprint} -> ${after.fingerprint}`,
        );
      }
      if (after.removals.length > 0) {
        throw new Error(
          `CSS cleanup is not idempotent for ${entryPath}: ${after.removals.length} removals remain`,
        );
      }
    }
    reports.push({
      duplicateRuleCount: before.duplicateRuleCount,
      emptyRuleCount: before.emptyRuleCount,
      entryPath,
      fileCount: before.filePaths.length,
      fingerprint: before.fingerprint,
      removableByteCount: before.removableByteCount,
      removalCount: before.removals.length,
      ruleCount: before.ruleCount,
    });
  }

  return reports;
}

function printReport(reports) {
  for (const report of reports) {
    console.log(
      [
        report.entryPath,
        `files=${report.fileCount}`,
        `rules=${report.ruleCount}`,
        `exact-duplicates=${report.duplicateRuleCount}`,
        `empty=${report.emptyRuleCount}`,
        `removals=${report.removalCount}`,
        `bytes=${report.removableByteCount}`,
        `fingerprint=${report.fingerprint}`,
      ].join(" "),
    );
  }
}

async function run() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const write = args.includes("--write");
  const check = args.includes("--check");
  const entryPaths = args.filter(
    (argument) => !["--", "--check", "--json", "--write"].includes(argument),
  );
  const reports = await cleanupCssBundles(
    process.cwd(),
    entryPaths.length > 0 ? entryPaths : defaultCssEntries,
    { write },
  );
  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    printReport(reports);
  }
  if (check && reports.some((report) => report.removalCount > 0)) {
    process.exitCode = 1;
  }
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
