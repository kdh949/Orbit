import { createDemoDeck } from "@orbit/editor-core";
import { slideQuestionGuideTextHashInput } from "@orbit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAutoSlideQuestionGuidesClientRequestId,
  sha256Canonical,
  waitForSlideQuestionGuideJob,
} from "./slideQuestionGuideApi";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waitForSlideQuestionGuideJob", () => {
  it("기본 500ms 간격으로 생성 완료를 확인한다", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(job("running")))
      .mockResolvedValueOnce(Response.json(job("succeeded")));
    vi.stubGlobal("fetch", fetcher);

    const resultPromise = waitForSlideQuestionGuideJob("job-1");
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toMatchObject({ status: "succeeded" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("slide question guide canonical hash", () => {
  it("creates a stable auto request ID from project, deck, and version", async () => {
    const input = { projectId: "project-1", deckId: "deck-1", deckVersion: 3 };

    await expect(createAutoSlideQuestionGuidesClientRequestId(input)).resolves.toMatch(
      /^slide-guide-auto-batch_[a-f0-9]{64}$/,
    );
    await expect(sha256Canonical({ beta: 2, alpha: 1 })).resolves.toBe(
      await sha256Canonical({ alpha: 1, beta: 2 }),
    );
  });

  it("keeps the guide current for visual edits and invalidates text edits", async () => {
    const slide = createDemoDeck().slides[0]!;
    const visualEdit = structuredClone(slide);
    visualEdit.style = { ...visualEdit.style, backgroundColor: "#000000" };
    const textElement = visualEdit.elements.find((element) => element.type === "text");
    if (textElement?.type === "text") {
      textElement.props.color = "#ffffff";
    }
    const textEdit = { ...slide, title: `${slide.title} 수정` };
    const hash = await sha256Canonical(slideQuestionGuideTextHashInput(slide));

    await expect(
      sha256Canonical(slideQuestionGuideTextHashInput(visualEdit)),
    ).resolves.toBe(hash);
    await expect(
      sha256Canonical(slideQuestionGuideTextHashInput(textEdit)),
    ).resolves.not.toBe(hash);
  });
});

function job(status: "running" | "succeeded") {
  return {
    jobId: "job-1",
    projectId: "project-1",
    type: "slide-question-guide-generation",
    status,
    progress: status === "running" ? 20 : 100,
    message: status,
    result: null,
    error: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:01.000Z",
  };
}
