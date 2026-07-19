import {
  createAddSlidePatch,
  createActivityResultsSlide,
  createActivitySlide,
  createDemoDeck
} from "@orbit/editor-core";
import type { Deck, Job } from "@orbit/shared";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { Pool } from "pg";

import { createAuthenticatedProject } from "./authenticatedProject";

const databaseUrl =
  process.env.ACTIVITY_E2E_DATABASE_URL ??
  "postgres://orbit:orbit@127.0.0.1:5432/orbit";
const pool = new Pool({ connectionString: databaseUrl });
const privateText = '비공개 원문 sentinel <img onerror="activity-e2e">';
const privateDisplayName = "민감 이름 sentinel";
const passcode = "2468";

test.afterAll(async () => {
  await pool.end();
});

test.describe("activity slides full story", () => {
  test("materializes an Activity added after the stored Deck checkpoint", async ({
    page
  }) => {
    test.setTimeout(90_000);
    const { deck, project } = await createAuthenticatedProject(page, {
      deck: createDemoDeck(),
      label: "activity-patch-materialization",
      title: "Activity patch materialization 프로젝트"
    });
    if (!deck) throw new Error("Activity patch E2E deck was not persisted");

    const activitySlide = createActivitySlide(deck, "pre-question", {
      title: "Patch 기반 사전 질문"
    });
    const patch = createAddSlidePatch(deck, activitySlide);
    const patchAck = await expectJson<{ version: number }>(
      await page.request.post(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck/patches`,
        { data: { patch, responseMode: "ack" } }
      )
    );
    expect(patchAck.version).toBe(deck.version + 1);

    const storedState = await pool.query<{
      checkpoint_version: number;
      patch_count: string;
    }>(
      `
        SELECT decks.version AS checkpoint_version,
          count(deck_patches.change_id)::text AS patch_count
        FROM decks
        LEFT JOIN deck_patches
          ON deck_patches.project_id = decks.project_id
          AND deck_patches.deck_id = decks.deck_id
        WHERE decks.project_id = $1 AND decks.deck_id = $2
        GROUP BY decks.version
      `,
      [project.projectId, deck.deckId]
    );
    expect(storedState.rows[0]).toEqual({
      checkpoint_version: deck.version,
      patch_count: "1"
    });

    const materialized = await expectJson<{ deck: Deck }>(
      await page.request.get(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck`
      )
    );
    expect(materialized.deck.version).toBe(patchAck.version);
    expect(
      materialized.deck.slides.some(
        (slide) =>
          slide.kind === "activity" &&
          slide.activity.activityId === activitySlide.activity.activityId
      )
    ).toBe(true);

    const session = await createSession(page, project.projectId, {
      accessMode: "public",
      deckId: deck.deckId
    });
    expect(session.session.deckVersion).toBe(materialized.deck.version);
    await ensureAndOpenRun(
      page,
      project.projectId,
      session.session.sessionId,
      activitySlide.activity.activityId
    );

    const activitySlideIndex = materialized.deck.slides.findIndex(
      (slide) =>
        slide.kind === "activity" &&
        slide.activity.activityId === activitySlide.activity.activityId
    );
    expect(activitySlideIndex).toBeGreaterThanOrEqual(0);
    await page.goto(
      `/rehearsal/${encodeURIComponent(project.projectId)}?slideIndex=${activitySlideIndex}`
    );
    await page.getByText("음성 없이 연습하기", { exact: true }).click();
    await expect(page.getByLabel("참여 장표 운영")).toBeVisible();
    await page.waitForTimeout(2_500);
    await expect(
      page.getByText("Presentation session not found", { exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByText("Activity definition not found in stored Deck", {
        exact: true
      })
    ).toHaveCount(0);

    const sessionCount = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM presentation_sessions
        WHERE project_id = $1
      `,
      [project.projectId]
    );
    expect(sessionCount.rows[0]?.count).toBe("1");
  });

  test("create, join, respond, moderate, reveal, archive, export, and retain", async ({
    browser,
    page
  }) => {
    test.setTimeout(180_000);
    const sourceDeck = createActivityDeck();
    const activitySlide = sourceDeck.slides.find(
      (slide) => slide.kind === "activity"
    );
    if (!activitySlide || activitySlide.kind !== "activity") {
      throw new Error("Activity E2E source slide is missing");
    }
    const activityId = activitySlide.activity.activityId;
    const { deck, project } = await createAuthenticatedProject(page, {
      deck: sourceDeck,
      label: "activity-full-story",
      title: "Activity E2E 프로젝트"
    });
    if (!deck) throw new Error("Activity E2E deck was not persisted");

    const passcodeSession = await createSession(page, project.projectId, {
      accessMode: "passcode",
      deckId: deck.deckId,
      passcode
    });
    let run = await ensureAndOpenRun(
      page,
      project.projectId,
      passcodeSession.session.sessionId,
      activityId
    );

    const mobileContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { height: 844, width: 390 }
    });
    const mobile = await mobileContext.newPage();
    await mobile.goto(
      `/audience/${encodeURIComponent(passcodeSession.session.sessionId)}/a/${encodeURIComponent(activityId)}`
    );
    await mobile.getByLabel("4자리 입장 비밀번호").fill(passcode);
    await mobile.getByRole("button", { name: "입장하기" }).click();
    await expect(mobile.getByRole("heading", { name: "E2E 만족도" })).toBeVisible();
    await mobile.getByRole("radio", { name: "5" }).check();
    await mobile.getByLabel(/추가 의견/).fill(privateText);
    await mobile.getByLabel("표시 이름 (선택)").fill(privateDisplayName);
    await mobile.getByRole("button", { name: "응답 제출" }).click();
    await expect(
      mobile.getByRole("heading", { name: "응답이 저장되었습니다" })
    ).toBeVisible();
    expect(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await mobile.reload();
    await expect(
      mobile.getByRole("heading", { name: "응답이 저장되었습니다" })
    ).toBeVisible();

    const privateContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { height: 844, width: 390 }
    });
    const privateAudience = await privateContext.newPage();
    await privateAudience.goto(
      `/audience/${encodeURIComponent(passcodeSession.session.sessionId)}/a/${encodeURIComponent(activityId)}`
    );
    await privateAudience.getByLabel("4자리 입장 비밀번호").fill(passcode);
    await privateAudience.getByRole("button", { name: "입장하기" }).click();
    await expect(
      privateAudience.getByRole("heading", { name: "E2E 만족도" })
    ).toBeVisible();
    expect(await privateAudience.content()).not.toContain(privateText);
    expect(await privateAudience.content()).not.toContain(privateDisplayName);
    const privateProjection = await expectJson<Record<string, unknown>>(
      await privateContext.request.get(
        `/api/v1/audience-sessions/${encodeURIComponent(passcodeSession.session.sessionId)}/activities/${encodeURIComponent(activityId)}`
      )
    );
    expect(JSON.stringify(privateProjection)).not.toContain(privateText);
    expect(JSON.stringify(privateProjection)).not.toContain(privateDisplayName);

    await page.goto(
      `/project/${encodeURIComponent(project.projectId)}/presentation-sessions/${encodeURIComponent(passcodeSession.session.sessionId)}/results`
    );
    await expect(page.getByRole("heading", { name: "발표 세션 결과" })).toBeVisible();
    await expect(page.getByText(privateText, { exact: true })).toBeVisible();
    await expect(page.getByText(`${privateDisplayName} · pending`)).toBeVisible();
    await page.getByRole("button", { name: "승인" }).click();
    await expect(page.getByText(`${privateDisplayName} · approved`)).toBeVisible();

    const presenterResult = await getPresenterResult(
      page,
      project.projectId,
      passcodeSession.session.sessionId,
      run.activityRunId
    );
    expect(presenterResult.result.textEntries[0]).toMatchObject({
      displayName: privateDisplayName,
      moderationStatus: "approved",
      text: privateText
    });
    expect(presenterResult.result).toMatchObject({
      participantCount: 2,
      responseRate: 50
    });
    run = await updateRunStatus(
      page,
      project.projectId,
      passcodeSession.session.sessionId,
      run.activityRunId,
      "closed",
      presenterResult.result.revision
    );
    run = await updateRunStatus(
      page,
      project.projectId,
      passcodeSession.session.sessionId,
      run.activityRunId,
      "results",
      run.revision
    );

    const publicProjection = await expectJson<{
      publicResult: { approvedTextEntries: Array<{ text: string }> } | null;
    }>(
      await privateContext.request.get(
        `/api/v1/audience-sessions/${encodeURIComponent(passcodeSession.session.sessionId)}/activities/${encodeURIComponent(activityId)}`
      )
    );
    expect(publicProjection.publicResult?.approvedTextEntries[0]?.text).toBe(
      privateText
    );
    expect(JSON.stringify(publicProjection.publicResult)).not.toContain(
      privateDisplayName
    );

    await page.goto(`/project/${encodeURIComponent(project.projectId)}`);
    await expect(page.getByLabel("Presentation editor")).toBeVisible();
    await page.locator(".slide-item").nth(1).click();
    await expect(page.getByText("연결 결과 장표", { exact: true })).toBeVisible();
    await page
      .getByLabel("미리 볼 발표 세션")
      .selectOption(passcodeSession.session.sessionId);
    const resultPreview = page.getByLabel("결과 장표 미리보기", {
      exact: true
    });
    await expect(resultPreview).toHaveAttribute("data-state", "presenter-live");
    await expect(
      resultPreview.getByRole("listitem").filter({ hasText: privateText })
    ).toBeVisible();
    await expect(resultPreview.getByText("응답 1개", { exact: true })).toBeVisible();

    await expectOk(
      await page.request.post(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/presentation-sessions/${encodeURIComponent(passcodeSession.session.sessionId)}/close`,
        { data: {} }
      )
    );
    await page.goto(
      `/project/${encodeURIComponent(project.projectId)}/presentation-sessions/${encodeURIComponent(passcodeSession.session.sessionId)}/results`
    );
    await expect(page.getByText("응답", { exact: true })).toBeVisible();
    await expect(page.getByText(privateText, { exact: true })).toBeVisible();

    const exportJob = await expectJson<{ job: Job }>(
      await page.request.post(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck/exports`,
        {
          data: {
            format: "pptx",
            presentationSessionId: passcodeSession.session.sessionId
          }
        }
      )
    );
    const completedExport = await pollJob(page, exportJob.job.jobId, 90_000);
    expect(completedExport.status).toBe("succeeded");
    expect(completedExport.result).toEqual(
      expect.objectContaining({ deckId: deck.deckId, format: "pptx" })
    );
    const exportUrl = completedExport.result?.url;
    expect(typeof exportUrl).toBe("string");
    if (typeof exportUrl === "string") {
      const exported = await page.request.get(exportUrl);
      expect(exported.ok(), await exported.text()).toBe(true);
      const bytes = await exported.body();
      expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    }

    const pngExportJob = await expectJson<{ job: Job }>(
      await page.request.post(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/deck/exports`,
        {
          data: {
            format: "png",
            presentationSessionId: passcodeSession.session.sessionId
          }
        }
      )
    );
    const completedPngExport = await pollJob(
      page,
      pngExportJob.job.jobId,
      120_000
    );
    expect(completedPngExport.status).toBe("succeeded");
    expect(completedPngExport.result).toEqual(
      expect.objectContaining({ deckId: deck.deckId, format: "png" })
    );
    const pngExportUrl = completedPngExport.result?.url;
    expect(typeof pngExportUrl).toBe("string");
    if (typeof pngExportUrl === "string") {
      const exported = await page.request.get(pngExportUrl);
      expect(exported.ok(), await exported.text()).toBe(true);
      expect(exported.headers()["content-type"]).toContain("application/zip");
      const bytes = await exported.body();
      expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    }

    const publicSession = await createSession(page, project.projectId, {
      accessMode: "public",
      deckId: deck.deckId
    });
    await ensureAndOpenRun(
      page,
      project.projectId,
      publicSession.session.sessionId,
      activityId
    );
    const isolated = await mobileContext.request.get(
      `/api/v1/audience-sessions/${encodeURIComponent(publicSession.session.sessionId)}/activities/${encodeURIComponent(activityId)}`
    );
    expect(isolated.status()).toBe(401);

    const desktopContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { height: 768, width: 1024 }
    });
    const desktopAudience = await desktopContext.newPage();
    await desktopAudience.goto(
      `/audience/${encodeURIComponent(publicSession.session.sessionId)}/a/${encodeURIComponent(activityId)}`
    );
    await expect(desktopAudience.getByLabel("4자리 입장 비밀번호")).toHaveCount(0);
    await desktopAudience.getByRole("button", { name: "입장하기" }).click();
    await expect(
      desktopAudience.getByRole("heading", { name: "E2E 만족도" })
    ).toBeVisible();

    await makeRetentionDue(passcodeSession.session.sessionId);
    const retentionJobId = `job_activity_retention_${passcodeSession.session.sessionId}`;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/v1/jobs/${encodeURIComponent(retentionJobId)}`
          );
          if (response.status() === 404) return "missing";
          const job = await expectJson<Job>(response);
          return job.status;
        },
        { timeout: 45_000 }
      )
      .toBe("succeeded");
    const retained = await pool.query<{
      raw_responses_deleted_at: Date | null;
      participant_rows: string;
      response_rows: string;
      snapshot_rows: string;
    }>(
      `
        SELECT sessions.raw_responses_deleted_at,
          (SELECT count(*)::text FROM presentation_session_audiences audiences
            WHERE audiences.session_id = sessions.session_id) AS participant_rows,
          (SELECT count(*)::text FROM activity_responses responses
            INNER JOIN activity_runs runs
              ON runs.activity_run_id = responses.activity_run_id
            WHERE runs.session_id = sessions.session_id) AS response_rows,
          (SELECT count(*)::text FROM activity_result_snapshots snapshots
            WHERE snapshots.session_id = sessions.session_id) AS snapshot_rows
        FROM presentation_sessions sessions
        WHERE sessions.session_id = $1
      `,
      [passcodeSession.session.sessionId]
    );
    expect(retained.rows[0]?.raw_responses_deleted_at).not.toBeNull();
    expect(Number(retained.rows[0]?.participant_rows)).toBe(0);
    expect(Number(retained.rows[0]?.response_rows)).toBe(0);
    expect(Number(retained.rows[0]?.snapshot_rows)).toBe(1);
    await page.goto(
      `/project/${encodeURIComponent(project.projectId)}/presentation-sessions/${encodeURIComponent(passcodeSession.session.sessionId)}/results`
    );
    await expect(page.getByText("집계 전용 결과입니다.")).toBeVisible();
    expect(await page.content()).not.toContain(privateDisplayName);

    await Promise.all([
      mobileContext.close(),
      privateContext.close(),
      desktopContext.close()
    ]);
  });
});

function createActivityDeck(): Deck {
  const base = createDemoDeck();
  const activity = createActivitySlide(base, "satisfaction", {
    title: "E2E 만족도"
  });
  activity.activity.allowDisplayName = true;
  const withActivity = { ...base, slides: [activity] } as Deck;
  const result = createActivityResultsSlide(
    withActivity,
    activity.activity.activityId,
    "approved-text"
  );
  return {
    ...base,
    title: "Activity E2E Deck",
    slides: [activity, result]
  };
}

async function createSession(
  page: Page,
  projectId: string,
  input:
    | { accessMode: "passcode"; deckId: string; passcode: string }
    | { accessMode: "public"; deckId: string }
) {
  return expectJson<{
    audienceUrl: string;
    session: { deckVersion: number; sessionId: string };
  }>(
    await page.request.post(
      `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-sessions`,
      { data: input }
    )
  );
}

async function ensureAndOpenRun(
  page: Page,
  projectId: string,
  sessionId: string,
  activityId: string
) {
  const ensured = await expectJson<{ run: ActivityRunView }>(
    await page.request.put(
      `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-sessions/${encodeURIComponent(sessionId)}/activities/${encodeURIComponent(activityId)}/current-run`,
      { data: {} }
    )
  );
  return updateRunStatus(
    page,
    projectId,
    sessionId,
    ensured.run.activityRunId,
    "open",
    ensured.run.revision
  );
}

async function updateRunStatus(
  page: Page,
  projectId: string,
  sessionId: string,
  runId: string,
  status: "open" | "closed" | "results",
  expectedRevision: number
): Promise<ActivityRunView> {
  const response = await expectJson<{ run: ActivityRunView }>(
    await page.request.patch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-sessions/${encodeURIComponent(sessionId)}/activity-runs/${encodeURIComponent(runId)}/status`,
      { data: { expectedRevision, status } }
    )
  );
  return response.run;
}

