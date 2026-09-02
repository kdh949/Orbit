import { Counter, Histogram, type Registry } from "@prometheus-io/client";

export type DatabaseOperation =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "transaction"
  | "ddl"
  | "other";

export type DatabaseQueryOutcome = "success" | "error";

export interface TypeOrmQueryEventLike {
  query: string;
  queryRunner: object;
}

export interface TypeOrmAfterQueryEventLike extends TypeOrmQueryEventLike {
  executionTime?: number;
  success: boolean;
}

export interface TypeOrmQuerySubscriberLike {
  beforeQuery(event: TypeOrmQueryEventLike): void;
  afterQuery(event: TypeOrmAfterQueryEventLike): void;
}

export interface TypeOrmQueryMetrics {
  subscriber: TypeOrmQuerySubscriberLike;
}

const queryDurationBuckets = [
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const statementOperations = new Map<string, DatabaseOperation>([
  ["SELECT", "select"],
  ["INSERT", "insert"],
  ["UPDATE", "update"],
  ["DELETE", "delete"],
  ["BEGIN", "transaction"],
  ["START", "transaction"],
  ["COMMIT", "transaction"],
  ["ROLLBACK", "transaction"],
  ["SAVEPOINT", "transaction"],
  ["RELEASE", "transaction"],
  ["CREATE", "ddl"],
  ["ALTER", "ddl"],
  ["DROP", "ddl"],
  ["TRUNCATE", "ddl"],
  ["COMMENT", "ddl"],
  ["GRANT", "ddl"],
  ["REVOKE", "ddl"],
]);

export function classifyDatabaseOperation(query: string): DatabaseOperation {
  const topLevelTokens = scanTopLevelTokens(query);
  const firstToken = topLevelTokens[0];
  if (!firstToken) return "other";

  if (firstToken !== "WITH") {
    return statementOperations.get(firstToken) ?? "other";
  }

  for (const token of topLevelTokens.slice(1)) {
    const operation = statementOperations.get(token);
    if (operation) return operation;
  }
  return "other";
}

export function createTypeOrmQueryMetrics(input: {
  registry: Registry;
  now?: () => bigint;
}): TypeOrmQueryMetrics {
  const now = input.now ?? process.hrtime.bigint;
  const queryCount = new Counter({
    name: "orbit_db_client_queries_total",
    help: "Database client queries completed by operation and outcome.",
    labelNames: ["operation", "outcome"] as const,
    registers: [input.registry],
  });
  const queryDuration = new Histogram({
    name: "orbit_db_client_query_duration_seconds",
    help: "Database client query duration in seconds.",
    labelNames: ["operation", "outcome"] as const,
    buckets: queryDurationBuckets,
    registers: [input.registry],
  });
  const pendingQueries = new WeakMap<
    object,
    Array<{ operation: DatabaseOperation; startedAt: bigint }>
  >();

  return {
    subscriber: {
      beforeQuery(event): void {
        const pending = pendingQueries.get(event.queryRunner) ?? [];
        pending.push({
          operation: classifyDatabaseOperation(event.query),
          startedAt: now(),
        });
        pendingQueries.set(event.queryRunner, pending);
      },
      afterQuery(event): void {
        const pending = pendingQueries.get(event.queryRunner);
        const started = pending?.pop();
        if (pending?.length === 0) pendingQueries.delete(event.queryRunner);

        const operation =
          started?.operation ?? classifyDatabaseOperation(event.query);
        const outcome: DatabaseQueryOutcome = event.success
          ? "success"
          : "error";
        const labels = { operation, outcome };
        queryCount.inc(labels);

        const durationSeconds = started
          ? Number(now() - started.startedAt) / 1_000_000_000
          : executionTimeSeconds(event.executionTime);
        if (durationSeconds !== undefined) {
          queryDuration.observe(labels, Math.max(0, durationSeconds));
        }
      },
    },
  };
}

export function attachTypeOrmQuerySubscriber(
  dataSource: { subscribers: object[] },
  subscriber: object,
): () => void {
  if (!dataSource.subscribers.includes(subscriber)) {
    dataSource.subscribers.push(subscriber);
  }

  return () => {
    const index = dataSource.subscribers.indexOf(subscriber);
    if (index >= 0) dataSource.subscribers.splice(index, 1);
  };
}

function executionTimeSeconds(
  executionTime: number | undefined,
): number | undefined {
  if (executionTime === undefined || !Number.isFinite(executionTime)) {
    return undefined;
  }
  return executionTime / 1_000;
}

function scanTopLevelTokens(query: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let index = 0;
  let quote: "'" | '"' | "`" | null = null;

  while (index < query.length) {
    const character = query[index];
    const next = query[index + 1];

    if (quote) {
      if (character === quote) {
        if (next === quote) {
          index += 2;
          continue;
        }
        quote = null;
      } else if (character === "\\" && quote !== '"') {
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === "-" && next === "-") {
      index = skipLineComment(query, index + 2);
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(query, index + 2);
      continue;
    }
    if (character === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 && /[A-Za-z]/.test(character)) {
      const start = index;
      index += 1;
      while (index < query.length && /[A-Za-z_]/.test(query[index])) {
        index += 1;
      }
      tokens.push(query.slice(start, index).toUpperCase());
      continue;
    }
    index += 1;
  }

  return tokens;
}

function skipLineComment(query: string, start: number): number {
  const newline = query.indexOf("\n", start);
  return newline === -1 ? query.length : newline + 1;
}

function skipBlockComment(query: string, start: number): number {
  const end = query.indexOf("*/", start);
  return end === -1 ? query.length : end + 2;
}
