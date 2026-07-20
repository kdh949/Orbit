import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import {
  activityPublicResultSchema,
  activityResponseSchema,
  activityRunSchema
} from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AudienceSatisfactionPage,
  AudiencePublicResultCard,
  AudienceResponseSummary,
  AudienceSatisfactionForm,
  getAudienceActivityStatusCopy,
  getAudienceTemplateCopy,
  loadAudienceActivityRefresh
} from "./AudienceSatisfactionPage";
import { createSatisfactionDraft } from "./activityFormModel";
import { activityApi } from "../api/activityApi";

const definition = createActivitySlide(
  createDemoDeck(),
  "satisfaction"
).activity;
const pollDefinition = createActivitySlide(
  createDemoDeck(),
  "poll"
).activity;

describe("AudienceSatisfactionForm", () => {
  it("uses the shared ORBIT brand and workspace shell on the public page", () => {
    const html = renderToStaticMarkup(
      <AudienceSatisfactionPage sessionId="session_1" />
    );

    expect(html).toContain("redesign-orbit-brand");
    expect(html).toContain("activity-audience-header-inner");
    expect(html).toContain("activity-audience-main");
    expect(html).toContain("참여 화면을 준비하고 있습니다");
  });

  it("renders accessible rating targets and the optional free-text field", () => {
    const html = renderToStaticMarkup(
      <AudienceSatisfactionForm
        definition={definition}
        draft={createSatisfactionDraft(null)}
        isSubmitting={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(html).toContain('type="radio"');
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toContain("발표가 전반적으로 유익했나요?");
    expect(html).toContain("추가 의견이 있다면 알려주세요.");
    expect(html).toContain("의견 제출");
    expect(html).toContain('data-activity-template="satisfaction"');
    expect(html).not.toContain("SATISFACTION SURVEY");
    expect(html).not.toContain("speakerNotes");
  });

  it("does not render an English eyebrow on the live poll form", () => {
    const html = renderToStaticMarkup(
      <AudienceSatisfactionForm
        definition={pollDefinition}
        draft={createSatisfactionDraft(null)}
        isSubmitting={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(html).toContain("실시간 투표");
    expect(html).toContain("투표 제출");
    expect(html).not.toContain("LIVE POLL");
  });

  it("reloads the current Activity when the active pointer disappears", async () => {
    const current = audienceActivity("closed");
    vi.spyOn(activityApi, "getAudienceActiveActivity").mockResolvedValue({ activity: null });
    vi.spyOn(activityApi, "getAudienceActivity").mockResolvedValue(current);

    await expect(
      loadAudienceActivityRefresh("session_1", definition.activityId)
    ).resolves.toEqual(current);
    expect(activityApi.getAudienceActivity).toHaveBeenCalledWith(
      "session_1",
      definition.activityId
    );
  });

  it("distinguishes a draft Activity from a closed response window", () => {
    expect(getAudienceActivityStatusCopy("draft")).toEqual({
      title: "발표자가 응답을 준비하고 있습니다",
      description: "응답이 열리면 이 화면에 자동으로 표시됩니다."
    });
    expect(getAudienceActivityStatusCopy("closed").title).toBe(
      "응답이 마감되었습니다"
    );
  });

  it("uses action copy that matches each activity template", () => {
    expect(getAudienceTemplateCopy({ ...definition, template: "poll" }).submitLabel).toBe("투표 제출");
    expect(getAudienceTemplateCopy({ ...definition, template: "pre-question" }).receiptTitle).toBe("질문을 보냈습니다");
    expect(getAudienceTemplateCopy(definition).submitLabel).toBe("의견 제출");
  });

  it("renders public aggregates after the current run reveals results", () => {
    const html = renderToStaticMarkup(
      <AudiencePublicResultCard current={audienceActivity("results")} />
    );

    expect(html).toContain(`${definition.title} 결과`);
    expect(html).toContain("공개 결과");
    expect(html).toContain("4.5");
    expect(html).toContain("평점 분포");
    expect(html).toContain("5점");
  });

  it("shows the submitted answers on the receipt", () => {
    const rating = definition.questions[0]!;
    const text = definition.questions[1]!;
    const response = activityResponseSchema.parse({
      responseId: "activity_response_1",
      activityRunId: "activity_run_1",
      answers: [
        { questionId: rating.questionId, type: "rating", value: 4 },
        { questionId: text.questionId, type: "free-text", text: "리허설 예시가 유익했어요." }
      ],
      displayName: null,
      revision: 1,
      submittedAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z"
    });
    const html = renderToStaticMarkup(
      <AudienceResponseSummary definition={definition} response={response} />
    );

    expect(html).toContain("내가 제출한 답변");
    expect(html).toContain("4 / 5");
    expect(html).toContain("리허설 예시가 유익했어요.");
  });
});

function audienceActivity(status: "closed" | "results") {
  const run = activityRunSchema.parse({
    activityRunId: "activity_run_1",
    presentationSessionId: "session_1",
    activityId: definition.activityId,
    sourceSlideId: "slide_activity_1",
    version: 1,
    supersedesActivityRunId: null,
    definitionSnapshot: definition,
    definitionFingerprint: "fingerprint_1",
    status,
    revision: status === "results" ? 3 : 2,
    isCurrent: true,
    responseCount: 2,
    openedAt: "2026-07-17T00:00:00.000Z",
    closedAt: "2026-07-17T00:01:00.000Z",
    revealedAt: status === "results" ? "2026-07-17T00:02:00.000Z" : null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:02:00.000Z"
  });
  return {
    activityId: definition.activityId,
    run,
    ownResponse: null,
    publicResult:
      status === "results"
        ? activityPublicResultSchema.parse({
            activityRunId: run.activityRunId,
            activityId: run.activityId,
            status: "results",
            revision: run.revision,
            responseCount: 2,
            aggregates: [{
              questionId: definition.questions[0]!.questionId,
              type: "rating",
              responseCount: 2,
              average: 4.5,
              ratingDistribution: [
                { value: 1, count: 0, ratio: 0 },
                { value: 2, count: 0, ratio: 0 },
                { value: 3, count: 0, ratio: 0 },
                { value: 4, count: 1, ratio: 0.5 },
                { value: 5, count: 1, ratio: 0.5 }
              ],
              choices: []
            }],
            approvedTextEntries: []
          })
        : null
  };
}
