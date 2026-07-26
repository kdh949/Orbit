import { createHash, randomUUID } from "node:crypto";
import { slideSchema } from "@orbit/shared/deck";
import { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { processSlideQuestionGuideGenerationJob } from "../src/slide-question-guide-generation.processor";

const databaseUrl = process.env.ORBIT_INTEGRATION_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const slideHash = sha256Canonical(slideSchema.parse(slideFixture()));
const researchedAt = "2026-07-17T00:00:00.000Z";

const researchCases: ResearchCase[] = [
  {
    label: "non-empty issue codes",
    status: "unavailable",
    attempts: 2,
    issueCodes: ["no-citations"],
    webSources: [],
  },
  {
    label: "empty issue codes",
    status: "succeeded",
    attempts: 1,
    issueCodes: [],
    webSources: [officialWebSource()],
  },
];

describeWithPostgres("slide question guide PostgreSQL persistence", () => {
  const dataSource = new DataSource({ type: "postgres", url: databaseUrl });
  const fixtureIds: FixtureIds[] = [];

  beforeAll(async () => {
    await dataSource.initialize();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup(dataSource, fixtureIds);
    fixtureIds.length = 0;
  });

  afterAll(async () => {
    if (!dataSource.isInitialized) return;
    await cleanup(dataSource, fixtureIds);
    await dataSource.destroy();
  });

  it.each(researchCases)("stores $label as a JSONB array", async (researchCase) => {
    const fixture = createFixtureIds();
    fixtureIds.push(fixture);
    await seedFixture(dataSource, fixture);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(providerResponse(fixture, researchCase))),
    );

    const job = await processSlideQuestionGuideGenerationJob(
      dataSource,
      "http://python-worker.invalid",
      {
        jobId: fixture.jobId,
        projectId: fixture.projectId,
        guideId: fixture.guideId,
      },
    );

    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    const [row] = await dataSource.query(
      `SELECT status, research_issue_codes,
              jsonb_typeof(research_issue_codes) AS issue_codes_type
       FROM slide_question_guides
       WHERE guide_id = $1 AND project_id = $2`,
      [fixture.guideId, fixture.projectId],
    );
    expect(row).toEqual({
      status: "succeeded",
      research_issue_codes: researchCase.issueCodes,
      issue_codes_type: "array",
    });
  });
});

interface FixtureIds {
  userId: string;
  projectId: string;
  deckId: string;
  slideId: string;
  guideId: string;
  jobId: string;
  clientRequestId: string;
}

interface ResearchCase {
  label: string;
  status: "succeeded" | "unavailable";
  attempts: number;
  issueCodes: string[];
  webSources: ReturnType<typeof officialWebSource>[];
}

function createFixtureIds(): FixtureIds {
  const suffix = randomUUID();
  return {
    userId: `it-slide-guide-user-${suffix}`,
    projectId: `it-slide-guide-project-${suffix}`,
    deckId: `deck_it-slide-guide-${suffix}`,
    slideId: "slide_integration_target",
    guideId: `it-slide-guide-${suffix}`,
    jobId: `it-slide-guide-job-${suffix}`,
    clientRequestId: `it-slide-guide-request-${suffix}`,
  };
}

