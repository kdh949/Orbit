import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import {
  activityPresenterResultSchema,
  activityRunSchema,
  type ActivitySessionResultItem
} from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  ActivityResultArchiveDetail,
  canDeleteSessionResults,
  isDeleteConfirmationValid
} from "./ActivityResultsPage";

const source = createActivitySlide(createDemoDeck(), "pre-question");
const run = activityRunSchema.parse({
  activityRunId: "activity_run_archive",
  presentationSessionId: "session_archive",
  activityId: source.activity.activityId,
  sourceSlideId: source.slideId,
  version: 1,
  supersedesActivityRunId: null,
  definitionSnapshot: source.activity,
  definitionFingerprint: "fingerprint",
  status: "results",
  revision: 3,
  isCurrent: true,
  responseCount: 1,
  openedAt: "2026-07-17T00:00:00.000Z",
  closedAt: "2026-07-17T00:01:00.000Z",
  revealedAt: "2026-07-17T00:02:00.000Z",
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:02:00.000Z"
});
const result = activityPresenterResultSchema.parse({
  activityRunId: run.activityRunId,
  activityId: run.activityId,
  status: "results",
  revision: 3,
  responseCount: 1,
  participantCount: 2,
  responseRate: 50,
  aggregates: [{
    questionId: source.activity.questions[0]!.questionId,
    type: "free-text",
    responseCount: 1,
    average: null,
    ratingDistribution: [],
    choices: []
  }],
  textEntries: [{
    entryId: "activity_text_archive",
    questionId: source.activity.questions[0]!.questionId,
    text: "보존 중인 질문",
    displayName: null,
    moderationStatus: "approved",
    answeredAt: null,
    updatedAt: "2026-07-17T00:02:00.000Z"
  }]
});

function item(
  availability: ActivitySessionResultItem["availability"]
): ActivitySessionResultItem {
  return {
    availability,
    result:
      availability === "results-deleted"
        ? null
        : availability === "aggregate-only"
          ? { ...result, textEntries: [] }
          : result,
    run
  };
}

describe("ActivityResultsPage detail states", () => {
  it("renders raw retained aggregates and text from the API response", () => {
    const html = renderToStaticMarkup(
      <ActivityResultArchiveDetail item={item("raw-retained")} />
    );
    expect(html).toContain("보존 중인 질문");
    expect(html).toContain("주관식 응답");
    expect(html).toContain("응답률");
    expect(html).toContain("50%");
  });

  it("renders an aggregate-only retention state without raw text", () => {
    const html = renderToStaticMarkup(
      <ActivityResultArchiveDetail item={item("aggregate-only")} />
    );
    expect(html).toContain("집계 전용 결과입니다");
    expect(html).toContain("응답률");
    expect(html).toContain("50%");
    expect(html).toContain("<strong>1</strong>개 의견");
    expect(html).not.toContain("보존 중인 질문");
    expect(html).not.toContain("주관식 응답 관리");
  });

  it("renders the irreversible deleted state", () => {
    const html = renderToStaticMarkup(
      <ActivityResultArchiveDetail item={item("results-deleted")} />
    );
    expect(html).toContain("결과가 영구 삭제되었습니다");
    expect(html).toContain("복구할 수 없습니다");
  });

  it("shows keyboard moderation controls to editor surfaces", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityResultArchiveDetail
          item={item("raw-retained")}
          projectId="project_1"
          sessionId="session_1"
        />
      </QueryClientProvider>
    );
    expect(html).toContain("승인");
    expect(html).toContain("숨김");
    expect(html).toContain("답변 완료");
  });

  it("shows hard delete only to owners before deletion", () => {
    expect(canDeleteSessionResults("owner", null)).toBe(true);
    expect(canDeleteSessionResults("editor", null)).toBe(false);
    expect(canDeleteSessionResults("viewer", null)).toBe(false);
    expect(canDeleteSessionResults("owner", "2026-07-17T00:00:00.000Z")).toBe(false);
  });

  it("requires the exact session name for destructive confirmation", () => {
    expect(isDeleteConfirmationValid(" 발표 세션 1 ", "발표 세션 1")).toBe(true);
    expect(isDeleteConfirmationValid("발표 세션", "발표 세션 1")).toBe(false);
  });
});
