import { describe, expect, it } from "vitest";

import { RehearsalRunEntity } from "../rehearsal-run.entity";
import {
  toRehearsalFocusProfile,
  toRehearsalRun,
} from "./rehearsal-run.mapper";

describe("rehearsal run mapper", () => {
  it("maps persistence dates and nullable fields to the shared run contract", () => {
    const run = Object.assign(new RehearsalRunEntity(), {
      analysisFinalizedAt: new Date("2026-07-26T01:02:03.000Z"),
      analysisRevision: null,
      audioFileId: null,
      createdAt: new Date("2026-07-26T00:00:00.000Z"),
      deckId: "deck-a",
      deckVersion: 7,
      error: null,
      evaluationSnapshot: null,
      jobId: null,
      projectId: "project-a",
      rawAudioDeleteDeadlineAt: new Date("2026-08-09T00:00:00.000Z"),
      rawAudioDeletedAt: null,
      runId: "run-a",
      semanticEvaluationMode: "full",
      status: "succeeded",
      updatedAt: new Date("2026-07-26T01:03:00.000Z"),
    });

    expect(toRehearsalRun(run)).toEqual({
      analysisFinalizedAt: "2026-07-26T01:02:03.000Z",
      analysisRevision: 0,
      audioFileId: null,
      createdAt: "2026-07-26T00:00:00.000Z",
      deckId: "deck-a",
      deckVersion: 7,
      error: null,
      evaluationSnapshot: null,
      jobId: null,
      projectId: "project-a",
      rawAudioDeleteDeadlineAt: "2026-08-09T00:00:00.000Z",
      rawAudioDeletedAt: null,
      runId: "run-a",
      semanticEvaluationMode: "full",
      status: "succeeded",
      updatedAt: "2026-07-26T01:03:00.000Z",
    });
  });

  it("maps a raw focus profile query row and normalizes database dates", () => {
    expect(
      toRehearsalFocusProfile({
        profile_id: "focus-profile-a",
        project_id: "project-a",
        revision: 2,
        items_json: [
          {
            focusItemId: "focus-item-a",
            priority: 1,
            kind: "semantic-coverage",
            label: "핵심 가치를 설명한다.",
            targetScope: {
              type: "slide",
              scopeId: "scope-a",
              slideId: "slide-a",
            },
          },
        ],
        created_by: "user-a",
        updated_by: "user-b",
        created_at: new Date("2026-07-20T00:00:00.000Z"),
        updated_at: "2026-07-21T00:00:00.000Z",
      }),
    ).toEqual({
      profileId: "focus-profile-a",
      projectId: "project-a",
      revision: 2,
      items: [
        {
          focusItemId: "focus-item-a",
          priority: 1,
          kind: "semantic-coverage",
          label: "핵심 가치를 설명한다.",
          targetScope: {
            type: "slide",
            scopeId: "scope-a",
            slideId: "slide-a",
          },
        },
      ],
      createdBy: "user-a",
      updatedBy: "user-b",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
  });

  it("returns null when the focus profile query has no row", () => {
    expect(toRehearsalFocusProfile(undefined)).toBeNull();
  });
});
