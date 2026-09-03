import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";

const enabled = process.env.RUN_MIXED_LIFECYCLE === "true";
const repositoryRoot = process.cwd();
const loadRoot = path.join(repositoryRoot, "tests/load");
const pptxFixture = path.join(
  repositoryRoot,
  "services/python-worker/tests/fixtures/pptx/import-fidelity-notes.pptx",
);

type Job = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
};

type ActivityDefinition = {
  activityId: string;
  template: "pre-question" | "poll" | "satisfaction";
  title: string;
  questions: Array<{
    maxSelections?: number;
    options?: Array<{ optionId: string }>;
    questionId: string;
    required: boolean;
    type: "rating" | "single-choice" | "multiple-choice" | "free-text";
  }>;
};

type Deck = {
  deckId: string;
  projectId: string;
  slides: Array<{
    activity?: ActivityDefinition;
    kind?: string;
    slideId: string;
    speakerNotes: string;
  }>;
  version: number;
};

type ActivityRuntime = ActivityDefinition & { activityRunId: string };

type ResourceResult = {
  resources: {
    activityIds: string[];
    jobIds: string[];
    projectIds: string[];
    runIds: string[];
    sessionIds: string[];
  };
  results: string[];
};

test.describe("Orbit mixed user lifecycle", () => {
  test.skip(!enabled, "전용 혼합 테스트 실행기에서만 실행합니다.");

  test("covers create, import, export, rehearsal, presentation, and audience participation", async ({
    browser,
  }) => {
    test.setTimeout(20 * 60_000);
    const profile = requiredEnvironment("MIXED_PROFILE");
    const ownerContexts = profile === "average" ? 5 : 1;
    const audienceVus = profile === "average" ? 50 : 10;
    const baseUrl = new URL(requiredEnvironment("BASE_URL")).origin;
    const runId = requiredEnvironment("RUN_ID");
    const resultsDirectory = requiredEnvironment("MIXED_RESULTS_DIR");
    const activityRuntimePath = requiredEnvironment(
      "MIXED_ACTIVITY_RUNTIME_PATH",
    );
    const k6RuntimePath = requiredEnvironment("MIXED_K6_RUNTIME_PATH");
    const processHandles: MixedLoadProcesses[] = [];
    const contexts: BrowserContext[] = [];
    await mkdir(resultsDirectory, { recursive: true });

    const loginContext = await browser.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: bypassHeaders(),
      permissions: ["microphone"],
    });
    try {
      const loginPage = await loginContext.newPage();
      await loginAsDedicatedOwner(loginPage);
      const storageState = await loginContext.storageState();
      const cookies = await loginContext.cookies(baseUrl);
      const authCookie = cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
      expect(authCookie).not.toBe("");

      for (let index = 0; index < ownerContexts; index += 1) {
        contexts.push(
          await browser.newContext({
            acceptDownloads: true,
            baseURL: baseUrl,
            extraHTTPHeaders: bypassHeaders(),
            permissions: ["microphone"],
            storageState,
          }),
        );
      }
      const pages = await Promise.all(
        contexts.map((context) => context.newPage()),
      );
      const ownerPage = (index: number) => pages[index % pages.length];

      const ai = await createAiDeck(ownerPage(0), runId);
      const imported = await importPptxDeck(ownerPage(1), runId);
      const exported = await editReloadAndExport(
        ownerPage(2),
        imported.projectId,
        runId,
        resultsDirectory,
      );
      const rehearsal = await runFullRehearsal(ownerPage(3), ai.projectId);
      const presentationSetup = await addActivitiesAndOpenAudience(
        ownerPage(4),
        imported.projectId,
        runId,
      );
      const livePresentation = await startLivePresentation(
        ownerPage(4),
        imported.projectId,
        presentationSetup.deckId,
        presentationSetup.activityDefinitions,
        presentationSetup.passcode,
      );

      await writeFile(
        activityRuntimePath,
        JSON.stringify({ activities: livePresentation.activities }),
        { mode: 0o600 },
      );
      await writeFile(
        k6RuntimePath,
        JSON.stringify({
          jobIds: [
            ai.jobId,
            imported.jobId,
            ...exported.jobIds,
            rehearsal.jobId,
          ],
          presentation: {
            deckId: presentationSetup.deckId,
            projectId: imported.projectId,
            sessionId: livePresentation.sessionId,
          },
          projectIds: [ai.projectId, imported.projectId],
          reportPaths: [
            `/api/v1/rehearsals/${encodeURIComponent(rehearsal.runId)}/report`,
          ],
          runId,
          workspaceId: "workspace_demo_1",
        }),
        { mode: 0o600 },
      );

      const loadProcesses = startMixedLoadProcesses({
        activityRuntimePath,
        audiencePasscode: presentationSetup.passcode,
        authCookie,
        k6RuntimePath,
        profile,
        projectId: imported.projectId,
        resultsDirectory,
        sessionId: livePresentation.sessionId,
      });
      processHandles.push(loadProcesses);

      const presentation = await completeLivePresentation(
        ownerPage(4),
        imported.projectId,
        livePresentation.sessionId,
        livePresentation.activities,
        audienceVus,
      );
      await loadProcesses.done;

      const sessionResults = await getJson<{
        activities: Array<{ result: { responseCount: number } | null }>;
      }>(
        ownerPage(4),
        `/api/v1/projects/${encodeURIComponent(imported.projectId)}/presentation-sessions/${encodeURIComponent(livePresentation.sessionId)}/results`,
      );
      expect(sessionResults.activities).toHaveLength(3);
      for (const activity of sessionResults.activities) {
        expect(activity.result?.responseCount).toBe(audienceVus);
      }

      const resourceResult: ResourceResult = {
        resources: {
          activityIds: livePresentation.activities.map(
            (activity) => activity.activityId,
          ),
          jobIds: unique([
            ai.jobId,
            imported.jobId,
            ...exported.jobIds,
            rehearsal.jobId,
            presentation.jobId,
          ]),
          projectIds: [ai.projectId, imported.projectId],
          runIds: unique([
            rehearsal.runId,
            presentation.runId,
            ...livePresentation.activities.map(
              (activity) => activity.activityRunId,
            ),
          ]),
          sessionIds: unique([
            presentationSetup.preflightAudienceSessionId,
            livePresentation.sessionId,
          ]),
        },
        results: [
          ...exported.resultFiles,
          "artillery-report.json",
          "k6-summary.json",
        ],
      };
      await writeFile(
        path.join(resultsDirectory, "resources.json"),
        `${JSON.stringify(resourceResult, null, 2)}\n`,
      );
    } finally {
      for (const processes of processHandles) processes.stop();
      await Promise.all(contexts.map((context) => context.close()));
      await loginContext.close();
    }
  });
});

