import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import type { ActivityPublicResult } from "@orbit/shared/activities";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActivityAudienceSlideRenderer,
  canonicalActivityUrl
} from "./ActivityAudienceSlideRenderer";

const slide = {
  ...createActivitySlide(createDemoDeck(), "satisfaction"),
  speakerNotes: "SPEAKER_NOTE_SENTINEL"
};

const activityAudienceSlideCssPath = fileURLToPath(
  new URL("./activity-audience-slide.css", import.meta.url)
);

const publicResult: ActivityPublicResult = {
  activityRunId: "activity_run_1",
  activityId: slide.activity.activityId,
  status: "results",
  revision: 3,
  responseCount: 7,
  aggregates: slide.activity.questions.map((question) => ({
    questionId: question.questionId,
    type: question.type,
    responseCount: 7,
    average: question.type === "rating" ? 4.2 : null,
    ratingDistribution: question.type === "rating"
      ? [
          { value: 1, count: 0, ratio: 0 },
          { value: 2, count: 0, ratio: 0 },
          { value: 3, count: 1, ratio: 1 / 7 },
          { value: 4, count: 3, ratio: 3 / 7 },
          { value: 5, count: 3, ratio: 3 / 7 }
        ]
      : [],
    choices: []
  })),
  approvedTextEntries: []
};

