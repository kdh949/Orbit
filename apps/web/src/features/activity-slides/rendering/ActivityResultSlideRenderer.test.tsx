import {
  createActivityResultsSlide,
  createActivitySlide,
  createDemoDeck
} from "@orbit/editor-core";
import {
  activityPresenterResultSchema,
  activityRunSchema,
  deckSchema
} from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActivityResultSlideRenderer,
  getActivityResultRenderState
} from "./ActivityResultSlideRenderer";

const source = createActivitySlide(createDemoDeck(), "satisfaction");
const deck = deckSchema.parse({
  ...createDemoDeck(),
  slides: [...createDemoDeck().slides, source]
});
const resultSlide = createActivityResultsSlide(deck, source.activity.activityId);
const run = activityRunSchema.parse({
  activityRunId: "activity_run_1",
  presentationSessionId: "session_1",
  activityId: source.activity.activityId,
  sourceSlideId: source.slideId,
  version: 1,
  supersedesActivityRunId: null,
  definitionSnapshot: source.activity,
  definitionFingerprint: "fingerprint",
  status: "closed",
  revision: 2,
  isCurrent: true,
  responseCount: 1,
  openedAt: "2026-07-17T00:00:00.000Z",
  closedAt: "2026-07-17T00:01:00.000Z",
  revealedAt: null,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:01:00.000Z"
});
const presenterResult = activityPresenterResultSchema.parse({
  activityRunId: run.activityRunId,
  activityId: run.activityId,
  status: run.status,
  revision: run.revision,
  responseCount: 1,
  participantCount: 2,
  responseRate: 50,
  aggregates: source.activity.questions.map((question) => ({
    questionId: question.questionId,
    type: question.type,
    responseCount: 1,
    average: question.type === "rating" ? 4 : null,
    ratingDistribution: question.type === "rating"
      ? [
          { value: 1, count: 0, ratio: 0 },
          { value: 2, count: 0, ratio: 0 },
          { value: 3, count: 0, ratio: 0 },
          { value: 4, count: 1, ratio: 1 },
          { value: 5, count: 0, ratio: 0 }
        ]
      : [],
    choices: []
  })),
  textEntries: [{
    entryId: "activity_text_1",
    questionId: source.activity.questions[1]!.questionId,
    text: "공개 전 원문 sentinel",
    displayName: "비공개 이름 sentinel",
    moderationStatus: "pending",
    answeredAt: null,
    updatedAt: "2026-07-17T00:01:00.000Z"
  }]
});

describe("ActivityResultSlideRenderer", () => {
  it("uses the linked activity copy and removes decorative result labels", () => {
    const html = renderToStaticMarkup(
      <ActivityResultSlideRenderer
        presenterResult={null}
        publicResult={null}
        role="presenter"
        run={null}
        slide={resultSlide}
        source={source}
        theme={deck.theme}
      />
    );

    expect(html).not.toContain("redesign-orbit-brand");
    expect(html).toContain("실시간 참여 결과");
    expect(html).toContain("시작 전");
    expect(html).toContain(source.activity.title);
    expect(html).not.toContain("ACTIVITY RESULTS");
    expect(html).not.toContain(resultSlide.title);
  });

  it.each([
    [null, false, "audience", null, null, "source-missing"],
    [source, true, "audience", null, null, "waiting"],
    [source, false, "audience", null, null, "no-run"],
    [source, false, "presenter", run, presenterResult, "presenter-live"],
    [source, false, "audience", run, null, "public-hidden"]
  ] as const)(
    "resolves the %s/%s/%s state as %s",
    (sourceInput, waiting, role, runInput, presenterInput, expected) => {
      expect(getActivityResultRenderState({
        presenterResult: presenterInput,
        publicResult: null,
        role,
        run: runInput,
        source: sourceInput,
        waiting
      })).toBe(expected);
    }
  );

  it("never renders presenter raw text on a hidden audience result", () => {
    const html = renderToStaticMarkup(
      <ActivityResultSlideRenderer
        presenterResult={presenterResult}
        publicResult={null}
        role="audience"
        run={run}
        slide={resultSlide}
        source={source}
      />
    );

    expect(html).toContain('data-result-state="public-hidden"');
    expect(html).toContain("결과는 아직 공개되지 않았습니다");
    expect(html).not.toContain("공개 전 원문 sentinel");
    expect(html).not.toContain("비공개 이름 sentinel");
  });

  it("renders live aggregates and raw moderation state only for presenters", () => {
    const html = renderToStaticMarkup(
      <ActivityResultSlideRenderer
        presenterResult={presenterResult}
        publicResult={null}
        role="presenter"
        run={run}
        slide={{ ...resultSlide, activityResult: { ...resultSlide.activityResult, layout: "approved-text" } }}
        source={source}
      />
    );

    expect(html).toContain('data-result-state="presenter-live"');
    expect(html).toContain("공개 전 원문 sentinel");
    expect(html).toContain("확인 전");
    expect(html).toContain("새 응답은 이 화면에 자동으로 반영됩니다.");
  });

  it("renders distinct summary and chart layouts", () => {
    const summary = renderToStaticMarkup(
      <ActivityResultSlideRenderer
        presenterResult={presenterResult}
        publicResult={null}
        role="presenter"
        run={run}
        slide={resultSlide}
        source={source}
      />
    );
    const chart = renderToStaticMarkup(
      <ActivityResultSlideRenderer
        presenterResult={presenterResult}
        publicResult={null}
        role="presenter"
        run={run}
        slide={{
          ...resultSlide,
          activityResult: { ...resultSlide.activityResult, layout: "chart" }
        }}
        source={source}
      />
    );

    expect(summary).toContain('data-result-layout="summary"');
    expect(summary).toContain("결과 요약");
    expect(summary).toContain("응답 결과 한눈에 보기");
    expect(chart).toContain('data-result-layout="chart"');
    expect(chart).toContain("집계 차트");
    expect(chart).toContain("activity-result-chart-track");
  });

  it("renders approved audience text as escaped plain text", () => {
    const maliciousText = '<img src=x onerror="alert(1)">';
    const html = renderToStaticMarkup(
      <ActivityResultSlideRenderer
        presenterResult={{
          ...presenterResult,
          textEntries: [
            {
              ...presenterResult.textEntries[0]!,
              text: maliciousText,
              moderationStatus: "approved"
            }
          ]
        }}
        publicResult={null}
        role="presenter"
        run={run}
        slide={{
          ...resultSlide,
          activityResult: {
            ...resultSlide.activityResult,
            layout: "approved-text"
          }
        }}
        source={source}
      />
    );

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="alert(1)"');
  });
});
