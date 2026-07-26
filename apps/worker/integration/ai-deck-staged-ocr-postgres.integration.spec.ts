import { referenceExtractionResultSchema } from "@orbit/shared/deck";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AiDeckStageFencingLostError,
  completeAiDeckReferenceExtractionStage,
} from "../src/generate-deck/reference-extraction-join";

const databaseUrl = process.env.AI_DECK_3381_POSTGRES_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres("AI deck staged OCR PostgreSQL integration", () => {
  const dataSource = new DataSource({ type: "postgres", url: databaseUrl });
  const success = fixture("commit");
  const stale = fixture("stale");

  beforeAll(async () => {
    await dataSource.initialize();
    await cleanup(dataSource, [success, stale]);
    await seedRunningStage(dataSource, success);
    await seedRunningStage(dataSource, stale);
  });

  afterAll(async () => {
    if (!dataSource.isInitialized) return;
    await cleanup(dataSource, [success, stale]);
    await dataSource.destroy();
  });

  it("commits artifact, fenced checkpoint, and source join atomically", async () => {
    await completeAiDeckReferenceExtractionStage(dataSource, {
      message: success.message,
      leaseOwner: success.leaseOwner,
      attempt: 1,
      extraction: extraction(success),
    });

    const [row] = await dataSource.query(
      `
        SELECT artifacts.artifact_id::text,
               stages.status AS extraction_status,
               stages.result_ref_json,
               grounding.status AS grounding_status,
               grounding.dispatched_at,
               jobs.status AS parent_status
        FROM jobs
        JOIN ai_deck_generation_stages stages
          ON stages.pipeline_job_id = jobs.job_id
         AND stages.stage = 'reference-extract-file'
         AND stages.shard_key = $2
        JOIN ai_deck_reference_extraction_artifacts artifacts
          ON artifacts.pipeline_job_id = jobs.job_id
         AND artifacts.file_id = $2
        JOIN ai_deck_generation_stages grounding
          ON grounding.pipeline_job_id = jobs.job_id
         AND grounding.stage = 'source-grounding'
         AND grounding.shard_key = ''
        WHERE jobs.job_id = $1
      `,
      [success.jobId, success.fileId],
    );

    expect(row).toMatchObject({
      extraction_status: "succeeded",
      grounding_status: "queued",
      dispatched_at: null,
      parent_status: "running",
    });
    expect(row.result_ref_json).toEqual({
      referenceExtractionArtifactId: row.artifact_id,
    });
  });

  it("rolls back the artifact when stale lease fencing rejects completion", async () => {
    await expect(
      completeAiDeckReferenceExtractionStage(dataSource, {
        message: stale.message,
        leaseOwner: "worker-other:7dc4ed60-2d85-4f13-b3ca-c6bb4ed54f8a",
        attempt: 1,
        extraction: extraction(stale),
      }),
    ).rejects.toBeInstanceOf(AiDeckStageFencingLostError);

    const [row] = await dataSource.query(
      `
        SELECT stages.status,
               stages.result_ref_json,
               COUNT(artifacts.*)::int AS artifact_count,
               COUNT(grounding.*)::int AS grounding_count
        FROM ai_deck_generation_stages stages
        LEFT JOIN ai_deck_reference_extraction_artifacts artifacts
          ON artifacts.pipeline_job_id = stages.pipeline_job_id
         AND artifacts.file_id = stages.shard_key
        LEFT JOIN ai_deck_generation_stages grounding
          ON grounding.pipeline_job_id = stages.pipeline_job_id
         AND grounding.stage = 'source-grounding'
        WHERE stages.pipeline_job_id = $1
          AND stages.stage = 'reference-extract-file'
          AND stages.shard_key = $2
        GROUP BY stages.status, stages.result_ref_json
      `,
      [stale.jobId, stale.fileId],
    );

    expect(row).toEqual({
      status: "running",
      result_ref_json: null,
      artifact_count: 0,
      grounding_count: 0,
    });
  });
});

interface Fixture {
  projectId: string;
  jobId: string;
  fileId: string;
  leaseOwner: string;
  message: {
    pipelineJobId: string;
    projectId: string;
    stage: "reference-extract-file";
    shardKey: string;
  };
}

function fixture(suffix: string): Fixture {
  const projectId = `it3381-project-${suffix}`;
  const jobId = `it3381-job-${suffix}`;
  const fileId = `it3381-file-${suffix}`;
  return {
    projectId,
    jobId,
    fileId,
    leaseOwner: `worker-${suffix}:7dc4ed60-2d85-4f13-b3ca-c6bb4ed54f8a`,
    message: {
      pipelineJobId: jobId,
      projectId,
      stage: "reference-extract-file",
      shardKey: fileId,
    },
  };
}

async function seedRunningStage(
  dataSource: DataSource,
  fixture: Fixture,
): Promise<void> {
  await dataSource.query(
    `
      INSERT INTO projects (project_id, workspace_id, title, created_by)
      VALUES ($1, 'it3381-workspace', '338-1 integration', 'it3381-user')
    `,
    [fixture.projectId],
  );
  await dataSource.query(
    `
      INSERT INTO project_assets (
        file_id, project_id, storage_key, original_name, mime_type,
        size, url, purpose, status, uploaded_at
      )
      VALUES (
        $1, $2, $3, 'brief.pdf', 'application/pdf',
        3, $4, 'reference-material', 'uploaded', now()
      )
    `,
    [
      fixture.fileId,
      fixture.projectId,
      `projects/${fixture.projectId}/assets/${fixture.fileId}`,
      `http://storage.invalid/${fixture.fileId}`,
    ],
  );
  await dataSource.query(
    `
      INSERT INTO jobs (
        job_id, project_id, type, status, progress, message, payload
      )
      VALUES (
        $1, $2, 'ai-deck-generation', 'running', 10, 'running', $3::jsonb
      )
    `,
    [
      fixture.jobId,
      fixture.projectId,
      {
        request: {
          topic: "PostgreSQL staged OCR integration",
          referencePolicy: "references-first",
          referenceFileIds: [fixture.fileId],
        },
      },
    ],
  );
  await dataSource.query(
    `
      INSERT INTO ai_deck_generation_stages (
        pipeline_job_id, stage, shard_key, status, attempt,
        lease_owner, lease_expires_at, dispatched_at
      )
      VALUES (
        $1, 'reference-extract-file', $2, 'running', 1,
        $3, now() + interval '10 minutes', now()
      )
    `,
    [fixture.jobId, fixture.fileId, fixture.leaseOwner],
  );
}

function extraction(fixture: Fixture) {
  return referenceExtractionResultSchema.parse({
    files: [
      {
        projectId: fixture.projectId,
        referenceDocumentId: fixture.fileId,
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        kind: "pdf",
        status: "succeeded",
        rawText: "grounded source",
        cleanedText: "grounded source",
      },
    ],
  }).files[0]!;
}

async function cleanup(
  dataSource: DataSource,
  fixtures: Fixture[],
): Promise<void> {
  const jobIds = fixtures.map((fixture) => fixture.jobId);
  const projectIds = fixtures.map((fixture) => fixture.projectId);
  await dataSource.query("DELETE FROM jobs WHERE job_id = ANY($1::text[])", [
    jobIds,
  ]);
  await dataSource.query(
    "DELETE FROM projects WHERE project_id = ANY($1::text[])",
    [projectIds],
  );
}