describe("ActivityAudienceSlideRenderer", () => {
  it("uses the deck palette without presenter-screen branding", () => {
    const html = renderToStaticMarkup(
      <ActivityAudienceSlideRenderer
        activity={slide.activity}
        audienceUrl={null}
        publicResult={null}
        status="preparing"
        theme={{
          ...createDemoDeck().theme,
          backgroundColor: "#090909",
          textColor: "#ffffff",
          accentColor: "#c5b0f4"
        }}
      />
    );

    expect(html).not.toContain("main-logo.png");
    expect(html).toContain("--activity-color-background:#090909");
    expect(html).toContain("--activity-color-accent:#c5b0f4");
    expect(html).toContain("LIVE SURVEY");
  });

  it("renders only the public result projection after reveal", () => {
    const html = renderToStaticMarkup(
      <ActivityAudienceSlideRenderer
        activity={slide.activity}
        audienceUrl="/audience/session_1/a/activity_1"
        publicResult={publicResult}
        status="results"
      />
    );

    expect(html).toContain("공개 결과");
    expect(html).toContain("4.2");
    expect(html).toContain(">7<");
    expect(html).not.toContain("SPEAKER_NOTE_SENTINEL");
    expect(html).not.toContain("displayName");
    expect(html).not.toContain("moderationStatus");
  });

  it("does not render aggregate values while results are hidden", () => {
    const html = renderToStaticMarkup(
      <ActivityAudienceSlideRenderer
        activity={slide.activity}
        audienceUrl="/audience/session_1/a/activity_1"
        publicResult={publicResult}
        status="closed"
      />
    );

    expect(html).toContain('aria-label="응답이 마감되었습니다"');
    expect(html).not.toContain("4.2");
    expect(html).not.toContain(">7<");
  });

  it("builds the canonical direct Activity path", () => {
    expect(canonicalActivityUrl("/audience/session_1", "activity_1")).toBe(
      "/audience/session_1/a/activity_1"
    );
  });

  it("keeps the presentation QR square, large, and unclipped", () => {
    const css = fs.readFileSync(activityAudienceSlideCssPath, "utf8");
    const qrFrameRule = css.match(/\.activity-audience-qr-frame\s*\{([^}]*)\}/)?.[1];

    expect(qrFrameRule).toContain("border-radius: var(--redesign-space-6)");
    expect(qrFrameRule).toContain("padding: var(--redesign-space-8)");
    expect(qrFrameRule).not.toContain("overflow: hidden");
    expect(css).toContain("grid-template-columns: 520px minmax(0, 1fr)");
    expect(css).toContain("left: 50%");
    expect(css).toContain("width: 1504px");
    expect(css).toContain("transform: translateX(-50%)");
  });

  it("reveals poll ratios only from the public result projection", () => {
    const pollSlide = createActivitySlide(createDemoDeck(), "poll");
    const question = pollSlide.activity.questions[0]!;
    if (question.type !== "single-choice") throw new Error("poll fixture");
    const pollResult: ActivityPublicResult = {
      activityRunId: "activity_run_poll",
      activityId: pollSlide.activity.activityId,
      status: "results",
      revision: 4,
      responseCount: 2,
      aggregates: [{
        questionId: question.questionId,
        type: question.type,
        responseCount: 2,
        average: null,
        ratingDistribution: [],
        choices: question.options.map((option, index) => ({
          optionId: option.optionId,
          count: index === 0 ? 2 : 0,
          ratio: index === 0 ? 1 : 0
        }))
      }],
      approvedTextEntries: []
    };
    const revealed = renderToStaticMarkup(
      <ActivityAudienceSlideRenderer
        activity={pollSlide.activity}
        audienceUrl="/audience/session_1/a/activity_poll"
        publicResult={pollResult}
        status="results"
      />
    );
    const hidden = renderToStaticMarkup(
      <ActivityAudienceSlideRenderer
        activity={pollSlide.activity}
        audienceUrl="/audience/session_1/a/activity_poll"
        publicResult={pollResult}
        status="closed"
      />
    );
    expect(hidden).toContain("LIVE POLL");
    expect(revealed).toContain("activity-public-poll-results");
    expect(revealed).toContain("activity-public-poll-donut");
    expect(revealed).toContain("실시간 결과");
    expect(revealed).toContain("총 <strong>2</strong>명 참여");
    expect(revealed).toContain("activity-public-poll-winner");
    expect(revealed).toContain("activity-public-poll-winner-highlight");
    expect(revealed).toContain("activity-public-poll-ranking-list");
    expect(revealed).toContain("is-winner");
    expect(revealed).toContain("결과가 실시간으로 생성되었습니다.");
    expect(revealed).toContain(question.prompt);
    expect(revealed).not.toContain("activity-public-result-summary");
    expect(revealed).toContain(
      '<span style="background:color-mix(in srgb, var(--activity-color-accent) 76%, var(--activity-color-on-surface));width:100%">',
    );
    expect(revealed).toContain(
      '<span style="background:color-mix(in srgb, var(--activity-color-secondary) 76%, var(--activity-color-on-surface));width:0%">',
    );
    expect(revealed).toContain("100%");
    expect(hidden).not.toContain("100%");
  });

  it("uses the reference-inspired summary and ranking split for public poll results", () => {
    const css = fs.readFileSync(activityAudienceSlideCssPath, "utf8");
    const pollContentRule = css.match(
      /\.activity-public-poll-content\s*\{([^}]*)\}/,
    )?.[1];

    expect(pollContentRule).toContain(
      "grid-template-columns: minmax(0, 5fr) minmax(0, 7fr)",
    );
    expect(css).toContain(".activity-public-poll-donut::after");
    expect(css).toContain(".activity-public-poll-winner-highlight");
    expect(css).toContain(".activity-public-poll-ranking-list li.is-winner");
  });

  it("starts the poll donut at 12 o'clock with the highest result", () => {
    const pollSlide = createActivitySlide(createDemoDeck(), "poll");
    const question = pollSlide.activity.questions[0]!;
    if (question.type !== "single-choice") throw new Error("poll fixture");
    const pollResult: ActivityPublicResult = {
      activityRunId: "activity_run_ranked_poll",
      activityId: pollSlide.activity.activityId,
      status: "results",
      revision: 5,
      responseCount: 4,
      aggregates: [{
        questionId: question.questionId,
        type: question.type,
        responseCount: 4,
        average: null,
        ratingDistribution: [],
        choices: question.options.map((option, index) => ({
          optionId: option.optionId,
          count: index === 1 ? 3 : 1,
          ratio: index === 1 ? 0.75 : 0.25
        }))
      }],
      approvedTextEntries: []
    };
    const html = renderToStaticMarkup(
      <ActivityAudienceSlideRenderer
        activity={pollSlide.activity}
        audienceUrl="/audience/session_1/a/activity_ranked_poll"
        publicResult={pollResult}
        status="results"
      />
    );

    expect(html).toContain(
      "background:conic-gradient(color-mix(in srgb, var(--activity-color-secondary) 76%, var(--activity-color-on-surface)) 0% 75%",
    );
  });

  it("emphasizes every tied first-place poll option", () => {
    const pollSlide = createActivitySlide(createDemoDeck(), "poll");
    const question = pollSlide.activity.questions[0]!;
    if (question.type !== "single-choice") throw new Error("poll fixture");
    const pollResult: ActivityPublicResult = {
      activityRunId: "activity_run_tied_poll",
      activityId: pollSlide.activity.activityId,
      status: "results",
      revision: 6,
      responseCount: 4,
      aggregates: [{
        questionId: question.questionId,
        type: question.type,
        responseCount: 4,
        average: null,
        ratingDistribution: [],
        choices: question.options.map((option) => ({
          optionId: option.optionId,
          count: 2,
          ratio: 0.5
        }))
      }],
      approvedTextEntries: []
    };
    const html = renderToStaticMarkup(
      <ActivityAudienceSlideRenderer
        activity={pollSlide.activity}
        audienceUrl="/audience/session_1/a/activity_tied_poll"
        publicResult={pollResult}
        status="results"
      />
    );

    expect(html.match(/class="is-winner"/g)).toHaveLength(2);
    expect(html.match(/activity-public-poll-rank">1<\/span>/g)).toHaveLength(2);
  });

  it("uses the full result grid width for a single question card", () => {
    const css = fs.readFileSync(activityAudienceSlideCssPath, "utf8");
    const resultCardRule = css.match(
      /\.activity-public-result-grid article\s*\{([^}]*)\}/,
    )?.[1];
    const singleResultCardRule = css.match(
      /\.activity-public-result-grid article:only-child\s*\{([^}]*)\}/,
    )?.[1];

    expect(resultCardRule).toContain(
      "border-radius: var(--redesign-radius-xl)",
    );
    expect(singleResultCardRule).toContain("grid-column: 1 / -1");
  });
});
