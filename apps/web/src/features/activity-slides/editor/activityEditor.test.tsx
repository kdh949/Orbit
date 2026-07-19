import {
  createActivityResultsSlide,
  createActivitySlide,
  createDemoDeck
} from "@orbit/editor-core";
import { deckSchema } from "@orbit/shared";
import type { ActivitySessionResultItem } from "@orbit/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ActivitySlideInspector,
  convertQuestionType,
  moveQuestion,
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
    expect(presenter).toContain("발표자 참여 장표 미리보기");
    expect(presenter).toContain("응답 0");
  });

  it("keeps generated response controls in a locked system layer", () => {
    const html = renderToStaticMarkup(
      <ActivitySlideInspector onChange={vi.fn()} slide={slide} />
    );

    expect(html).toContain("청중 화면");
    expect(html).toContain("발표자 화면");
    expect(html).toContain("잠긴 시스템 레이어");
    expect(html).toContain('data-activity-system-layer="locked"');
    expect(html).toContain('data-semantic-locked="false"');
  });

  it("renders meaningful thumbnails for activity and linked result slides", () => {
    const deck = deckSchema.parse({
      ...createDemoDeck(),
      slides: [...createDemoDeck().slides, slide]
    });
    const resultSlide = createActivityResultsSlide(deck, slide.activity.activityId);

    const activityHtml = renderToStaticMarkup(
      <ActivitySpecialSlideThumbnail deck={deck} slide={slide} />
    );
    const resultHtml = renderToStaticMarkup(
      <ActivitySpecialSlideThumbnail
        deck={{ ...deck, slides: [...deck.slides, resultSlide] }}
        slide={resultSlide}
      />
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
    expect(html).toContain("청중 결과");
    expect(html).toContain("/audience/session_1/a/");
    expect(html).toContain("장표별 직접 링크 복사");
    expect(html).toContain("QR 코드 확인");
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

    expect(html).toContain("발표 세션 만들기");
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
      options: [
        ...converted.options,
        { optionId: "option_extra", label: "추가 선택" }
      ],
      maxSelections: 3
    };

    const next = removeQuestionOption(withThreeOptions, "option_extra");

    expect(next).toMatchObject({ maxSelections: 2 });
    expect(deckSchema.safeParse({
      ...createDemoDeck(),
      slides: [{
        ...slide,
        activity: { ...slide.activity, questions: [next] }
      }]
    }).success).toBe(true);
  });

  it.each(["pre-question", "poll", "satisfaction"] as const)(
    "renders the %s template inspector",
    (template) => {
      const templateSlide = createActivitySlide(createDemoDeck(), template);
      const html = renderToStaticMarkup(
        <ActivitySlideInspector onChange={vi.fn()} slide={templateSlide} />
      );
      expect(html).toContain(templateSlide.activity.title);
    }
  );

  it("renders result source recovery without persisting a session or response", () => {
    const deck = deckSchema.parse({
      ...createDemoDeck(),
      slides: [...createDemoDeck().slides, slide]
    });
    const resultSlide = createActivityResultsSlide(
      deck,
      slide.activity.activityId
    );
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

    expect(html).toContain("원본 장표로 이동");
    expect(html).toContain("세션 선택과 응답 데이터는 Deck에 저장되지 않습니다");
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
    const resultSlide = createActivityResultsSlide(
      deck,
      slide.activity.activityId
    );
    const danglingDeck = deckSchema.parse({
      ...deck,
      slides: [...createDemoDeck().slides, resultSlide]
    });

    expect(
      findActivityResultSource(
        danglingDeck,
        resultSlide.activityResult.sourceActivityId
      )
    ).toBeNull();
  });

  it("selects only the current run from a chosen presentation session", () => {
    const runs = [
      sessionResultItem("activity_run_old", false, 1),
      sessionResultItem("activity_run_current", true, 2)
    ];

    expect(
      findCurrentActivityResult(runs, slide.activity.activityId)?.run
        .activityRunId
    ).toBe("activity_run_current");
    expect(findCurrentActivityResult(runs, "activity_other")).toBeNull();
  });

  it("waits for a slow refresh before scheduling the next editor poll", async () => {
    vi.useFakeTimers();
    let resolveRefresh: (() => void) | undefined;
    const refresh = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }))
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

  function sessionResultItem(
    activityRunId: string,
    isCurrent: boolean,
    version: number
  ): ActivitySessionResultItem {
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
