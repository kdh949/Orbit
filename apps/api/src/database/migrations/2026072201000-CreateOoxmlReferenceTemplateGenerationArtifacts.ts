import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOoxmlReferenceTemplateGenerationArtifacts2026072201000 implements MigrationInterface {
  name = "CreateOoxmlReferenceTemplateGenerationArtifacts2026072201000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ooxml_reference_template_generation_artifacts (
        artifact_id uuid PRIMARY KEY,
        job_id text NOT NULL
          CHECK (job_id = btrim(job_id) AND char_length(job_id) BETWEEN 1 AND 200),
        project_id text NOT NULL
          CHECK (
            project_id = btrim(project_id)
            AND char_length(project_id) BETWEEN 1 AND 200
          ),
        stage text NOT NULL CHECK (stage IN (
          'reference-extract-file','source-grounding','content-planning',
          'template-planning','package-generation','slide-render',
          'render-validation','materialization','publication'
        )),
        shard_key text NOT NULL DEFAULT '' CHECK (
          (stage = 'slide-render'
            AND shard_key ~ '^[0-9]{3}$'
            AND shard_key BETWEEN '001' AND '500')
          OR (stage <> 'slide-render' AND shard_key = '')
        ),
        payload_json jsonb NOT NULL CHECK (
          jsonb_typeof(payload_json) = 'object'
          AND octet_length(payload_json::text) <= 1048576
        ),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (job_id, stage, shard_key),
        FOREIGN KEY (job_id, project_id)
          REFERENCES jobs(job_id, project_id) ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ooxml_reference_template_generation_artifacts`,
    );
  }
}
