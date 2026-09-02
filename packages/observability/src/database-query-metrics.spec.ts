import { Registry } from "@prometheus-io/client";
import { describe, expect, it } from "vitest";

import {
  attachTypeOrmQuerySubscriber,
  classifyDatabaseOperation,
  createTypeOrmQueryMetrics,
} from "./database-query-metrics";

describe("classifyDatabaseOperation", () => {
  it.each([
    ["SELECT * FROM decks", "select"],
    ["/* source */ INSERT INTO decks(id) VALUES ($1)", "insert"],
    ["-- update deck\nUPDATE decks SET title = $1", "update"],
    ["DELETE FROM decks WHERE id = $1", "delete"],
    ["BEGIN", "transaction"],
    ["ROLLBACK", "transaction"],
    ["CREATE INDEX deck_title_idx ON decks(title)", "ddl"],
    ["VACUUM decks", "other"],
  ] as const)("classifies %s as %s", (query, expected) => {
    expect(classifyDatabaseOperation(query)).toBe(expected);
  });

  it("classifies the outer operation of a common table expression", () => {
    expect(
      classifyDatabaseOperation(
        "WITH selected AS (SELECT id FROM decks) UPDATE decks SET title = $1 WHERE id IN (SELECT id FROM selected)",
      ),
    ).toBe("update");
  });
});

describe("createTypeOrmQueryMetrics", () => {
  it("records successful and failed query durations with bounded labels", async () => {
    const registry = new Registry();
    let now = 0n;
    const metrics = createTypeOrmQueryMetrics({
      registry,
      now: () => now,
    });
    const queryRunner = {};

    metrics.subscriber.beforeQuery({
      query: "SELECT * FROM decks WHERE project_id = $1",
      queryRunner,
    });
    now = 125_000_000n;
    metrics.subscriber.afterQuery({
      query: "SELECT * FROM decks WHERE project_id = $1",
      queryRunner,
      success: true,
    });
    metrics.subscriber.beforeQuery({
      query: "UPDATE decks SET title = $1 WHERE id = $2",
      queryRunner,
    });
    now = 175_000_000n;
    metrics.subscriber.afterQuery({
      query: "UPDATE decks SET title = $1 WHERE id = $2",
      queryRunner,
      success: false,
    });

    const output = await registry.metrics();

    expect(output).toContain("orbit_db_client_queries_total");
    expect(output).toContain('operation="select",outcome="success"');
    expect(output).toContain('operation="update",outcome="error"');
    expect(output).toContain("orbit_db_client_query_duration_seconds_sum");
    expect(output).not.toContain("project_id");
    expect(output).not.toContain("decks SET title");
  });

  it("keeps nested timings isolated per query runner", async () => {
    const registry = new Registry();
    let now = 0n;
    const metrics = createTypeOrmQueryMetrics({
      registry,
      now: () => now,
    });
    const queryRunner = {};

    metrics.subscriber.beforeQuery({ query: "SELECT 1", queryRunner });
    now = 10_000_000n;
    metrics.subscriber.beforeQuery({ query: "DELETE FROM decks", queryRunner });
    now = 30_000_000n;
    metrics.subscriber.afterQuery({
      query: "DELETE FROM decks",
      queryRunner,
      success: true,
    });
    now = 50_000_000n;
    metrics.subscriber.afterQuery({
      query: "SELECT 1",
      queryRunner,
      success: true,
    });

    const output = await registry.metrics();

    expect(output).toContain(
      'orbit_db_client_query_duration_seconds_sum{operation="delete",outcome="success"} 0.02',
    );
    expect(output).toContain(
      'orbit_db_client_query_duration_seconds_sum{operation="select",outcome="success"} 0.05',
    );
  });

  it("uses TypeORM execution time when the matching start event is unavailable", async () => {
    const registry = new Registry();
    const metrics = createTypeOrmQueryMetrics({ registry });

    metrics.subscriber.afterQuery({
      query: "COMMIT",
      queryRunner: {},
      success: true,
      executionTime: 25,
    });

    expect(await registry.metrics()).toContain(
      'orbit_db_client_query_duration_seconds_sum{operation="transaction",outcome="success"} 0.025',
    );
  });
});

describe("attachTypeOrmQuerySubscriber", () => {
  it("attaches once and removes only its own subscriber", () => {
    const existing = {};
    const subscriber = {};
    const dataSource = { subscribers: [existing] };

    const detach = attachTypeOrmQuerySubscriber(dataSource, subscriber);
    attachTypeOrmQuerySubscriber(dataSource, subscriber);

    expect(dataSource.subscribers).toEqual([existing, subscriber]);

    detach();

    expect(dataSource.subscribers).toEqual([existing]);
  });
});