async function getPresenterResult(
  page: Page,
  projectId: string,
  sessionId: string,
  runId: string
) {
  return expectJson<{
    result: {
      participantCount: number;
      responseRate: number;
      revision: number;
      textEntries: Array<{
        displayName: string | null;
        moderationStatus: string;
        text: string;
      }>;
    };
  }>(
    await page.request.get(
      `/api/v1/projects/${encodeURIComponent(projectId)}/presentation-sessions/${encodeURIComponent(sessionId)}/activity-runs/${encodeURIComponent(runId)}/results`
    )
  );
}

async function pollJob(page: Page, jobId: string, timeoutMs: number): Promise<Job> {
  let latest: Job | null = null;
  await expect
    .poll(
      async () => {
        latest = await expectJson<Job>(
          await page.request.get(`/api/v1/jobs/${encodeURIComponent(jobId)}`)
        );
        return latest.status;
      },
      { timeout: timeoutMs }
    )
    .toMatch(/^(succeeded|failed)$/);
  if (!latest) throw new Error("Export job was not loaded");
  return latest;
}

async function makeRetentionDue(sessionId: string): Promise<void> {
  await pool.query(
    `
      UPDATE presentation_sessions
      SET raw_responses_delete_after = now() - interval '1 minute',
          raw_responses_deleted_at = NULL
      WHERE session_id = $1 AND status = 'ended'
    `,
    [sessionId]
  );
}

async function expectOk(response: APIResponse): Promise<void> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
}

async function expectJson<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

type ActivityRunView = {
  activityRunId: string;
  revision: number;
};
