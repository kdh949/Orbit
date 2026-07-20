import { describe, expect, it } from "vitest";

import {
  activityRetentionSnapshotSchema,
  activityResponseRetentionJobPayloadSchema,
  activityResponseRetentionJobResultSchema,
} from "./activity-retention.schema";

describe("activity response retention contracts", () => {
  it("accepts an internal session retention job and result", () => {
    expect(
      activityResponseRetentionJobPayloadSchema.parse({
        jobId: "job_activity_retention_session_1",
        projectId: "project_1",
        presentationSessionId: "session_1",
      }),
    ).toMatchObject({ presentationSessionId: "session_1" });
    expect(
      activityResponseRetentionJobResultSchema.parse({
        presentationSessionId: "session_1",
        outcome: "retained-aggregate",
        snapshotCount: 2,
        deletedResponseCount: 10,
      }),
    ).toMatchObject({ snapshotCount: 2, deletedResponseCount: 10 });
  });

  it("rejects unknown retention payload fields", () => {
    expect(
      activityResponseRetentionJobPayloadSchema.safeParse({
        jobId: "job_1",
        projectId: "project_1",
        presentationSessionId: "session_1",
        rawResponse: "must-not-be-queued",
      }).success,
    ).toBe(false);
  });

  it("rejects retention snapshots containing free-text entries", () => {
    const snapshot = {
      activityRunId: "activity_run_1",
      activityId: "activity_1",
      status: "closed",
      revision: 1,
      responseCount: 1,
      participantCount: 1,
      responseRate: 100,
      aggregates: [],
      textEntries: [
        {
          entryId: "activity_text_1",
          questionId: "question_1",
          text: "must be deleted",
          displayName: null,
          moderationStatus: "approved",
          answeredAt: null,
          updatedAt: "2026-07-17T00:00:00.000Z",
        },
      ],
    };

    expect(activityRetentionSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(
      activityRetentionSnapshotSchema.parse({ ...snapshot, textEntries: [] }),
    ).toMatchObject({ textEntries: [] });
  });

  it("normalizes legacy snapshots without rating distributions", () => {
    const snapshot = activityRetentionSnapshotSchema.parse({
      activityRunId: "activity_run_1",
      activityId: "activity_1",
      status: "results",
      revision: 4,
      responseCount: 7,
      participantCount: 10,
      responseRate: 70,
      aggregates: [
        {
          questionId: "question_rating",
          type: "rating",
          responseCount: 7,
          average: 4.5,
          choices: [],
        },
      ],
      textEntries: [],
    });

    expect(snapshot.aggregates[0]?.ratingDistribution).toEqual([]);
  });
});