async function loginAsDedicatedOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(requiredEnvironment("MIXED_TEST_EMAIL"));
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(requiredEnvironment("MIXED_TEST_PASSWORD"));
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/project");
  await expect(
    page.getByRole("button", { name: "PPTX 업로드", exact: true }),
  ).toBeVisible();
}

async function createAiDeck(page: Page, runId: string) {
  await page.route("**/api/v1/projects/*/jobs/generate-deck", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as Record<string, unknown>;
    await route.continue({
      headers: { ...request.headers(), "content-type": "application/json" },
      postData: JSON.stringify({
        ...payload,
        slideCountRange: { min: 5, max: 5 },
        targetDurationMinutes: 3,
      }),
    });
  });
  await page.goto("/createdeck");
  await page.getByLabel("발표 주제").fill(`[${runId}] 혼합 테스트 발표`);
  await page.getByLabel("타깃 청중").fill("staging 혼합 테스트 청중");
  await page
    .getByLabel("상세 내용 및 컨텍스트")
    .fill("3분 발표, 정확히 5장. Orbit 핵심 사용자 여정을 설명합니다.");
  for (const label of ["웹 리서치 허용", "AI 이미지 사용"]) {
    const checkbox = page.getByLabel(label);
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  const queuedPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/jobs/generate-deck"),
  );
  await page.getByRole("button", { name: /다음 단계/ }).click();
  const queuedResponse = await queuedPromise;
  await expectResponseOk(queuedResponse);
  const queued = (await queuedResponse.json()) as { job: Job };
  const match = new URL(queuedResponse.url()).pathname.match(
    /\/projects\/([^/]+)\/jobs\/generate-deck$/,
  );
  if (!match) throw new Error("AI projectId를 확인하지 못했습니다.");
  const projectId = decodeURIComponent(match[1]);
  await expect(page).toHaveURL(/\/style-color\//, { timeout: 180_000 });
  await page.getByRole("button", { name: "슬라이드 생성" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/project/${escapeRegex(projectId)}$`),
    { timeout: 300_000 },
  );
  const job = await waitForJob(page, queued.job.jobId);
  expect(job.status).toBe("succeeded");
  const deck = await getDeck(page, projectId);
  expect(deck.slides).toHaveLength(5);
  await page.unroute("**/api/v1/projects/*/jobs/generate-deck");
  return { jobId: job.jobId, projectId };
}

async function importPptxDeck(page: Page, runId: string) {
  await page.goto("/project");
  const projectPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/workspace_demo_1\/projects$/.test(
        new URL(response.url()).pathname,
      ),
  );
  const importJobPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/pptx-ooxml-generations"),
  );
  await page.getByLabel("PPTX 파일 선택").setInputFiles(pptxFixture);
  const dialog = page.getByRole("dialog", { name: "PPTX 가져오기 방식" });
  await dialog.getByRole("radio", { name: /내용 편집하기/ }).check();
  await dialog.getByRole("button", { name: "가져오기 시작" }).click();
  const [projectResponse, importJobResponse] = await Promise.all([
    projectPromise,
    importJobPromise,
  ]);
  await expectResponseOk(projectResponse);
  await expectResponseOk(importJobResponse);
  const project = (await projectResponse.json()) as { projectId: string };
  const queued = (await importJobResponse.json()) as { job: Job };
  await expect(
    page
      .getByRole("complementary", { name: "백그라운드 작업" })
      .getByText("백그라운드 작업 완료"),
  ).toBeVisible({ timeout: 300_000 });
  const job = await waitForJob(page, queued.job.jobId);
  expect(job.status).toBe("succeeded");
  await patchProjectTitle(
    page,
    project.projectId,
    `[${runId}] PPTX 혼합 테스트`,
  );
  await page.goto(`/project/${encodeURIComponent(project.projectId)}`);
  await expect(page.getByLabel("Presentation editor")).toBeVisible();
  return { jobId: job.jobId, projectId: project.projectId };
}

async function editReloadAndExport(
  page: Page,
  projectId: string,
  runId: string,
  resultsDirectory: string,
) {
  await page.goto(`/project/${encodeURIComponent(projectId)}`);
  await expect(page.getByLabel("Presentation editor")).toBeVisible();
  const expandNotes = page.getByLabel("발표 메모 펼치기");
  if (await expandNotes.isVisible()) await expandNotes.click();
  await page
    .getByRole("group", { name: /대본\. 더블클릭하거나 Enter 키를 눌러 편집/ })
    .dblclick();
  const notes = `혼합 테스트 ${runId} 저장 및 새로고침 확인 메모`;
  await page.getByLabel("발표 메모 수정").fill(notes);
  await page.getByLabel("메모 저장").click();
  await saveEditor(page);
  await page.reload();
  await expect(page.getByText(notes, { exact: true })).toBeVisible();

  const jobIds: string[] = [];
  const resultFiles: string[] = [];
  for (const [menuItem, formatName, fileName] of [
    ["PPTX 내보내기...", "PPTX", "deck-export.pptx"],
    ["PNG ZIP 내보내기...", "PNG ZIP", "deck-export-png.zip"],
  ] as const) {
    const { download, jobId } = await exportFromDialog(
      page,
      menuItem,
      formatName,
    );
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    await writeFile(path.join(resultsDirectory, fileName), bytes);
    jobIds.push(jobId);
    resultFiles.push(fileName);
  }
  return { jobIds, resultFiles };
}

async function runFullRehearsal(page: Page, projectId: string) {
  await page.goto(`/project/${encodeURIComponent(projectId)}`);
  await page.getByLabel("발표 메뉴 열기").click();
  await page.getByRole("menuitem", { name: "전체 리허설" }).click();
  await expect(
    page.getByRole("heading", { name: "리허설을 시작할까요?" }),
  ).toBeVisible();
  const permission = page.getByRole("button", { name: "마이크 권한 허용" });
  if (await permission.isVisible()) await permission.click();
  await page.getByRole("button", { name: "리허설 시작", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "리허설 타이머" }),
  ).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: "리허설 마치기" }).click();
  await expect(
    page.getByRole("heading", { name: "리포트 생성이 완료되었습니다" }),
  ).toBeVisible({ timeout: 300_000 });
  await page.getByRole("button", { name: "리허설 마치기" }).click();
  await expect(page).toHaveURL(/\/rehearsal\/[^/]+\/report\/([^/?#]+)/);
  const runId = decodeURIComponent(
    new URL(page.url()).pathname.split("/").at(-1) ?? "",
  );
  const run = await waitForRun(page, `/api/v1/rehearsals/${segment(runId)}`);
  expect(run.status).toBe("succeeded");
  expect(run.jobId).toBeTruthy();
  await expect(page.getByText("전체 리허설 리포트")).toBeVisible();
  return { jobId: String(run.jobId), runId };
}

async function addActivitiesAndOpenAudience(
  page: Page,
  projectId: string,
  runId: string,
) {
  await page.goto(`/project/${segment(projectId)}`);
  for (const label of ["사전 질문", "실시간 투표", "만족도 조사"]) {
    await page.getByLabel("추가할 슬라이드 유형 선택").click();
    await page.getByRole("menuitem", { name: new RegExp(label) }).click();
  }
  await saveEditor(page);
  const deck = await getDeck(page, projectId);
  const activityDefinitions = deck.slides.flatMap((slide) =>
    slide.kind === "activity" && slide.activity ? [slide.activity] : [],
  );
  expect(activityDefinitions.map((activity) => activity.template)).toEqual([
    "pre-question",
    "poll",
    "satisfaction",
  ]);

  const passcode = "4826";
  await page.getByLabel("발표 메뉴 열기").click();
  await page.getByText("청중 링크·QR", { exact: true }).click();
  const audienceDialog = page.getByRole("dialog", { name: "청중 링크와 QR" });
  await audienceDialog.getByLabel("4자리 입장 비밀번호").fill(passcode);
  const sessionPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/presentation-sessions"),
  );
  await audienceDialog.getByRole("button", { name: "QR코드 생성" }).click();
  const sessionResponse = await sessionPromise;
  await expectResponseOk(sessionResponse);
  const sessionPayload = (await sessionResponse.json()) as {
    session: { sessionId: string };
  };
  await expect(audienceDialog.getByText("입장 열림")).toBeVisible();
  await audienceDialog.getByRole("button", { name: "닫기" }).click();

  await patchProjectTitle(page, projectId, `[${runId}] 발표·청중 혼합 테스트`);
  return {
    activityDefinitions,
    deckId: deck.deckId,
    passcode,
    preflightAudienceSessionId: sessionPayload.session.sessionId,
  };
}

async function startLivePresentation(
  page: Page,
  projectId: string,
  deckId: string,
  activityDefinitions: ActivityDefinition[],
  passcode: string,
) {
  await page.goto(`/project/${segment(projectId)}`);
  await page.getByLabel("발표 메뉴 열기").click();
  await page.getByRole("menuitem", { name: "발표 시작" }).click();
  await expect(
    page.getByRole("heading", { name: "발표 전 마이크를 확인해 주세요" }),
  ).toBeVisible();
  const permission = page.getByRole("button", { name: "마이크 권한 허용" });
  if (await permission.isVisible()) await permission.click();
  await page.getByRole("button", { name: "발표 시작", exact: true }).click();
  await expect(page.getByText("발표 · 스크립트와 타이머")).toBeVisible();

  const current = await getJson<{
    session: { deckId: string; sessionId: string } | null;
  }>(
    page,
    `/api/v1/projects/${segment(projectId)}/presentation-sessions/current?deckId=${encodeURIComponent(deckId)}&sessionPurpose=presentation`,
  );
  if (!current.session) {
    throw new Error("발표 시작 후 현재 presentation session이 없습니다.");
  }
  expect(current.session.deckId).toBe(deckId);
  const sessionId = current.session.sessionId;
  const startsAt = new Date();
  const accessResponse = await page.request.patch(
    `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(sessionId)}/access`,
    {
      data: {
        accessMode: "passcode",
        audienceAccessEnabled: true,
        expiresAt: new Date(
          startsAt.getTime() + 24 * 60 * 60 * 1_000,
        ).toISOString(),
        passcode,
        startsAt: startsAt.toISOString(),
      },
    },
  );
  await expectResponseOk(accessResponse);

  const activities: ActivityRuntime[] = [];
  for (const definition of activityDefinitions) {
    const response = await page.request.put(
      `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(sessionId)}/activities/${segment(definition.activityId)}/current-run`,
      { data: {} },
    );
    await expectResponseOk(response);
    const payload = (await response.json()) as {
      run: { activityRunId: string; status: string };
    };
    expect(payload.run.status).toBe("draft");
    activities.push({
      ...definition,
      activityRunId: payload.run.activityRunId,
    });
  }
  return { activities, sessionId };
}

async function completeLivePresentation(
  page: Page,
  projectId: string,
  sessionId: string,
  activities: ActivityRuntime[],
  audienceVus: number,
) {
  for (const [activityIndex, activity] of activities.entries()) {
    const panel = page.getByRole("region", { name: "참여 장표 운영" });
    while (
      !(await panel.getByText(activity.title, { exact: true }).isVisible())
    ) {
      await page.getByRole("button", { name: "다음 슬라이드" }).click();
      await page.waitForTimeout(250);
    }
    await expect(panel.getByText("응답 중")).toBeVisible({ timeout: 60_000 });
    await expect(
      panel
        .locator(".activity-presenter-metrics")
        .getByText(String(audienceVus), { exact: true }),
    ).toBeVisible({ timeout: 300_000 });

    let approvedText = "";
    let hiddenText = "";
    if (activity.template === "pre-question") {
      const entries = panel.locator('[aria-label="제출된 주관식 답변"] li');
      await expect(entries).toHaveCount(audienceVus);
      approvedText = await entries.nth(0).locator("p").innerText();
      hiddenText = await entries.nth(1).locator("p").innerText();
      await entries.nth(0).getByRole("button", { name: "승인" }).click();
      await entries.nth(1).getByRole("button", { name: "숨김" }).click();
      await expect(
        entries.nth(0).getByText("공개", { exact: true }),
      ).toBeVisible();
      await expect(
        entries.nth(1).getByText("숨김", { exact: true }),
      ).toBeVisible();
    }
    await panel.getByRole("button", { name: "응답 마감" }).click();
    await panel.getByRole("button", { name: "결과 공개" }).click();
    await expect(
      panel.locator(".activity-presenter-status").getByText("결과 공개", {
        exact: true,
      }),
    ).toBeVisible();

    if (activity.template === "pre-question") {
      const publicResult = await getJson<{ result: unknown }>(
        page,
        `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(sessionId)}/activity-runs/${segment(activity.activityRunId)}/public-results`,
      );
      const publicJson = JSON.stringify(publicResult);
      expect(publicJson).toContain(approvedText);
      expect(publicJson).not.toContain(hiddenText);
    }
    if (activityIndex < activities.length - 1) {
      await page.getByRole("button", { name: "다음 슬라이드" }).click();
    }
  }

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "발표 종료" }).click();
  await expect(
    page.getByRole("heading", { name: "발표를 마쳤어요" }),
  ).toBeVisible({
    timeout: 300_000,
  });
  await page.getByRole("button", { name: "리포트 보기" }).click();
  await expect(page).toHaveURL(/\/presentation\/[^/]+\/report\/[^?]+\?runId=/);
  await expect(
    page.getByRole("heading", { name: "발표 리포트" }),
  ).toBeVisible();
  const url = new URL(page.url());
  const reportSessionId = decodeURIComponent(
    url.pathname.split("/").at(-1) ?? "",
  );
  expect(reportSessionId).toBe(sessionId);
  const runId = url.searchParams.get("runId") ?? "";
  const run = await waitForRun(
    page,
    `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(reportSessionId)}/runs/${segment(runId)}`,
  );
  expect(run.status).toBe("succeeded");
  expect(run.jobId).toBeTruthy();
  return { jobId: String(run.jobId), runId };
}

function startMixedLoadProcesses(input: {
  activityRuntimePath: string;
  audiencePasscode: string;
  authCookie: string;
  k6RuntimePath: string;
  profile: string;
  projectId: string;
  resultsDirectory: string;
  sessionId: string;
}): MixedLoadProcesses {
  const commonEnvironment = {
    ...process.env,
    LOAD_PROFILE: input.profile,
    MIXED_PROFILE: input.profile,
  };
  const artillery = spawn(
    process.execPath,
    [
      path.join(loadRoot, "node_modules/artillery/bin/run"),
      "run",
      path.join(loadRoot, `artillery/mixed-${input.profile}.yml`),
      "--output",
      path.join(input.resultsDirectory, "artillery-report.json"),
    ],
    {
      cwd: path.join(loadRoot, "artillery"),
      env: {
        ...commonEnvironment,
        AUDIENCE_PASSCODE: input.audiencePasscode,
        MIXED_ACTIVITY_RUNTIME_PATH: input.activityRuntimePath,
        PROJECT_ID: input.projectId,
        SESSION_ID: input.sessionId,
      },
      stdio: "inherit",
    },
  );
  const k6 = spawn(
    "k6",
    ["run", path.join(loadRoot, "k6/mixed-background.js")],
    {
      cwd: loadRoot,
      env: {
        ...commonEnvironment,
        AUTH_COOKIE: input.authCookie,
        K6_OUT: "experimental-prometheus-rw",
        MIXED_K6_RUNTIME_PATH: input.k6RuntimePath,
        SUMMARY_PATH: path.join(input.resultsDirectory, "k6-summary.json"),
      },
      stdio: "inherit",
    },
  );
  const done = Promise.all([
    waitForChild(artillery, "Artillery"),
    waitForChild(k6, "k6"),
  ]).then(() => undefined);
  void done.catch(() => undefined);
  return {
    done,
    stop() {
      for (const child of [artillery, k6]) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
        }
      }
    },
  };
}

type MixedLoadProcesses = {
  done: Promise<void>;
  stop: () => void;
};

function waitForChild(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${label} failed (${signal ?? code ?? "unknown"})`));
    });
  });
}