async function seedFixture(dataSource: DataSource, fixture: FixtureIds) {
  await dataSource.query(
    `INSERT INTO users (user_id, email, password_hash, display_name)
     VALUES ($1, $2, 'integration-only', $3)`,
    [
      fixture.userId,
      `${fixture.userId}@example.invalid`,
      `it-${fixture.userId.slice(-12)}`,
    ],
  );
  await dataSource.query(
    `INSERT INTO projects (project_id, workspace_id, title, created_by)
     VALUES ($1, 'it-slide-guide-workspace', 'Slide guide integration', $2)`,
    [fixture.projectId, fixture.userId],
  );
  await dataSource.query(
    `INSERT INTO decks (project_id, deck_id, deck_json, version)
     VALUES ($1, $2, $3::jsonb, 3)`,
    [fixture.projectId, fixture.deckId, JSON.stringify(deckFixture(fixture))],
  );
  await dataSource.query(
    `INSERT INTO jobs (job_id, project_id, type, status, progress, message, payload)
     VALUES ($1, $2, 'slide-question-guide-generation', 'queued', 0, 'queued', $3::jsonb)`,
    [
      fixture.jobId,
      fixture.projectId,
      JSON.stringify({
        jobId: fixture.jobId,
        projectId: fixture.projectId,
        guideId: fixture.guideId,
      }),
    ],
  );
  await dataSource.query(
    `INSERT INTO slide_question_guides (
       guide_id, project_id, deck_id, deck_version, slide_id,
       slide_content_hash, source_snapshot_json, client_request_id,
       status, generation_job_id, created_by, question_count,
       schema_version, prompt_version, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 3, $4,
       $5, $6::jsonb, $7,
       'queued', $8, $9, 3,
       2, 'slide-question-guide-v2', now(), now()
     )`,
    [
      fixture.guideId,
      fixture.projectId,
      fixture.deckId,
      fixture.slideId,
      slideHash,
      JSON.stringify({
        slideId: fixture.slideId,
        deckVersion: 3,
        contentHash: slideHash,
        title: "시장 진입 전략",
        content: "교육 시장에서 첫 고객군을 검증합니다.",
      }),
      fixture.clientRequestId,
      fixture.jobId,
      fixture.userId,
    ],
  );
}

function deckFixture(fixture: FixtureIds) {
  return {
    deckId: fixture.deckId,
    projectId: fixture.projectId,
    title: "Slide guide integration",
    version: 3,
    metadata: {},
    targetDurationMinutes: 10,
    canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
    theme: {},
    slides: [slideFixture()],
  };
}

function slideFixture() {
  return {
    slideId: "slide_integration_target",
    order: 1,
    title: "시장 진입 전략",
    thumbnailUrl: "",
    style: {},
    speakerNotes: "첫 고객군과 검증 순서를 설명합니다.",
    elements: [],
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: [],
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function providerResponse(fixture: FixtureIds, researchCase: ResearchCase) {
  const slideRef = {
    kind: "slide" as const,
    slideId: fixture.slideId,
    objectId: null,
    deckVersion: 3,
    contentHash: slideHash,
  };
  return {
    items: ["evidence", "objection", "decision"].map((questionType, index) => ({
      questionType,
      questionText: `통합 질문 ${index + 1}`,
      supportState: "grounded",
      keyConcepts: [{ label: "핵심 근거", sourceRefs: [slideRef] }],
      suggestedAnswer: {
        summary: "슬라이드 근거 범위에서 답변합니다.",
        structure: ["결론", "근거"],
        caveats: [],
      },
      remediation: null,
      sourceRefs: [slideRef],
    })),
    model: "integration-test",
    research: {
      status: researchCase.status,
      attempts: researchCase.attempts,
      officialSourceCount: researchCase.webSources.length,
      issueCodes: researchCase.issueCodes,
      researchedAt,
    },
    webSources: researchCase.webSources,
    timings: {
      webSearchMs: 1_200,
      generationMs: 8_400,
      totalProviderMs: 9_600,
    },
  };
}

function officialWebSource() {
  return {
    kind: "web" as const,
    sourceId: "web:official-integration",
    url: "https://example.edu/program",
    title: "공식 교육과정",
    authority: "official" as const,
    contentHash: "b".repeat(64),
    retrievedAt: researchedAt,
  };
}

async function cleanup(dataSource: DataSource, fixtures: FixtureIds[]) {
  for (const fixture of fixtures) {
    await dataSource.query("DELETE FROM jobs WHERE job_id = $1", [fixture.jobId]);
    await dataSource.query(
      "DELETE FROM slide_question_guides WHERE guide_id = $1 AND project_id = $2",
      [fixture.guideId, fixture.projectId],
    );
    await dataSource.query("DELETE FROM decks WHERE project_id = $1", [fixture.projectId]);
    await dataSource.query("DELETE FROM projects WHERE project_id = $1", [fixture.projectId]);
    await dataSource.query("DELETE FROM users WHERE user_id = $1", [fixture.userId]);
  }
}
