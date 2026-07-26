#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const rootPackage = "@orbit/shared";
const codeExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mts",
  ".ts",
  ".tsx",
]);
const skippedDirectories = new Set([
  ".git",
  ".turbo",
  ".venv",
  "coverage",
  "dist",
  "node_modules",
]);

function toRepoPath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function listCodeFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCodeFiles(entryPath));
    } else if (entry.isFile() && codeExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

function resolveModuleFile(fromFile, moduleSpecifier) {
  const base = resolve(dirname(fromFile), moduleSpecifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

function collectBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, names);
    }
  }
}

function hasExportModifier(statement) {
  return Boolean(
    statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ),
  );
}

function collectExportedNames(
  entryFile,
  cache = new Map(),
  visiting = new Set(),
) {
  const absoluteEntry = resolve(entryFile);
  if (cache.has(absoluteEntry)) {
    return new Set(cache.get(absoluteEntry));
  }
  if (visiting.has(absoluteEntry)) {
    return new Set();
  }
  visiting.add(absoluteEntry);

  const source = readFileSync(absoluteEntry, "utf8");
  const sourceFile = ts.createSourceFile(
    absoluteEntry,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause) {
        if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            names.add(element.name.text);
          }
        } else {
          names.add(statement.exportClause.name.text);
        }
      } else if (
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const target = resolveModuleFile(
          absoluteEntry,
          statement.moduleSpecifier.text,
        );
        if (target) {
          for (const name of collectExportedNames(target, cache, visiting)) {
            names.add(name);
          }
        }
      }
      continue;
    }

    if (!hasExportModifier(statement)) {
      continue;
    }
    if (
      (ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
    }
  }

  visiting.delete(absoluteEntry);
  cache.set(absoluteEntry, new Set(names));
  return names;
}

export function buildCanonicalSymbolMap(rootDirectory) {
  const root = resolve(rootDirectory);
  const packageDirectory = join(root, "packages/shared");
  const packageJson = JSON.parse(
    readFileSync(join(packageDirectory, "package.json"), "utf8"),
  );
  const candidatesBySymbol = new Map();

  for (const [exportKey, target] of Object.entries(packageJson.exports ?? {})) {
    if (exportKey === "." || !target || typeof target !== "object") {
      continue;
    }
    const sourceTarget = target.import;
    if (typeof sourceTarget !== "string") {
      continue;
    }
    const entryFile = resolve(packageDirectory, sourceTarget);
    const packageSpecifier = `${rootPackage}/${exportKey.slice(2)}`;
    for (const symbol of collectExportedNames(entryFile)) {
      const candidates = candidatesBySymbol.get(symbol) ?? new Set();
      candidates.add(packageSpecifier);
      candidatesBySymbol.set(symbol, candidates);
    }
  }

  return new Map(
    [...candidatesBySymbol].map(([symbol, candidates]) => [
      symbol,
      [...candidates].sort(),
    ]),
  );
}

function quoteFor(moduleSpecifier) {
  return moduleSpecifier.getText().startsWith("'") ? "'" : '"';
}

function renderImport({
  defaultImport,
  elements,
  isTypeOnly,
  quote,
  specifier,
}) {
  const parts = [];
  if (defaultImport) {
    parts.push(defaultImport);
  }
  if (elements.length > 0) {
    parts.push(`{ ${elements.join(", ")} }`);
  }
  return `import ${isTypeOnly ? "type " : ""}${parts.join(", ")} from ${quote}${specifier}${quote};`;
}

function renderExport({ elements, isTypeOnly, quote, specifier }) {
  return `export ${isTypeOnly ? "type " : ""}{ ${elements.join(", ")} } from ${quote}${specifier}${quote};`;
}

function conflictFor(file, sourceFile, node, details) {
  return {
    file,
    line:
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1,
    ...details,
  };
}