async function exportFromDialog(
  page: Page,
  menuItem: string,
  formatName: string,
): Promise<{ download: Download; jobId: string }> {
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .getByRole("menuitem", { name: new RegExp(`^${escapeRegex(menuItem)}`) })
    .click();
  const dialog = page.getByRole("dialog", { name: "프레젠테이션 내보내기" });
  await dialog
    .getByRole("radio", { name: new RegExp(`^${formatName}`) })
    .check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/deck/exports"),
  );
  const downloadPromise = page.waitForEvent("download", { timeout: 300_000 });
  await dialog.getByRole("button", { name: "내보내기", exact: true }).click();
  const response = await responsePromise;
  await expectResponseOk(response);
  const payload = (await response.json()) as { job: Job };
  const download = await downloadPromise;
  const job = await waitForJob(page, payload.job.jobId);
  expect(job.status).toBe("succeeded");
  return { download, jobId: job.jobId };
}

async function saveEditor(page: Page) {
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page.getByRole("menuitem", { name: /^저장/ }).click();
  await expect(
    page.locator(".editor-document-title").getByText("저장됨", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
}

async function waitForJob(page: Page, jobId: string): Promise<Job> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const job = await getJson<Job>(page, `/api/v1/jobs/${segment(jobId)}`);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await page.waitForTimeout(500);
  }
  throw new Error(`Job did not finish: ${jobId}`);
}

