import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActivityAudiencePreviewPage,
  activityAudiencePreviewQueryKey,
  findActivityPreviewSlide
} from "./ActivityAudiencePreviewPage";

describe("ActivityAudiencePreviewPage", () => {
  it("finds the requested activity slide only", () => {
    const deck = createDemoDeck();
    const slide = createActivitySlide(deck, "pre-question");
    const deckWithActivity = { ...deck, slides: [...deck.slides, slide] };

    expect(findActivityPreviewSlide(deckWithActivity, slide.activity.activityId)).toEqual(slide);
    expect(findActivityPreviewSlide(deckWithActivity, "activity_missing")).toBeNull();
  });

  it("renders the actual audience form without creating a live session", () => {
    const deck = createDemoDeck();
    const slide = createActivitySlide(deck, "pre-question");
    const deckWithActivity = { ...deck, slides: [...deck.slides, slide] };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    queryClient.setQueryData(
      activityAudiencePreviewQueryKey(deck.projectId),
      deckWithActivity
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ActivityAudiencePreviewPage
          activityId={slide.activity.activityId}
          projectId={deck.projectId}
        />
      </QueryClientProvider>
    );

    expect(html).toContain("사전 질문 미리보기");
    expect(html).toContain("청중 화면 미리보기");
    expect(html).toContain("실제 응답으로 저장되지 않습니다");
    expect(html).toContain(slide.activity.title);
    expect(html).toContain(slide.activity.questions[0]?.prompt);
    expect(html).toContain("질문 보내기");
  });
});