export function transformSharedRootImports({
  content,
  file = "<memory>",
  symbolMap,
}) {
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") || file.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const replacements = [];
  const conflicts = [];
  let migratedSymbols = 0;
  let rootImportDeclarations = 0;

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === rootPackage
    ) {
      rootImportDeclarations += 1;
      if (
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        conflicts.push(
          conflictFor(file, sourceFile, statement, {
            reason: "STAR_OR_NAMESPACE_EXPORT",
          }),
        );
        continue;
      }

      const groups = new Map();
      const rootElements = [];
      for (const element of statement.exportClause.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        const candidates = symbolMap.get(importedName) ?? [];
        if (candidates.length !== 1) {
          rootElements.push(element.getText(sourceFile));
          conflicts.push(
            conflictFor(file, sourceFile, element, {
              reason:
                candidates.length === 0
                  ? "UNMAPPED_SYMBOL"
                  : "AMBIGUOUS_SYMBOL",
              symbol: importedName,
              candidates,
            }),
          );
          continue;
        }
        const [specifier] = candidates;
        const elements = groups.get(specifier) ?? [];
        elements.push(element.getText(sourceFile));
        groups.set(specifier, elements);
        migratedSymbols += 1;
      }

      if (groups.size === 0) {
        continue;
      }
      const quote = quoteFor(statement.moduleSpecifier);
      const exports = [];
      if (rootElements.length > 0) {
        exports.push(
          renderExport({
            elements: rootElements,
            isTypeOnly: statement.isTypeOnly,
            quote,
            specifier: rootPackage,
          }),
        );
      }
      for (const [specifier, elements] of [...groups].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        exports.push(
          renderExport({
            elements,
            isTypeOnly: statement.isTypeOnly,
            quote,
            specifier,
          }),
        );
      }
      replacements.push({
        start: statement.getStart(sourceFile),
        end: statement.end,
        text: exports.join("\n"),
      });
      continue;
    }

    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== rootPackage
    ) {
      continue;
    }
    rootImportDeclarations += 1;
    const clause = statement.importClause;
    if (!clause) {
      conflicts.push(
        conflictFor(file, sourceFile, statement, {
          reason: "SIDE_EFFECT_IMPORT",
        }),
      );
      continue;
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      conflicts.push(
        conflictFor(file, sourceFile, statement, {
          reason: "NAMESPACE_IMPORT",
          symbol: clause.namedBindings.name.text,
        }),
      );
      continue;
    }

    const groups = new Map();
    const rootElements = [];
    const namedElements =
      clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : [];

    for (const element of namedElements) {
      const importedName = (element.propertyName ?? element.name).text;
      const candidates = symbolMap.get(importedName) ?? [];
      if (candidates.length !== 1) {
        rootElements.push(element.getText(sourceFile));
        conflicts.push(
          conflictFor(file, sourceFile, element, {
            reason:
              candidates.length === 0 ? "UNMAPPED_SYMBOL" : "AMBIGUOUS_SYMBOL",
            symbol: importedName,
            candidates,
          }),
        );
        continue;
      }
      const [specifier] = candidates;
      const elements = groups.get(specifier) ?? [];
      elements.push(element.getText(sourceFile));
      groups.set(specifier, elements);
      migratedSymbols += 1;
    }

    if (groups.size === 0) {
      if (clause.name && namedElements.length === 0) {
        conflicts.push(
          conflictFor(file, sourceFile, statement, {
            reason: "DEFAULT_IMPORT",
            symbol: clause.name.text,
          }),
        );
      }
      continue;
    }

    const quote = quoteFor(statement.moduleSpecifier);
    const imports = [];
    if (clause.name || rootElements.length > 0) {
      imports.push(
        renderImport({
          defaultImport: clause.name?.text,
          elements: rootElements,
          isTypeOnly: clause.isTypeOnly,
          quote,
          specifier: rootPackage,
        }),
      );
      if (clause.name) {
        conflicts.push(
          conflictFor(file, sourceFile, clause.name, {
            reason: "DEFAULT_IMPORT",
            symbol: clause.name.text,
          }),
        );
      }
    }
    for (const [specifier, elements] of [...groups].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      imports.push(
        renderImport({
          elements,
          isTypeOnly: clause.isTypeOnly,
          quote,
          specifier,
        }),
      );
    }
    replacements.push({
      start: statement.getStart(sourceFile),
      end: statement.end,
      text: imports.join("\n"),
    });
  }

  function visitImportTypes(node) {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      node.argument.literal.text === rootPackage
    ) {
      rootImportDeclarations += 1;
      const symbol = ts.isIdentifier(node.qualifier)
        ? node.qualifier.text
        : undefined;
      const candidates = symbol ? (symbolMap.get(symbol) ?? []) : [];
      if (symbol && candidates.length === 1) {
        const quote = quoteFor(node.argument.literal);
        replacements.push({
          start: node.argument.literal.getStart(sourceFile),
          end: node.argument.literal.end,
          text: `${quote}${candidates[0]}${quote}`,
        });
        migratedSymbols += 1;
      } else {
        conflicts.push(
          conflictFor(file, sourceFile, node, {
            reason: !symbol
              ? "UNQUALIFIED_IMPORT_TYPE"
              : candidates.length === 0
                ? "UNMAPPED_SYMBOL"
                : "AMBIGUOUS_SYMBOL",
            ...(symbol ? { symbol, candidates } : {}),
          }),
        );
      }
    }
    ts.forEachChild(node, visitImportTypes);
  }
  visitImportTypes(sourceFile);

  let output = content;
  for (const replacement of replacements.sort(
    (left, right) => right.start - left.start,
  )) {
    output =
      output.slice(0, replacement.start) +
      replacement.text +
      output.slice(replacement.end);
  }

  return {
    changed: output !== content,
    conflicts,
    migratedSymbols,
    output,
    rootImportDeclarations,
  };
}