async function waitForRun(
  page: Page,
  url: string,
): Promise<{ jobId: string | null; status: string }> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const payload = await getJson<{
      run?: { jobId: string | null; status: string };
      jobId?: string | null;
      status?: string;
    }>(page, url);
    const run = payload.run ?? {
      jobId: payload.jobId ?? null,
      status: payload.status ?? "",
    };
    if (run.status === "succeeded" || run.status === "failed") {
      return { jobId: run.jobId ?? null, status: run.status };
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Run did not finish.");
}

async function getDeck(page: Page, projectId: string): Promise<Deck> {
  const payload = await getJson<{ deck: Deck }>(
    page,
    `/api/v1/projects/${segment(projectId)}/deck`,
  );
  return payload.deck;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  await expectResponseOk(response);
  return (await response.json()) as T;
}

async function patchProjectTitle(page: Page, projectId: string, title: string) {
  const response = await page.request.patch(
    `/api/v1/workspaces/workspace_demo_1/projects/${segment(projectId)}`,
    { data: { title } },
  );
  await expectResponseOk(response);
}

async function expectResponseOk(response: Pick<APIResponse, "ok" | "text">) {
  expect(response.ok(), await response.text()).toBe(true);
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const downloadPath = await download.path();
  if (!downloadPath)
    throw new Error("Downloaded artifact path is unavailable.");
  return readFile(downloadPath);
}

function bypassHeaders() {
  return {
    "x-orbit-load-test-token": requiredEnvironment(
      "LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN",
    ),
  };
}

function requiredEnvironment(key: string, fallback?: string) {
  const value = process.env[key] || fallback;
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function segment(value: string) {
  return encodeURIComponent(value);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
