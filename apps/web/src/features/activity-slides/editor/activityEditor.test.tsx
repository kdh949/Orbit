import { createActivityResultsSlide, createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import { deckSchema } from "@orbit/shared";
import type { ActivitySessionResultItem } from "@orbit/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ActivitySlideInspector,
  convertQuestionType,
  moveQuestion,
  moveQuestionOption,
  removeQuestionOption
} from "./ActivitySlideInspector";
import { ActivityEditorOperationsPanel } from "./ActivityEditorOperationsPanel";
import { ActivitySlidePreview } from "./ActivitySlidePreview";
import { ActivitySpecialSlideThumbnail } from "./ActivitySpecialSlideThumbnail";
import { startSequentialPolling } from "../model/sequentialPolling";
import {
  ActivityResultSlideInspector,
  findCurrentActivityResult,
  findActivityResultSource
} from "./ActivityResultSlideInspector";

describe("activity slide editor", () => {
  const slide = createActivitySlide(createDemoDeck(), "satisfaction");

  it("renders role-specific previews from the same activity definition", () => {
    const audience = renderToStaticMarkup(<ActivitySlidePreview role="audience" slide={slide} />);
    const presenter = renderToStaticMarkup(<ActivitySlidePreview role="presenter" slide={slide} />);

    expect(audience).toContain("청중 참여 장표 미리보기");
    expect(audience).toContain("응답 제출");
    expect(audience).toContain("답변을 입력해 주세요");
    expect(audience).toContain("전혀 아니요");
    expect(audience).toContain("매우 그래요");
    expect(audience).not.toContain("redesign-orbit-brand");
    expect(audience).not.toContain("AUDIENCE");
    expect(presenter).toContain("발표자 참여 장표 미리보기");
    expect(presenter).toContain("응답 0");
    expect(presenter).not.toContain("PRESENTER");
  });

  it("keeps generated response controls in a locked system layer", () => {
    const html = renderToStaticMarkup(<ActivitySlideInspector onChange={vi.fn()} slide={slide} />);

    expect(html).not.toContain('aria-label="참여 장표 미리보기 역할"');
    expect(html).toContain("발표자 화면 미리보기");
    expect(html).toContain("발표자 참여 장표 미리보기");
    expect(html).toContain("응답 화면은 자동으로 만들어져요.");
    expect(html).not.toContain("시스템 레이어");
    expect(html).toContain('data-activity-system-layer="locked"');
    expect(html).toContain('data-semantic-locked="false"');
  });

  it("renders meaningful thumbnails for activity and linked result slides", () => {
    const deck = deckSchema.parse({
      ...createDemoDeck(),
      slides: [...createDemoDeck().slides, slide]
    });
    const resultSlide = createActivityResultsSlide(deck, slide.activity.activityId);

    const activityHtml = renderToStaticMarkup(<ActivitySpecialSlideThumbnail deck={deck} slide={slide} />);
    const resultHtml = renderToStaticMarkup(
      <ActivitySpecialSlideThumbnail deck={{ ...deck, slides: [...deck.slides, resultSlide] }} slide={resultSlide} />
    );

    expect(activityHtml).toContain('data-testid="activity-slide-thumbnail"');
    expect(activityHtml).toContain(slide.activity.title);
    expect(resultHtml).toContain('data-testid="activity-results-slide-thumbnail"');
    expect(resultHtml).toContain(`${slide.activity.title} 결과`);
  });

  it("renders editor status, public state, direct link, and QR controls", () => {
    const html = renderToStaticMarkup(
      <ActivityEditorOperationsPanel
        onUpdateStatus={vi.fn()}
        pending={false}
        projectId="project_1"
        runtime={{
          audienceUrl: "/audience/session_1",
          sessionId: "session_1",
          run: {
            activityRunId: "activity_run_1",
            presentationSessionId: "session_1",
            activityId: slide.activity.activityId,
            sourceSlideId: slide.slideId,
            version: 1,
            supersedesActivityRunId: null,
            definitionSnapshot: slide.activity,
            definitionFingerprint: "fingerprint_1",
            status: "results",
            revision: 3,
            isCurrent: true,
            responseCount: 7,
            openedAt: "2026-07-17T00:00:00.000Z",
            closedAt: "2026-07-17T00:01:00.000Z",
            revealedAt: "2026-07-17T00:02:00.000Z",
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:02:00.000Z"
          }
        }}
        slide={slide}
      />
    );

    expect(html).toContain("결과 공개");
    expect(html).toContain("청중에게 결과");
    expect(html).toContain("/audience/session_1/a/");
    expect(html).toContain("이 슬라이드 참여 링크 복사");
    expect(html).toContain("참여 QR 코드 보기");
    expect(html).toContain("모든 응답 보기");
    expect(html).toContain('href="/project/project_1/presentation-sessions/session_1/results"');
  });

  it("offers reopening and result reveal together after responses close", () => {
    const html = renderToStaticMarkup(
      <ActivityEditorOperationsPanel
        onUpdateStatus={vi.fn()}
        pending={false}
        runtime={{
          audienceUrl: "/audience/session_1",
          sessionId: "session_1",
          run: {
            activityRunId: "activity_run_closed",
            presentationSessionId: "session_1",
            activityId: slide.activity.activityId,
            sourceSlideId: slide.slideId,
            version: 1,
            supersedesActivityRunId: null,
            definitionSnapshot: slide.activity,
            definitionFingerprint: "fingerprint_closed",
            status: "closed",
            revision: 4,
            isCurrent: true,
            responseCount: 7,
            openedAt: "2026-07-17T00:00:00.000Z",
            closedAt: "2026-07-17T00:01:00.000Z",
            revealedAt: null,
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:01:00.000Z"
          }
        }}
        slide={slide}
      />
    );

    expect(html).toContain("응답 다시 열기");
    expect(html).toContain("결과 공개");
    expect(html).toContain("기존 응답과 집계는 유지됩니다");
  });

  it("offers the shared session modal when no session exists", () => {
    const html = renderToStaticMarkup(
      <ActivityEditorOperationsPanel
        onOpenAudienceLink={vi.fn()}
        onUpdateStatus={vi.fn()}
        pending={false}
        runtime={null}
        slide={slide}
      />
    );

    expect(html).toContain("발표 준비하기");
  });

  it("converts and reorders satisfaction questions without changing their IDs", () => {
    const source = slide.activity.questions[0]!;
    const converted = convertQuestionType(slide.activity, source, "single-choice");
    expect(converted.questionId).toBe(source.questionId);
    expect(converted.type).toBe("single-choice");
    if (converted.type !== "single-choice") throw new Error("choice fixture");
    expect(converted.options).toHaveLength(2);

    const moved = moveQuestion(slide.activity.questions, 1, -1);
    expect(moved.map((question) => question.questionId)).toEqual([
      slide.activity.questions[1]!.questionId,
      slide.activity.questions[0]!.questionId
    ]);
  });

  it("clamps maxSelections when deleting a multiple-choice option", () => {
    const source = slide.activity.questions[0]!;
    const converted = convertQuestionType(slide.activity, source, "multiple-choice");
    if (converted.type !== "multiple-choice") throw new Error("multiple-choice fixture");
    const withThreeOptions = {
      ...converted,
      options: [...converted.options, { optionId: "option_extra", label: "추가 선택" }],
      maxSelections: 3
    };

    const next = removeQuestionOption(withThreeOptions, "option_extra");

    expect(next).toMatchObject({ maxSelections: 2 });
    expect(
      deckSchema.safeParse({
        ...createDemoDeck(),
        slides: [
          {
            ...slide,
            activity: { ...slide.activity, questions: [next] }
          }
        ]
      }).success
    ).toBe(true);
  });

  it("reorders choice options without changing their IDs", () => {
    const source = convertQuestionType(slide.activity, slide.activity.questions[0]!, "single-choice");
    if (source.type !== "single-choice") throw new Error("choice fixture");

    const moved = moveQuestionOption(source, 1, -1);

    if (moved.type !== "single-choice") throw new Error("choice result");
    expect(moved.options.map((option) => option.optionId)).toEqual([
      source.options[1]!.optionId,
      source.options[0]!.optionId
    ]);
  });

  it("renders every poll option in the slide preview", () => {
    const pollSlide = createActivitySlide(createDemoDeck(), "poll");
    const question = pollSlide.activity.questions[0]!;
    if (question.type !== "single-choice") throw new Error("poll fixture");
    const options = Array.from({ length: 8 }, (_, index) => ({
      optionId: `option_${index + 1}`,
      label: `선택지 ${index + 1}`
    }));
    const html = renderToStaticMarkup(
      <ActivitySlidePreview
        role="audience"
        slide={{
          ...pollSlide,
          activity: {
            ...pollSlide.activity,
            questions: [{ ...question, options }]
          }
        }}
      />
    );

    expect(html).toContain("선택지 8");
    expect(html).toContain('data-activity-template="poll"');
  });

  it.each(["pre-question", "poll", "satisfaction"] as const)("renders the %s template inspector", (template) => {
    const templateSlide = createActivitySlide(createDemoDeck(), template);
    const html = renderToStaticMarkup(<ActivitySlideInspector onChange={vi.fn()} slide={templateSlide} />);
    expect(html).toContain(templateSlide.activity.title);
  });

  it("shows that pre-question edits are reflected on the slide canvas", () => {
    const preQuestionSlide = createActivitySlide(createDemoDeck(), "pre-question");
    const questionPrompt = preQuestionSlide.activity.questions[0]!.prompt;
    const previewHtml = renderToStaticMarkup(<ActivitySlidePreview role="audience" slide={preQuestionSlide} />);
    const inspectorHtml = renderToStaticMarkup(
      <ActivitySlideInspector
        deckId="deck_demo_1"
        onChange={vi.fn()}
        projectId="project_demo_1"
        slide={preQuestionSlide}
      />
    );

    expect(previewHtml).toContain(questionPrompt);
    expect(previewHtml).toContain("답변을 입력해 주세요");
    expect(inspectorHtml).not.toContain("캔버스 자동 반영");
    expect(inspectorHtml).toContain("변경 즉시 에디터 미리보기에 반영돼요.");
    expect(inspectorHtml).toContain("질문 추가");
    expect(inspectorHtml).toContain("1/5");
    expect(inspectorHtml).toContain("슬라이드 제목");
    expect(inspectorHtml).toContain("설명 문구");
    expect(inspectorHtml).toContain("꼭 답하게 하기");
    expect(inspectorHtml).toContain("청중 화면 새 창에서 보기");
    expect(inspectorHtml).not.toContain('title="실제 청중 화면 미리보기"');
    expect(inspectorHtml).not.toContain("실제 청중 입력 화면을 그대로 표시합니다.");
    expect(inspectorHtml).toContain("발표자 화면 미리보기");
    expect(inspectorHtml).toContain("발표 중 확인하게 될 응답 상태를 미리 보여줍니다.");
    expect(inspectorHtml).toContain("받은 사전 질문");
    expect(inspectorHtml).toContain("질문 확인");
    expect(inspectorHtml).not.toContain("들어온 주관식 답변 확인");
    expect(inspectorHtml).toContain(
      `/project/project_demo_1/activity-preview/${preQuestionSlide.activity.activityId}`
    );
    expect(inspectorHtml).not.toContain("문항 설정");
  });

  it("does not show response review controls for poll and satisfaction slides", () => {
    for (const template of ["poll", "satisfaction"] as const) {
      const templateSlide = createActivitySlide(createDemoDeck(), template);
      const html = renderToStaticMarkup(
        <ActivitySlideInspector
          deckId="deck_demo_1"
          onChange={vi.fn()}
          projectId="project_demo_1"
          slide={templateSlide}
        />
      );

      expect(html).not.toContain("받은 사전 질문");
      expect(html).not.toContain("들어온 주관식 답변 확인");
    }
  });

  it("renders result source recovery without persisting a session or response", () => {
    const deck = deckSchema.parse({
      ...createDemoDeck(),
      slides: [...createDemoDeck().slides, slide]
    });
    const resultSlide = createActivityResultsSlide(deck, slide.activity.activityId);
    const completeDeck = deckSchema.parse({
      ...deck,
      slides: [...deck.slides, resultSlide]
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ActivityResultSlideInspector
          deck={completeDeck}
          projectId={completeDeck.projectId}
          slide={resultSlide}
          onChange={vi.fn()}
          onSelectSourceSlide={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(html).toContain("선택한 슬라이드로 이동");
    expect(html).toContain("미리보기에서 고른 발표는 이 슬라이드에 저장되지 않아요.");
    expect(resultSlide.activityResult).toEqual({
      sourceActivityId: slide.activity.activityId,
      display: "live",
      layout: "summary"
    });
  });

  it("detects a deleted result source for recovery", () => {
    const deck = deckSchema.parse({
      ...createDemoDeck(),
      slides: [...createDemoDeck().slides, slide]
    });
    const resultSlide = createActivityResultsSlide(deck, slide.activity.activityId);
    const danglingDeck = deckSchema.parse({
      ...deck,
      slides: [...createDemoDeck().slides, resultSlide]
    });

    expect(findActivityResultSource(danglingDeck, resultSlide.activityResult.sourceActivityId)).toBeNull();
  });

  it("selects only the current run from a chosen presentation session", () => {
    const runs = [sessionResultItem("activity_run_old", false, 1), sessionResultItem("activity_run_current", true, 2)];

    expect(findCurrentActivityResult(runs, slide.activity.activityId)?.run.activityRunId).toBe("activity_run_current");
    expect(findCurrentActivityResult(runs, "activity_other")).toBeNull();
  });

  it("waits for a slow refresh before scheduling the next editor poll", async () => {
    vi.useFakeTimers();
    let resolveRefresh: (() => void) | undefined;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRefresh = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const stopPolling = startSequentialPolling(refresh, 2_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    stopPolling();
    vi.useRealTimers();
  });

  function sessionResultItem(activityRunId: string, isCurrent: boolean, version: number): ActivitySessionResultItem {
    return {
      availability: "raw-retained",
      result: null,
      run: {
        activityRunId,
        presentationSessionId: "session_1",
        activityId: slide.activity.activityId,
        sourceSlideId: slide.slideId,
        version,
        supersedesActivityRunId: version === 1 ? null : "activity_run_old",
        definitionSnapshot: slide.activity,
        definitionFingerprint: `fingerprint_${version}`,
        status: isCurrent ? "draft" : "closed",
        revision: 0,
        isCurrent,
        responseCount: 0,
        openedAt: null,
        closedAt: null,
        revealedAt: null,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z"
      }
    };
  }
});