export function isProductionSource(file) {
  return !/(?:^|\/)[^/]+\.(?:spec|test)\.[^/]+$/.test(file);
}

export function containsSharedRootImport(content) {
  return /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']@orbit\/shared["']/.test(
    content,
  );
}

export function runSharedSubpathCodemod(rootDirectory, { write = false } = {}) {
  const root = resolve(rootDirectory);
  const symbolMap = buildCanonicalSymbolMap(root);
  const files = ["apps", "packages"]
    .flatMap((sourceRoot) => listCodeFiles(join(root, sourceRoot)))
    .filter(
      (file) => !toRepoPath(root, file).startsWith("packages/shared/src/"),
    )
    .sort();
  const conflicts = [];
  const changedFiles = [];
  let migratedSymbols = 0;
  let rootImportDeclarations = 0;

  for (const absoluteFile of files) {
    const file = toRepoPath(root, absoluteFile);
    const content = readFileSync(absoluteFile, "utf8");
    const result = transformSharedRootImports({ content, file, symbolMap });
    conflicts.push(...result.conflicts);
    migratedSymbols += result.migratedSymbols;
    rootImportDeclarations += result.rootImportDeclarations;
    if (!result.changed) {
      continue;
    }
    changedFiles.push(file);
    if (write) {
      writeFileSync(absoluteFile, result.output);
    }
  }

  const productionRootImporters = files
    .map((absoluteFile) => ({
      absoluteFile,
      file: toRepoPath(root, absoluteFile),
    }))
    .filter(({ file }) => isProductionSource(file))
    .filter(({ absoluteFile, file }) => {
      if (write) {
        return containsSharedRootImport(readFileSync(absoluteFile, "utf8"));
      }
      const content = readFileSync(absoluteFile, "utf8");
      return containsSharedRootImport(
        transformSharedRootImports({ content, file, symbolMap }).output,
      );
    })
    .map(({ file }) => file);

  return {
    changedFiles,
    conflicts,
    migratedSymbols,
    mode: write ? "write" : "dry-run",
    productionRootImporters,
    rootImportDeclarations,
    scannedFiles: files.length,
  };
}

function parseCliArgs(argv) {
  const write = argv.includes("--write");
  const rootIndex = argv.indexOf("--root");
  return {
    root:
      rootIndex >= 0 && argv[rootIndex + 1]
        ? resolve(argv[rootIndex + 1])
        : process.cwd(),
    write,
  };
}

function run() {
  const options = parseCliArgs(process.argv.slice(2));
  const report = runSharedSubpathCodemod(options.root, {
    write: options.write,
  });
  console.log(JSON.stringify(report, null, 2));
}

const currentEntry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (currentEntry === import.meta.url) {
  run();
}
