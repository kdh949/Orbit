#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const defaultCssFiles = [
  "apps/web/src/features/editor/editor-shell.css",
  "apps/web/src/styles.css",
];

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") {
      line += 1;
    }
  }
  return line;
}

function splitSelectorList(prelude) {
  const selectors = [];
  let current = "";
  let quote = "";
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  for (const character of prelude) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      current += character;
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets = Math.max(0, brackets - 1);
    }
    if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  selectors.push(current);
  return selectors;
}

function normalizeSelector(selector) {
  return selector.replace(/\s+/g, " ").trim();
}

function inferOwner(selector) {
  const classMatch = selector.match(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/);
  if (classMatch) {
    return `.${classMatch[1]}`;
  }
  const idMatch = selector.match(/#(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/);
  if (idMatch) {
    return `#${idMatch[1]}`;
  }
  const rootMatch = selector.match(/^:root\b/);
  if (rootMatch) {
    return ":root";
  }
  const elementMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9-]*)\b/);
  return elementMatch?.[1] ?? "(complex)";
}

function maskCssComments(source) {
  const characters = [...source];
  let comment = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const nextCharacter = characters[index + 1];
    if (comment) {
      if (character === "*" && nextCharacter === "/") {
        characters[index] = " ";
        characters[index + 1] = " ";
        comment = false;
        index += 1;
      } else if (character !== "\n" && character !== "\r") {
        characters[index] = " ";
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      comment = true;
      index += 1;
    }
  }

  return characters.join("");
}

export function extractCssSelectors(rawSource) {
  const source = maskCssComments(rawSource);
  const selectors = [];
  let boundary = 0;
  let comment = false;
  let quote = "";
  let escaped = false;

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
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
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
      quote = character;
      continue;
    }
    if (character === "{") {
      const rawPrelude = source.slice(boundary, index).trim();
      if (rawPrelude && !rawPrelude.startsWith("@")) {
        const preludeOffset = source.indexOf(rawPrelude, boundary);
        for (const rawSelector of splitSelectorList(rawPrelude)) {
          const selector = normalizeSelector(rawSelector);
          if (selector) {
            selectors.push({
              line: lineNumberAt(source, preludeOffset),
              owner: inferOwner(selector),
              selector,
            });
          }
        }
      }
      boundary = index + 1;
      continue;
    }
    if (character === "}" || character === ";") {
      boundary = index + 1;
    }
  }

  return selectors;
}

export function createCssOwnershipReport(rootDirectory, filePaths) {
  const root = resolve(rootDirectory);
  const occurrencesBySelector = new Map();
  const occurrencesByOwner = new Map();
  const files = filePaths.map((filePath) => {
    const absolutePath = resolve(root, filePath);
    const source = readFileSync(absolutePath, "utf8");
    const selectors = extractCssSelectors(source);
    const path = toRepoPath(root, absolutePath);

    for (const occurrence of selectors) {
      const selectorOccurrences =
        occurrencesBySelector.get(occurrence.selector) ?? [];
      selectorOccurrences.push({ line: occurrence.line, path });
      occurrencesBySelector.set(occurrence.selector, selectorOccurrences);

      const ownerOccurrences = occurrencesByOwner.get(occurrence.owner) ?? [];
      ownerOccurrences.push({
        line: occurrence.line,
        path,
        selector: occurrence.selector,
      });
      occurrencesByOwner.set(occurrence.owner, ownerOccurrences);
    }

    return {
      lineCount: source.split(/\r?\n/).length,
      path,
      selectorCount: selectors.length,
      uniqueSelectorCount: new Set(
        selectors.map((occurrence) => occurrence.selector),
      ).size,
    };
  });

  const duplicates = [...occurrencesBySelector.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([selector, occurrences]) => ({ occurrences, selector }))
    .sort(
      (left, right) =>
        right.occurrences.length - left.occurrences.length ||
        left.selector.localeCompare(right.selector),
    );
  const owners = [...occurrencesByOwner.entries()]
    .map(([owner, occurrences]) => ({
      occurrenceCount: occurrences.length,
      owner,
      selectors: [...new Set(occurrences.map(({ selector }) => selector))],
    }))
    .sort(
      (left, right) =>
        right.occurrenceCount - left.occurrenceCount ||
        left.owner.localeCompare(right.owner),
    );

  return {
    duplicateOccurrenceCount: duplicates.reduce(
      (total, duplicate) => total + duplicate.occurrences.length,
      0,
    ),
    duplicateSelectorCount: duplicates.length,
    duplicates,
    files,
    owners,
  };
}

function printTextReport(report) {
  for (const file of report.files) {
    console.log(
      `${file.path}: lines=${file.lineCount} selectors=${file.selectorCount} unique=${file.uniqueSelectorCount}`,
    );
  }
  console.log(
    `duplicates: selectors=${report.duplicateSelectorCount} occurrences=${report.duplicateOccurrenceCount}`,
  );
  console.log("top owners:");
  for (const owner of report.owners.slice(0, 20)) {
    console.log(
      `  ${owner.owner}: occurrences=${owner.occurrenceCount} selectors=${owner.selectors.length}`,
    );
  }
  console.log("top duplicate selectors:");
  for (const duplicate of report.duplicates.slice(0, 20)) {
    const locations = duplicate.occurrences
      .map(({ path, line }) => `${path}:${line}`)
      .join(", ");
    console.log(
      `  ${duplicate.selector}: occurrences=${duplicate.occurrences.length} (${locations})`,
    );
  }
}

function run() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const filePaths = args.filter((argument) => argument !== "--json");
  const report = createCssOwnershipReport(
    process.cwd(),
    filePaths.length > 0 ? filePaths : defaultCssFiles,
  );
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printTextReport(report);
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
