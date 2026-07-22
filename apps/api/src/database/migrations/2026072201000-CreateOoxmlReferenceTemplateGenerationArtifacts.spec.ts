import type { QueryRunner } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { CreateOoxmlReferenceTemplateGenerationArtifacts2026072201000 } from "./2026072201000-CreateOoxmlReferenceTemplateGenerationArtifacts";

describe("CreateOoxmlReferenceTemplateGenerationArtifacts migration", () => {
  it("creates bounded, tenant-safe immutable generation artifacts", async () => {
    const { queries, queryRunner } = queryRunnerSpy();

    await new CreateOoxmlReferenceTemplateGenerationArtifacts2026072201000().up(
      queryRunner,
    );

    const sql = compactSql(queries.join("\n"));
    expect(sql).toContain(
      "CREATE TABLE ooxml_reference_template_generation_artifacts",
    );
    expect(sql).toContain("artifact_id uuid PRIMARY KEY");
    expect(sql).toContain("job_id text NOT NULL");
    expect(sql).toContain("payload_json jsonb NOT NULL");
    expect(sql).toContain("UNIQUE (job_id, stage, shard_key)");
    expect(sql).toContain(
      "FOREIGN KEY (job_id, project_id) REFERENCES jobs(job_id, project_id) ON DELETE CASCADE",
    );
    expect(sql).toContain("stage IN (");
    expect(sql).toContain("'slide-render'");
    expect(sql).toContain("shard_key ~ '^[0-9]{3}$'");
    expect(sql).toContain("shard_key BETWEEN '001' AND '500'");
    expect(sql).toContain("octet_length(payload_json::text) <= 1048576");
  });

  it("drops only its artifact table on revert", async () => {
    const { queries, queryRunner } = queryRunnerSpy();

    await new CreateOoxmlReferenceTemplateGenerationArtifacts2026072201000().down(
      queryRunner,
    );

    expect(compactSql(queries.join("\n"))).toBe(
      "DROP TABLE IF EXISTS ooxml_reference_template_generation_artifacts",
    );
  });
});

function queryRunnerSpy() {
  const queries: string[] = [];
  const queryRunner = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  return { queries, queryRunner };
}

function compactSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
