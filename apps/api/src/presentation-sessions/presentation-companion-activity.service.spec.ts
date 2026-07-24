import { describe, expect, it, vi } from "vitest";

import type { ActivityResultsService } from "../activities/activity-results.service";
import type { ActivityRunsService } from "../activities/activity-runs.service";
import type { CompanionAccessTokenPayload } from "./companion-access-cookie";
import type { PresentationSessionsService } from "./presentation-sessions.service";
import { PresentationCompanionActivityService } from "./presentation-companion-activity.service";

const credential = {
  sessionId: "session_1",
  projectId: "project_1",
} as CompanionAccessTokenPayload;

describe("PresentationCompanionActivityService", () => {
  it("returns an empty public projection without creating an activity run", async () => {
    const fixture = createFixture(null);

    await expect(
      fixture.service.getProjection(credential, "activity_1"),
    ).resolves.toEqual({
      activityId: "activity_1",
      audienceUrl: null,
      run: null,
      publicResult: null,
    });
    expect(fixture.runs.getCurrentRun).toHaveBeenCalledWith(
      "project_1",
      "session_1",
      "activity_1",
    );
    expect(fixture.results.getPublicResult).not.toHaveBeenCalled();
    expect(fixture.runs).not.toHaveProperty("ensureCurrentRun");
  });

  it("hides activity access after audience access is disabled", async () => {
    const fixture = createFixture(
      {
        activityRunId: "activity_run_1",
        status: "results",
      },
      false,
    );

    await expect(
      fixture.service.getProjection(credential, "activity_1"),
    ).resolves.toEqual({
      activityId: "activity_1",
      audienceUrl: null,
      run: null,
      publicResult: null,
    });
    expect(fixture.runs.getCurrentRun).not.toHaveBeenCalled();
    expect(fixture.results.getPublicResult).not.toHaveBeenCalled();
  });

  it("returns only the current run status and public result", async () => {
    const fixture = createFixture({
      activityRunId: "activity_run_1",
      status: "results",
    });
    vi.mocked(fixture.results.getPublicResult).mockResolvedValue({
      result: {
        activityRunId: "activity_run_1",
        activityId: "activity_1",
        status: "results",
        revision: 4,
        responseCount: 2,
        aggregates: [],
        approvedTextEntries: [],
      },
    });

    await expect(
      fixture.service.getProjection(credential, "activity_1"),
    ).resolves.toEqual({
      activityId: "activity_1",
      audienceUrl: "/audience/session_1/a/activity_1",
      run: { status: "results" },
      publicResult: expect.objectContaining({
        activityRunId: "activity_run_1",
        activityId: "activity_1",
      }),
    });
    expect(fixture.results.getPublicResult).toHaveBeenCalledWith(
      "project_1",
      "session_1",
      "activity_run_1",
    );
  });

  it("rejects an invalid activity identifier before storage access", async () => {
    const fixture = createFixture(null);

    await expect(
      fixture.service.getProjection(credential, "../private"),
    ).rejects.toMatchObject({
      message: "Presentation companion activity unavailable",
    });
    expect(fixture.runs.getCurrentRun).not.toHaveBeenCalled();
  });
});

function createFixture(
  run: { activityRunId: string; status: "results" } | null,
  audienceAccessEnabled = true,
) {
  const runs = {
    getCurrentRun: vi.fn().mockResolvedValue({ run }),
  } as unknown as ActivityRunsService;
  const results = {
    getPublicResult: vi.fn(),
  } as unknown as ActivityResultsService;
  const sessions = {
    getSessionForPresenter: vi.fn().mockResolvedValue({
      audienceAccessEnabled,
    }),
  } as unknown as PresentationSessionsService;
  return {
    results,
    runs,
    service: new PresentationCompanionActivityService(
      runs,
      results,
      sessions,
    ),
    sessions,
  };
}
