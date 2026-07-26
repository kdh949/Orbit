import { loadOrbitConfig } from "@orbit/config";
import { createDemoDeck } from "@orbit/editor-core";
import {
  rehearsalEvaluationSnapshotSchema,
  rehearsalReportSchema,
} from "@orbit/shared/rehearsals";
import { describe,expect,it } from "vitest";
import { buildRehearsalEvaluationPlan } from "../practice-goals/evaluation-plan";
import {
  assertDemoResetAllowed,
  createDemoPracticeGoalCopies,
  createDemoRehearsalReport,
  createDemoRunEvaluationSnapshot,
  ensureDemoProjectAccess,
} from "./reset-coaching-demo";

const base={NODE_ENV:"test",APP_ENV:"local",WEB_PORT:"5173",API_PORT:"3000",WORKER_PORT:"3001",PYTHON_WORKER_PORT:"8000",WEB_ORIGIN:"http://localhost:5173",API_BASE_URL:"http://localhost:3000",PYTHON_WORKER_URL:"http://localhost:8000",DATABASE_URL:"postgres://orbit:orbit@localhost:5432/orbit",REDIS_URL:"redis://localhost:6379",PRIVATE_EVIDENCE_REDIS_URL:"redis://localhost:6380",SESSION_SECRET:"local-session-secret-change-me",COOKIE_SECRET:"local-cookie-secret-change-me",STORAGE_DRIVER:"minio",S3_ENDPOINT:"http://localhost:9000",S3_PUBLIC_ENDPOINT:"http://localhost:9000",S3_BUCKET:"orbit-local",S3_REGION:"ap-northeast-2",S3_ACCESS_KEY_ID:"orbit",S3_SECRET_ACCESS_KEY:"orbit-password",S3_FORCE_PATH_STYLE:"true",JOB_QUEUE_DRIVER:"bullmq",LIVE_STT_PROVIDER:"sherpa",LIVE_STT_ENGINE:"web-speech",REPORT_STT_PROVIDER:"openai",OCR_PROVIDER:"python",LLM_PROVIDER:"openai",OPENAI_MODEL:"gpt-4.1-mini",OPENAI_TRANSCRIPTION_MODEL:"whisper-1",OPENAI_EMBEDDING_MODEL:"text-embedding-3-small",AWS_REGION:"ap-northeast-2",TRANSCRIBE_LANGUAGE_CODE:"ko-KR",TEXTRACT_ENABLED:"false",LOG_LEVEL:"info",LOG_PRETTY:"false",DEMO_USER_ID:"user_demo_1",DEMO_WORKSPACE_ID:"workspace_demo_1",DEMO_PROJECT_ID:"project_demo_1",DEMO_DECK_ID:"deck_demo_1",DEMO_SESSION_ID:"session_demo_1",ADAPTIVE_REHEARSAL_COACH_ENABLED:"true",DEMO_COACHING_FIXTURE_ENABLED:"true",DEMO_FIXTURE_ENV_ALLOWLIST:"local",ADAPTIVE_COACHING_PROJECT_ALLOWLIST:"project_demo_1"};
describe("demo coaching reset guard",()=>{it("allows only flagged allowlisted non-production demo resets",()=>{expect(()=>assertDemoResetAllowed(loadOrbitConfig(base,{service:"api"}))).not.toThrow();expect(()=>assertDemoResetAllowed(loadOrbitConfig({...base,DEMO_COACHING_FIXTURE_ENABLED:"false"},{service:"api"}))).toThrow("DEMO_COACHING_FIXTURE_ENABLED");});});

describe("createDemoRunEvaluationSnapshot", () => {
  it("uses the current rehearsal snapshot schema for seeded runs", () => {
    const deck = createDemoDeck();
    const evaluationPlan = buildRehearsalEvaluationPlan({
      deck,
      brief: null,
      sourceGoalSetRef: null,
    });

    const snapshot = createDemoRunEvaluationSnapshot(
      deck,
      evaluationPlan,
      "2026-07-12T09:00:00.000Z",
    );

    expect(rehearsalEvaluationSnapshotSchema.parse(snapshot)).toMatchObject({
      deckId: deck.deckId,
      deckVersion: deck.version,
      capturedAt: "2026-07-12T09:00:00.000Z",
    });
    expect(snapshot.slides).toHaveLength(deck.slides.length);
    expect(snapshot).not.toHaveProperty("snapshotVersion");
  });
});

describe("createDemoRehearsalReport", () => {
  it("creates a meaningful official report using the current schema", () => {
    const deck = createDemoDeck();

    const report = createDemoRehearsalReport(
      deck,
      "run_demo_coaching_baseline",
      "2026-07-12T09:00:00.000Z",
    );

    expect(rehearsalReportSchema.parse(report)).toMatchObject({
      runId: "run_demo_coaching_baseline",
      projectId: deck.projectId,
      deckId: deck.deckId,
      transcriptRetained: false,
      transcript: null,
      semanticEvaluation: { state: "succeeded", measurementMode: "full" },
    });
    expect(report.aiSummary?.headline).toContain("핵심 메시지");
    expect(report.coaching?.nextPracticeFocus).toContain("결론");
    expect(report.slideTimings).toHaveLength(deck.slides.length);
  });
});

describe("createDemoPracticeGoalCopies", () => {
  it("keeps all three demo goals distinct even when the deck has one slide", () => {
    const deck = createDemoDeck();

    const copies = [0, 1, 2].map((index) =>
      createDemoPracticeGoalCopies(deck.slides[0], index),
    );

    expect(new Set(copies.map((copy) => copy.problemLabel))).toHaveLength(3);
    expect(new Set(copies.map((copy) => copy.nextAction))).toHaveLength(3);
    expect(new Set(copies.map((copy) => copy.successCondition))).toHaveLength(3);
  });
});

describe("ensureDemoProjectAccess", () => {
  it("grants demo workspace participants access without requiring workspace_members", async () => {
    const queries: Array<{ params: unknown[]; sql: string }> = [];
    const manager = {
      async query(sql: string, params: unknown[]) {
        queries.push({ params, sql });
        return [];
      },
    };
    const config = loadOrbitConfig(base, { service: "api" });

    await ensureDemoProjectAccess(manager, config);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("INSERT INTO project_members");
    expect(queries[0].sql).toContain("FROM projects");
    expect(queries[0].sql).toContain("JOIN projects");
    expect(queries[0].sql).not.toContain("workspace_members");
    expect(queries[0].sql).toContain("'editor','accepted'");
    expect(queries[0].sql).toContain("WHEN project_members.role='owner'");
    expect(queries[0].params).toEqual([
      config.DEMO_PROJECT_ID,
      config.DEMO_WORKSPACE_ID,
    ]);
  });
});
